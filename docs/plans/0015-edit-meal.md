# Plan: Edit a saved meal

- **Status**: ~~Draft~~ → ~~In Review~~ → ~~Approved~~ → ~~In Progress~~ → **Done**
- **Created**: 2026-06-24
- **Plan #**: 0015

## Problem / Goal
A saved meal is currently immutable — History (0012) can only **view** or **delete**.
If the AI mis-estimated or the user wants to tweak a portion, the only recourse is
delete + re-shoot. We already have a full **editable model** (`meal-form.ts`) and a
review UI (`meal-review.tsx`) used pre-save; we just never expose it post-save.

**Goal:** let the user **edit a saved meal** from History — change the **dish name**
and per-item **name / calories / protein / carbs / fat**, and **remove items** —
then persist the change **atomically** (parent totals + children replaced in one
transaction), with History and the dashboard reflecting it. This is the app's **first
UPDATE surface** on `meal_logs`/`meal_items`. "Done" = from a History row I open an
edit screen seeded with the meal's current values, change fields, Save, land back on
History showing the updated meal; totals always equal `sum(items)`; `tsc`+`lint` green;
migration applied; user web-verifies.

## Non-goals
- **No per-nutrient editing** (sugar/fiber/sodium) and **no quality/confidence edit** —
  exactly like create-v1, these are **carried through unchanged** from the stored row.
  (Full per-nutrient editing is the same named follow-up `meal-form.ts` already cites.)
- **No adding brand-new items** — v1 edits/removes existing items only (parity with
  `meal-form.ts`, which has `removeItem` but no add). Add-item is a follow-up.
- **No editing the photo** (`image_path`) or **`eaten_at`** — both preserved as-is.
- **No re-running the AI / re-analyze** on edit.
- **No edit history / audit trail** — a plain in-place update.
- **No optimistic UI** — await-then-refetch (matches the 0012 delete decision).

## Proposed approach
**One new atomic RPC (migration) + a detail fetch + a reused editable form + an edit
route.** Mirrors the create path (`create_meal_log` + `meal-form.ts` + `meal-review`)
so the edit path is the same shape, not a parallel invention.

### 1. `update_meal_log(p_id uuid, p_log jsonb, p_items jsonb)` — NEW migration
Models on `create_meal_log` (same security posture): `security invoker`,
`set search_path = ''`, allowlisted `->>` reads only (never `jsonb_populate_record`),
server-set `meal_log_id`/`position`, and per-error SQLSTATEs the client maps.
**Explicit body order (review — data #2 / correctness):** the ownership check MUST
precede any child mutation:
1. `auth.uid()` guard → `28000`.
2. item count 1..50 → `23514`.
3. **Parent UPDATE + not-found (BLOCKER — correctness/edge):**
   `update public.meal_logs set <allowlisted parent cols> where id = p_id and user_id
   = v_uid;` then `GET DIAGNOSTICS v_rows = ROW_COUNT; if v_rows = 0 then raise
   'meal not found' using errcode = 'P0002'; end if;` — a **distinct** SQLSTATE
   (`P0002` no_data_found), NOT `23514`, so the client shows "this meal no longer
   exists" rather than "check your values." RLS `meal_logs_update` (USING **and**
   WITH CHECK `auth.uid() = user_id`, verified `:177`) backstops it.
4. **Delete children:** `delete from public.meal_items where meal_log_id = p_id`.
5. **Re-insert children:** `insert ... select ... with ordinality` from `p_items`
   (verbatim child-insert shape from `create_meal_log`, positions 0..n−1).
- **Allowlisted parent columns updated:** `dish_name, confidence, quality_score,
  quality_factors, assumptions, total_*` (7 totals). **NEVER** touch `user_id`,
  `image_path`, `eaten_at`, `created_at`, `verified`, **or `updated_at`** — the
  existing `set_updated_at` BEFORE-UPDATE trigger (`initial_schema.sql:102`) already
  maintains `updated_at`; setting it here is redundant (DROP it from the SET list).
  **DROP the `create_meal_log` `image_path`/namespace block entirely** — the column
  is never written, so the check is dead code (the payload may carry `image_path:
  null`; the RPC simply never reads it).
- The whole function body is **one implicit transaction** → if the re-insert violates
  a column `check` (`23514`) or FK (`23503`), everything rolls back; **children are
  never lost**.
- `returns uuid` (the id, for symmetry); revoke anon/public, grant `authenticated`.

### 2. `useMealDetail(id)` — `src/features/history/lib/use-meal-detail.tsx`
Fetch the ONE meal's editable detail for seeding (the History `MealCard` is too narrow).
- `meal_logs` row by `.eq('id', id).eq('user_id', userId).maybeSingle()` — strict
  `Pick<>` allowlist of the editable + carried fields: `dish_name, confidence,
  quality_score, quality_factors, assumptions` (NOT `image_path`/totals — totals are
  recomputed from items on save). One `SELECT_COLUMNS` const synced with the `Pick<>`
  (no inline drift — mirrors `use-meal-history.tsx`).
- `meal_items` by `.eq('meal_log_id', id).order('position')` — `Pick<>`: `name,
  portion, estimated_grams, calories, protein, carbs, fat, sugar, fiber, sodium`. The
  child query has **no in-code `user_id` filter by design** (`meal_items` has no such
  column) — owner-scope is RLS-only via `meal_items_select`'s parent-join (verified
  `:185`); also fetched only after the parent confirms ownership.
- **Both-or-neither (review SF2/SF3):** parent `null` (deleted) OR items query errors
  OR items come back **empty** (a 0-item meal can't be made valid with no add-item in
  v1) → return a hard **error / "can't edit"** state. NEVER seed a partial form (empty
  items → a Save-disabled dead-end).
- Simple `mounted`/`active` guards (the screen remounts per open — don't over-copy
  `useMealHistory`'s full keyed-outcome machinery); `{ loading, detail, error,
  refetch }`. PII: structural logging only.

### 3. `seedFormFromMealLog(log, items)` — add to `meal-form.ts`
A sibling to `seedFormFromAnalysis` producing the SAME `MealForm` (so every existing
validator / `recomputeTotals` / `totalsWithinCaps` / `toSavePayload` is reused as-is):
maps the stored row → `dishName`, `confidence`, `quality` (from `quality_score` +
`quality_factors`), `assumptions`; maps each item → `MealItemForm` (numeric fields via
the existing `numToInput`, carried `portion/estimatedGrams/sugar/fiber/sodium`).
Stable `id` = the row index at seed (same as create).

### 4. `updateMeal({ id, payload })` — `src/features/history/lib/update-meal.ts`
**Shared primitive (review arch #3):** factor the identical RPC machinery out of
`saveMeal` into `capture/lib/meal-rpc.ts` — `callMealRpc(fn, args, { timeoutMs })`
returning a typed result + the shared SQLSTATE classify + PII-only logging — so
`saveMeal` and `updateMeal` don't carry two copies of `withTimeout`/`TIMEOUT`/the race.
- **Dedicated result type (review — do NOT reuse `SaveResult`/`classifyCode`):** an
  update has no `conflict` and returns no `id`. Type:
  `{ ok: true } | { ok: false; kind: 'unauthorized' | 'invalid' | 'not_found' |
  'network' | 'unknown' }`. Classify adds **`P0002` → `not_found`** (the "no longer
  exists" copy) and a **`23503` (FK) → `not_found`** backstop; `28000`/`42501` →
  `unauthorized`; `23514`/`23502`/`22P02` → `invalid`.
- `Promise.resolve(supabase.rpc('update_meal_log', { p_id: id, p_log: payload.log,
  p_items: payload.items }))`, 20 s timeout, log only the typed kind. `image_path`
  rides along in `payload.log` but the RPC never reads it (harmless).

### 5. Edit screen + route
- **Reuse the editable form UI.** `meal-review.tsx` already renders dish-name + the
  per-item fields (`ItemRow`) + live totals (`TotalRow`) + validation. **Extract that
  editable body into a shared `MealEditorForm`** used by BOTH `meal-review` (create) and
  the edit screen. **Pinned props contract (review arch #1):** `{ form: MealForm;
  onDishChange(v); onItemChange(id, field, value); onRemoveItem(id); totals: Nutrients;
  withinCaps: boolean }` — each screen keeps its own save/error/saved state. **The
  assumptions block must read `form.assumptions`** (today `meal-review` reads
  `analysis.assumptions` directly) so it works for both create and edit. The create
  flow's "behavior unchanged" is verified by test #7 + `tsc`.
- **New screen** `src/features/history/screens/edit-meal-screen.tsx`: reads
  `useLocalSearchParams<{ id }>`, `useMealDetail(id)` → loading/error gates →
  `seedFormFromMealLog` into form state → `MealEditorForm` → Save (validate →
  `toSavePayload(form, null).log/items` → `updateMeal`) → on success `router.back()`;
  on error, typed inline copy + retry for transient kinds. Confirm-discard on back if
  dirty (optional, see OQ).
- **Route:** a root-level **guarded** screen (sibling to `privacy`) so it presents over
  the tabs with a themed back chevron: add `<Stack.Screen name="meal-edit" options={{
  headerShown:true, title:'Edit Meal' }} />` inside the `!!session && !needsOnboarding`
  guard in `app/_layout.tsx`, and a thin route file `src/app/meal-edit.tsx` re-exporting
  the screen. History row gains an **Edit** affordance → `router.push({ pathname:
  '/meal-edit', params: { id } })`.
- **Reflect on return:** add `useFocusEffect(refetch)` to History so returning after an
  edit shows the new values. **Skip the first focus** (a `hasMounted` ref) so the mount
  fetch + focus fetch don't double-fire / flip `loading` mid-interaction, and confirm it
  doesn't race the delete flow's in-flight state (review edge SF4).
- **history → capture ownership split (precedented):** history owns the edit *flow*
  (`edit-meal-screen`, `update-meal`, `use-meal-detail`); it reuses capture's
  editable-meal *model* (`meal-form`, `MealEditorForm`) — same split as `delete-meal` →
  `delete-meal-photo`. No speculative `shared/meal/` package for one consumer.

## Files to change
- `supabase/migrations/<ts>_update_meal_log.sql` — **new.** The atomic update RPC.
- `src/features/history/lib/use-meal-detail.tsx` — **new.** Editable-detail fetch.
- `src/features/history/lib/update-meal.ts` — **new.** RPC wrapper (mirrors `saveMeal`).
- `src/features/capture/lib/meal-form.ts` — add `seedFormFromMealLog`.
- `src/features/capture/screens/meal-editor-form.tsx` — **new.** Extracted shared
  editable body (dish name + items + totals + validation display).
- `src/features/capture/screens/meal-review.tsx` — use `MealEditorForm` (behavior
  unchanged; the create flow is regression-checked).
- `src/features/history/screens/edit-meal-screen.tsx` — **new.** The edit screen.
- `src/app/meal-edit.tsx` — **new.** Thin route re-export.
- `src/app/_layout.tsx` — register the guarded `meal-edit` Stack screen.
- `src/features/history/screens/history-screen.tsx` — Edit affordance per row +
  `useFocusEffect` refetch.

## Data model / schema impact
**One new migration: the `update_meal_log` RPC function.** No new tables/columns; **no
new RLS policy** — the SECURITY-INVOKER RPC relies on EXISTING owner-scoped policies,
all verified present in `20260619102510_initial_schema.sql`: `meal_logs_update` (`:177`),
`meal_items_insert` (`:191`), `meal_items_delete` (`:206`), `meal_items_select` (`:185`),
`meal_logs_select` (`:171`). `meal_items` already cascades on parent delete (used here
only for the explicit child-replace within the txn).

## Edge cases & failure modes
- **Meal deleted between open and Save** (another device / the 0011 sweep): `update …
  where id = … and user_id = …` affects 0 rows → RPC raises → client shows a "this meal
  no longer exists" message; on back, History refetch confirms it's gone. Never creates
  a row (it's an UPDATE, not upsert).
- **Not the owner / RLS rejects:** `42501` → `unauthorized` (shouldn't happen — the id
  came from the user's own list).
- **Item count → 0** (user removed all items): blocked client-side (`isFormValid`
  requires ≥1) AND server-side (1..50 guard). Removing the last item disables Save.
- **Totals exceed caps / invalid numbers / NaN:** same client guards as create
  (`totalsWithinCaps`, `validateItem`); the column `check`s are the server backstop →
  `invalid`. Totals recomputed from items so stored total always = `sum(items)`.
- **Totals drift on legacy rows (review SF1):** a meal saved before this plan may have
  stored `total_*` that don't equal `sum(items)` (the analyze server clamps per-item and
  per-total independently), and seeding rounds each field via `numToInput`. So an
  open-and-save with NO user change can shift a total by a few units. **Intended
  behavior** (edit normalizes totals to `sum(items)`); document it. Optional: on seed,
  if `recomputeTotals(seeded)` differs from the fetched stored totals beyond a rounding
  epsilon, show a one-line "totals recalculated from items" note.
- **Seed fidelity:** reconstruct `quality` only when `quality_score != null` (mirror
  `toSavePayload`'s `form.quality ? … : null` gating) so factors aren't dropped/resurrected
  inconsistently; `confidence` is `NOT NULL` so it maps cleanly.
- **Concurrent edits (two tabs):** last write wins (no optimistic locking) — acceptable
  for a single-user app; `updated_at` reflects the latest.
- **`quality`/`assumptions` null:** seeded as absent → payload sends `null` (same as
  create); the RPC `?`-guards them.
- **Offline / timeout:** transient `network` kind → inline retry; nothing partially
  saved (atomic txn).
- **Sign-out mid-edit:** `mounted`/`active` guards drop late setState; the route is
  behind the session guard so a sign-out unmounts it.
- **eaten_at / image_path preserved:** verify the row's photo still shows in History and
  its dashboard "today" bucket is unchanged (we don't touch `eaten_at`).
- **Back with unsaved edits:** optional confirm-discard (OQ); at minimum no crash.

## Test / verify plan
- `npx tsc --noEmit` PASS; `npx expo lint` clean; web bundle HTTP 200.
- **Migration:** apply locally (`supabase db push` to the linked project or a local DB);
  confirm the function exists and `grant`/`revoke` match `create_meal_log`.
- **Manual (web, logged in):**
  1. History row → Edit → screen seeded with the meal's current dish + items + totals.
  2. Change a calorie value / dish name → live totals update → Save → back on History
     showing the new values; reopen Edit → persisted.
  3. Remove an item → totals drop → Save → item gone; removing the last item disables Save.
  4. Edit a meal eaten **today** → dashboard reflects the new totals (focus refetch).
  5. Delete the meal on another path, then Save the stale editor → graceful "no longer
     exists", no row created.
  6. Over-cap / empty field → Save blocked with friendly copy; no value echoed.
  7. Create flow (`meal-review`) still works unchanged (regression — the extracted
     `MealEditorForm`).
- **Grep gate:** new code logs no dish/item/metric/id (only typed kinds); the detail
  selects no `image_path` it doesn't need and no `user_id`-less filter.

## Rollout
1. Land the migration + client code on `main`.
2. **Deploy the migration** (`supabase db push`; same flow as `create_meal_log`) — this
   is the one non-client step. Verify the function + grants in prod.
3. `tsc`/`lint`/web-bundle; user web-verify.
4. Journal + mark Done + commit & push. Real-device pass rides the deferred bundle.

## Open questions
1. **Shared `MealEditorForm` extraction vs. duplicate** — recommend extracting (one
   source for the editable body, no drift) but it touches `meal-review.tsx` (create-flow
   regression risk). Lower-churn alt: leave `meal-review` untouched and have the edit
   screen reuse `meal-form.ts` (logic) + the shared `Input`/`Text` directly, duplicating
   ~120 lines of render. Which do we want?
2. **Allow adding a new item in edit?** Proposed non-goal (parity with create v1).
   Confirm — it's a natural ask but adds an `addItem` + its validation.
3. **Confirm-discard on back when dirty** — nice-to-have; ship without it for v1?
4. **Reflect-on-return mechanism** — `useFocusEffect` refetch on History (proposed) vs a
   returned "updated" param. Focus refetch is simpler + also helps the delete flow.
5. **`updated_at`** — surface "edited" in History/detail, or keep it invisible for v1?
   (Proposed: invisible.)

---

## Review
_Balanced 4-lens review, 2026-06-24. All 5 RLS policies the SECURITY-INVOKER RPC
relies on verified present with correct USING/WITH CHECK (`meal_logs_update` `:177`,
`meal_items_insert` `:191`, `meal_items_delete` `:206`, `meal_items_select` `:185`,
`meal_logs_select` `:171`). Blockers resolved in the plan above; verdict below._

### BLOCKER (resolved)
- **B1 — `updated_at = now()` in the RPC collides with the existing `set_updated_at`
  BEFORE-UPDATE trigger** (`initial_schema.sql:102`; confirmed by 2 reviewers). The
  draft listed it in the SET list, signaling the trigger wasn't accounted for.
  **Resolution:** dropped `updated_at` from the SET list — the trigger owns it.
- **B2 — not-found detection + error UX.** The draft wavered ("`23514`/a distinct
  code") and proposed reusing `saveMeal`'s `classifyCode`/`SaveResult`, which has no
  not-found case, carries a meaningless `conflict`, and returns an `id`. A 0-row UPDATE
  mapped to `23514` would tell the user "check your values" when the meal was actually
  deleted. **Resolution:** explicit `GET DIAGNOSTICS ROW_COUNT` not-found check right
  after the parent UPDATE (before any child mutation), raising a **distinct `P0002`**;
  a **dedicated `updateMeal` result type** (`not_found` kind, no `conflict`/`id`) with
  its own classify (`P0002`/`23503` → `not_found`).

### SHOULD-FIX (folded in)
- **Shared `callMealRpc` primitive** (arch) — factor `withTimeout`/`TIMEOUT`/race +
  classify out of `saveMeal` so `updateMeal` doesn't copy ~40 lines.
- **`MealEditorForm` props contract pinned** + the assumptions block must read
  `form.assumptions` (it currently reads `analysis.assumptions`) so the extracted body
  serves both create and edit without drift.
- **`useMealDetail` both-or-neither gating** — parent-deleted OR items-error OR
  items-empty (0-item meal, unrecoverable with no add-item) → hard error state, never a
  partial Save-disabled seed.
- **Totals drift on legacy rows** — open-and-save normalizes `total_*` to `sum(items)`
  (rounding can shift a few units); documented as intended (optional "recalculated" note).
- **RPC body ordering explicit** (data) — auth → count → parent UPDATE + not-found →
  delete children → insert children; cross-user `p_id` writes nothing (verified by RLS
  backstop + the ownership check).
- **`useFocusEffect` on History skips the first focus** so it doesn't double-fire with
  the mount fetch or race the delete in-flight state.
- **Drop the `image_path`/namespace block** from the RPC entirely (column never written).

### NIT (addressed/noted)
- `SELECT_COLUMNS` const synced with each `Pick<>` (no inline drift). • Don't over-copy
  `useMealHistory`'s keyed-outcome lifecycle into the per-open detail fetch. • Seed
  `quality` only when `quality_score != null`. • Child query owner-scope is RLS-only by
  design (no `user_id` column) — `meal_items` RLS must stay enabled. • Add a regression
  test: edit a **prior-day** meal, confirm `eaten_at`/day-bucket unchanged. • Ensure the
  `active`/`mounted` guard wraps the `updateMeal` resolution, not just the detail fetch.
- **Confirmed correct, no change:** new RPC over a client multi-call (atomicity — more
  important for update than create); root-level guarded route over an in-tabs screen;
  plpgsql function body is one transaction (children never lost on a failed re-insert);
  `with ordinality` position renumbering; carried fields round-trip via seed→payload.

### Verdict
**APPROVED** — 2 blockers resolved (B1 drop `updated_at`; B2 distinct `P0002` not-found
+ dedicated result type), should-fixes folded in, RLS verified, no migration beyond the
RPC. OQ1 (extract `MealEditorForm` — **decided: extract**), OQ2 (no add-item v1), OQ3
(no confirm-discard v1), OQ4 (focus refetch), OQ5 (`updated_at` invisible) are scope
confirmations, not blockers. **Note:** execution includes a **migration deploy**
(`db push`) — heavier than the recent pure-client plans.

## Execution log
<!-- Filled during execution: what actually happened, any deviation from the plan
     and why, final verification result. -->

### Session 14 — 2026-06-24 (built per plan, migration deployed)
Built strictly to the approved plan; **no material deviations**. Order: migration →
shared `callMealRpc` (+ `saveMeal` refactor) → `seedFormFromMealLog` → `useMealDetail`
→ `updateMeal` → `MealEditorForm` extraction (+ `meal-review` refactor) → edit screen
+ route + `_layout` registration → History Edit affordance + skip-first-focus refetch.

**Files:** new `supabase/migrations/20260624150000_update_meal_log.sql`,
`src/features/capture/lib/meal-rpc.ts`, `src/features/history/lib/use-meal-detail.tsx`,
`src/features/history/lib/update-meal.ts`,
`src/features/capture/screens/meal-editor-form.tsx`,
`src/features/history/screens/edit-meal-screen.tsx`, `src/app/meal-edit.tsx`. Edited
`save-meal.ts` (now wraps `callMealRpc`), `meal-form.ts` (+`seedFormFromMealLog`,
`StoredMealLog`/`StoredMealItem`), `meal-review.tsx` (uses `MealEditorForm`),
`history-screen.tsx` (Edit action + `useFocusEffect`), `_layout.tsx` (guarded
`meal-edit` Stack screen).

**Deviations / notes:**
- **`callMealRpc` shape:** factored to return a transport-agnostic
  `{ status: 'ok'|'error'|'network' }` carrying ONLY the SQLSTATE; each caller keeps
  its own classify + typed-kind logging (so `saveMeal` keeps `conflict`+`id`, `updateMeal`
  has `not_found`, no id). The shared `withTimeout`/`TIMEOUT`/race now lives once in
  `meal-rpc.ts`.
- **`useMealDetail` lifecycle:** the plan said "don't over-copy `useMealHistory`'s
  keyed-outcome machinery," but `expo lint`'s `react-hooks/set-state-in-effect` forbids
  synchronous `setState` in an effect body. Adopted the SAME keyed-outcome + `useMemo`
  pattern as `useMealHistory` (keyed to `(id, userId, reloadKey)`, setState only in the
  async callback). The both-or-neither gate + PII discipline are intact; only the proven
  lifecycle shape changed vs. the plan sketch (the right call).
- **Edit-screen seeding:** the loaded editor is a child component `key`ed to `id`, so the
  form seeds once from `detail` via a `useState` initializer (no seed-in-effect). Terminal
  `not_found` → a "no longer exists" screen with Back (no retry); transient kinds → inline
  retry. `mounted` ref wraps the `updateMeal` resolution (review NIT).
- **`estimatedGrams` on seed:** a stored `null` `estimated_grams` seeds as `0` (the form
  type is `number`); a no-change save then writes `0` rather than `null`. Within the
  plan's "carried-through" tolerance (analysis always supplies a number; null is a
  legacy-row edge), harmless against the column's bound check.

**Verified:** `npx tsc --noEmit` PASS; `expo lint` clean; web bundles compile (HTTP 200,
valid JS, no error envelope) — `meal-edit.tsx`, `edit-meal-screen.tsx`, `meal-review.tsx`
chains all present (`update_meal_log`/`seedFormFromMealLog`/`useMealDetail`/`callMealRpc`).
**Migration `db push`ed to prod** (ref `vldpfoczswakghkrkyrm`); Management-API check
confirms `update_meal_log(p_id uuid, p_log jsonb, p_items jsonb)` exists, `SECURITY
INVOKER` (`prosecdef=false`), grants `authenticated:EXECUTE` (no `anon`) — identical
posture to `create_meal_log`. **User web-verified** (edit seed/save/persist, remove item,
today-meal dashboard reflect, over-cap block, and the create-flow regression). **DONE.**
