# Plan: Review, edit & save a meal — analysis → `meal_logs`/`meal_items` (S2 · piece 3)

- **Status**: **Done** (2026-06-23) — executed per plan, `tsc` + `expo lint` clean, web-verified
  end-to-end (edit dish/macros → live totals → remove item → Save → Saved ✓; field errors gate Save).
  Was: **Approved** (2026-06-23) — multi-agent review: **3 blockers resolved in-plan** (RPC
  jsonb/ordinality SQL spelled out; the RPC validates/allowlists its own input as the security
  boundary; save made idempotent on `image_path` so a lost-ack retry returns success). All should-fixes
  folded in. One "won't typecheck" blocker dismissed (the client is untyped). Ready to execute.
- **Created**: 2026-06-23
- **Plan #**: 0009

## Problem / Goal
Piece 2 turns a photo into an in-memory `MealAnalysis` and shows a **read-only** card. Piece 3
closes S2: let the user **review and correct** that estimate, then **save** it — persisting one
`meal_logs` row plus its `meal_items` rows (per
[src/types/nutrition.ts](../../src/types/nutrition.ts) and the
[initial schema](../../supabase/migrations/20260619102510_initial_schema.sql)). The AI is a
first guess; the human confirms it. After this piece, a meal a user shoots actually becomes a
logged, owned, queryable record (history/dashboard reads are S3, not here).

**Done looks like:**
- After a successful analysis, the Capture screen shows an **editable review** (not the read-only
  card): editable dish name, an editable row per food item (name + calories + protein/carbs/fat),
  remove-an-item, and **live-recomputed totals**.
- A **Save** button persists the meal: one `meal_logs` row (dish, confidence, quality, assumptions,
  totals, `image_path` = the uploaded path, `verified = true`) + one `meal_items` row per item,
  **atomically** (no orphan parent on a partial failure), owned by the caller via RLS.
- Bad/empty/over-range edits are caught client-side (copy mirrors the DB bounds) before any write;
  a save failure degrades to a friendly, typed error with a bounded retry — never a half-written meal.
- Verified on **web**: analyze a meal → edit a value → remove an item → totals update → Save → the
  row + items appear under the user's own id in Supabase.

## Non-goals
- **No history / list / detail screens** and **no editing a previously-saved meal** — reading meals
  back is S3. Piece 3 only writes; after save it resets to a fresh capture.
- **No `eaten_at` picker** — default to `now()` (a "when did you eat this?" control is a later tweak).
- **No re-analyze / re-score on edit** — editing numbers does NOT call the AI again or recompute the
  quality score; the quality score is the AI's, carried through read-only (a deterministic re-scorer
  is the named follow-up from plan 0008 Q3).
- **No full per-nutrient editing in v1** — the user edits the headline calories + macros (the fields
  that matter for tracking); `portion`, `estimatedGrams`, `sugar`, `fiber`, `sodium` are **carried
  through** from the analysis unchanged (still saved). (See Open questions Q1 — easy to widen later.)
- **No offline queue, no optimistic local cache, no image re-upload** (the photo is already in
  Storage from piece 1).
- **No multi-meal batch**, no units toggle on nutrients (grams/kcal are canonical).

## Proposed approach

### Where the code lives
- `supabase/migrations/<ts>_create_meal_log.sql` — **NEW**: a `public.create_meal_log(p_log jsonb,
  p_items jsonb)` RPC that inserts the parent + children **in one transaction** and returns the new
  `meal_logs.id` (atomicity + one round-trip; see Data model).
- `src/features/capture/lib/meal-form.ts` — **NEW**: the pure, UI-free editable form model — the
  editable state type, `seedFormFromAnalysis(analysis)`, per-field validators that **mirror the DB
  `check` bounds**, `recomputeTotals(items)`, and `toSavePayload(form)` (validated → the RPC's jsonb
  shape). Mirrors the existing `onboarding-form.ts` style (no I/O, no logging, friendly copy).
- `src/features/capture/lib/save-meal.ts` — **NEW**: typed `saveMeal({ payload }) → { ok:true; id } |
  { ok:false; kind }` calling the RPC via `supabase.rpc('create_meal_log', …)`. Typed `kind`:
  `unauthorized | invalid | conflict | network | unknown`. Never logs the payload (health data).
- `src/features/capture/components/meal-review.tsx` — **NEW**: the editable review UI — seeded from
  the analysis, owns its form + `saving`/`saveError`/`saved` state (its own state, `mounted` ref,
  double-tap guard), renders the item rows + totals + Save, and a saved → "Log another meal" state.
- `src/features/capture/screens/capture-screen.tsx` — **EDIT**: when `analysis` is set, render
  `<MealReview analysis={analysis} imagePath={uploadedPath} onLogAnother={chooseAnother} />`
  **instead of** the read-only `AnalysisResult` card. Everything else (pick/upload/analyze) unchanged.

### The editable model (mirror the data model, validate to the DB)
- **Seed**: `seedFormFromAnalysis` maps the `MealAnalysis` into a form where every editable numeric
  field is the **string** the user sees (so a half-cleared field doesn't read as `0`), preserving
  the non-edited carry-through fields (`portion`, `estimatedGrams`, `sugar`, `fiber`, `sodium`) as
  numbers, plus `confidence`/`quality`/`assumptions`.
- **Edit**: dish name (text), and per item: name (text), calories, protein, carbs, fat (numeric
  strings). A **remove** control drops an item. (No "add item" in v1 — you can only correct/remove
  what the AI saw; adding a food the camera missed is a later nicety.)
- **Totals**: recomputed **live** via `recomputeTotals`, built on the shared **`sumNutrients`**
  (nutrition.ts — sums all seven, incl. carried sugar/fiber/sodium), re-summed on every keystroke AND
  on remove. Display-only (a function of items). If any total exceeds its DB cap (calories ≤100000;
  protein/carbs/fat/sugar/fiber ≤10000; **sodium ≤1000000**), **block Save** with "These totals are
  too large to save — remove or reduce items" — **reject, never silently clamp** (a clamped total ≠
  `sum(items)` is a silent integrity break S3 would surface). `sumAndClampTotals` lives in the Deno
  function and is **not importable**; the `MAX_*` constants in `meal-form.ts` are the one client-side
  source the validators AND this check read.
- **Validate**: per-field validators mirror the migration literals — calories `0–100000`; protein/
  carbs/fat `0–10000`; name `1–200` chars; dish name `1–200` (default nothing — **require** a
  non-empty dish name, pre-filled with the AI's or `"Meal"`). `parseNumber` tolerates a locale comma
  and returns `NaN` for unusable input; a field that's empty/`NaN`/over-range blocks save with
  friendly copy. **NaN can never reach the payload** (load-bearing: Postgres accepts NaN under a bare
  `>= 0`, but our columns are bounded AND we only build the payload from validated finite numbers).

### Saving — one atomic, idempotent, self-validating RPC, RLS-enforced
`saveMeal` calls `create_meal_log(p_log, p_items)`. **The RPC — not the client — is the security
boundary** (it's `SECURITY INVOKER` and directly callable with crafted jsonb; B2):
- **`SECURITY INVOKER`** (default) + `set search_path = ''` so it runs as the **authenticated caller**
  and **RLS still applies** — least privilege, no service-role. All public objects schema-qualified
  (`public.meal_logs`, `public.meal_items`), plus `auth.uid()` and `pg_catalog.*` builtins.
- **Server-set, never from the payload (B2):** `user_id := auth.uid()`, `verified := true`,
  `meal_log_id := <new id>`, `position := ordinality-1`; `id/eaten_at/created_at/updated_at` keep
  their column defaults. The body reads ONLY an explicit **allowlist** of columns from `p_log`/`p_items`
  (enumerated in Data model) — never `jsonb_populate_record`, so `id`/`user_id`/`verified`/`meal_log_id`
  smuggled into the jsonb are ignored.
- **Input guards (B2):** raise (→ typed error) if `auth.uid()` is null, if `jsonb_array_length(p_items)`
  is `0` or `> 50`, or if `image_path` is non-null and its first path segment `≠ auth.uid()::text`
  (mirrors the storage `${uid}/…` convention — stops pointing a row at another user's namespace).
- **Atomic:** the parent insert + all child inserts run in the function's single transaction → the
  whole meal saves or nothing does (no orphan parent). The DB `check`s are the final backstop (they
  also reject crafted `NaN`/`Infinity` via the bounded `<= MAX`, per the schema's NaN note).
- **Idempotent on `image_path` (B3):** `insert … on conflict (image_path) do nothing returning id`;
  if no row was inserted (a duplicate save — e.g. a lost-ack retry), `select id … where image_path =
  <path> and user_id = auth.uid()` and return THAT id. A duplicate returns the **same id as success**
  and inserts no duplicate children (the parent insert was a no-op). `image_path` = the piece-1
  `uploadedPath`; `verified = true`.
- **Returns** the `meal_logs.id`. The client casts the `any` result (untyped client) to `string`.

### Error contract (client)
`supabase.rpc()` resolves to `{ data, error }` where `error` is a **`PostgrestError`** (`code`,
`message`, `details`, `hint`) — NOT the `Functions*Error` classes the analyze helper throws, and its
`message/details/hint` can echo row VALUES (dish, path, numbers = health PII). So `saveMeal` maps
**by `error.code` (SQLSTATE) only** and **logs only the typed kind** (PII docstring like
`upload-meal-photo.ts`): `23505`→`conflict` (B3: handled as **success** — the meal is already saved),
`23514`/`23502`/`22P02`→`invalid`, our no-auth raise (`28000`) + RLS `42501`→`unauthorized`, a thrown
fetch error or the `withTimeout` stall (`RPC_TIMEOUT_MS = 20_000`)→`network`, else `unknown`. The RPC
`raise`s with explicit `errcode`s so these are deterministic. Kind union: `unauthorized | invalid |
conflict | network | unknown` (no `timeout` — a stall folds into `network`). The review screen offers a
bare retry only for transient kinds (`network`/`unknown`); `conflict` routes to the **Saved** state.

## Files to change
- `supabase/migrations/<ts>_create_meal_log.sql` — NEW: atomic `create_meal_log(jsonb, jsonb)` RPC
  (`SECURITY INVOKER`, `set search_path = ''`, `auth.uid()` for `user_id`), `grant execute … to
  authenticated`, revoked from `anon`/`public`.
- `src/features/capture/lib/meal-form.ts` — NEW: form type, seed, validators (mirror DB bounds),
  `recomputeTotals`, `toSavePayload`.
- `src/features/capture/lib/save-meal.ts` — NEW: typed `saveMeal` over the RPC — `withTimeout`
  (`RPC_TIMEOUT_MS = 20_000`), `error.code`→kind mapping, PII-safe (logs only the kind).
- `src/features/capture/screens/meal-review.tsx` — NEW: editable review UI + Save + saved state
  (colocated `MealReview`, NOT a routed screen and NOT a new `components/` dir — repo uses `lib/` +
  `screens/`; mirrors how `settings-screen.tsx` hosts `GoalsReview`). Reuses the `Input` primitive
  (`error` slot, `keyboardType="decimal-pad"`).
- `src/features/capture/screens/capture-screen.tsx` — EDIT: render `<MealReview key={uploadedPath ??
  'none'} analysis={analysis} imagePath={uploadedPath} onLogAnother={chooseAnother} />` when `analysis`
  is set (replaces the read-only `AnalysisResult`). The `key` remounts on re-pick so an in-flight save
  from a prior photo tears down (its `mounted` ref drops the late `setState`).

## Data model / schema impact
**One new migration — a function only, no table/column/RLS changes.** `meal_logs`, `meal_items`, and
their RLS already exist (plan 0001). The new `public.create_meal_log(p_log jsonb, p_items jsonb)
returns uuid`:
- `SECURITY INVOKER` (RLS applies; caller is `authenticated`), `language plpgsql`, `set search_path
  = ''`, `volatile`. All public objects schema-qualified; `auth.uid()` and `pg_catalog.*` builtins too.
- **Guards first (B2):** `v_uid := auth.uid(); if v_uid is null then raise exception using errcode =
  '28000'; end if;` then `if pg_catalog.jsonb_array_length(p_items) not between 1 and 50 then raise
  using errcode = '23514'; end if;` then validate `image_path` (let `v_path := p_log->>'image_path'`):
  `if v_path is not null and split_part(v_path, '/', 1) <> v_uid::text then raise using errcode =
  '23514'; end if;`.
- **Parent insert (allowlisted, server-set, idempotent — B2/B3):**
  ```sql
  insert into public.meal_logs
    (user_id, image_path, dish_name, confidence, quality_score, quality_factors, assumptions,
     total_calories, total_protein, total_carbs, total_fat, total_sugar, total_fiber, total_sodium,
     verified)
  values
    (v_uid, v_path, p_log->>'dish_name', p_log->>'confidence',
     (p_log->>'quality_score')::int,                              -- nullable
     case when p_log ? 'quality_factors'
          then array(select pg_catalog.jsonb_array_elements_text(p_log->'quality_factors')) end,
     case when p_log ? 'assumptions'
          then array(select pg_catalog.jsonb_array_elements_text(p_log->'assumptions')) end,
     (p_log->>'total_calories')::numeric, (p_log->>'total_protein')::numeric,
     (p_log->>'total_carbs')::numeric, (p_log->>'total_fat')::numeric,
     (p_log->>'total_sugar')::numeric, (p_log->>'total_fiber')::numeric,
     (p_log->>'total_sodium')::numeric, true)
  on conflict (image_path) do nothing
  returning id into v_log_id;
  ```
  `id/eaten_at/created_at/updated_at` keep their defaults; `user_id`/`verified` are literals (never
  from `p_log`). If `v_log_id is null` (conflict → already saved): `select id into v_log_id from
  public.meal_logs where image_path = v_path and user_id = v_uid;` and **return v_log_id** (success,
  no child inserts). (Postgres treats multiple NULL `image_path`s as distinct, so a photoless save
  never false-conflicts.)
- **Children insert (explicit casts + aliased ordinality — B1):**
  ```sql
  insert into public.meal_items
    (meal_log_id, position, name, portion, estimated_grams,
     calories, protein, carbs, fat, sugar, fiber, sodium)
  select v_log_id, (ord-1)::int, e->>'name', e->>'portion', (e->>'estimatedGrams')::numeric,
         (e->>'calories')::numeric, (e->>'protein')::numeric, (e->>'carbs')::numeric,
         (e->>'fat')::numeric, (e->>'sugar')::numeric, (e->>'fiber')::numeric, (e->>'sodium')::numeric
  from pg_catalog.jsonb_array_elements(p_items) with ordinality as t(e, ord);
  return v_log_id;
  ```
  `meal_log_id` and `position` are server-set; any `id`/`meal_log_id`/`user_id` in the item jsonb is
  ignored. Both inserts pass the existing `WITH CHECK` policies (parent `auth.uid()=user_id`; items via
  the just-inserted parent, visible to the caller's `select` policy in-txn). The bounded column `check`s
  reject crafted `NaN`/`Infinity` (`<= MAX`) → rollback → typed `invalid`.
- `revoke all on function public.create_meal_log(jsonb, jsonb) from public;` then `from anon;` then
  `grant execute on function public.create_meal_log(jsonb, jsonb) to authenticated;` (full signature).
- **Why an RPC, not two client inserts:** a client-side "insert log → insert items" is two round-trips
  and leaves an **orphan `meal_logs` row** if the items insert fails midway; the RPC makes it atomic,
  idempotent, self-validating, and halves the latency. `SECURITY INVOKER` keeps RLS as the
  authorization (no service-role; consistent with the analyze function).

## Edge cases & failure modes
- **No items left** (user removed all) → Save disabled **client-side** (no DB constraint enforces ≥1;
  the RPC's `1..50` guard is the server backstop, not the primary gate).
- **Empty / NaN / over-range numeric field** → per-field validation error, Save blocked; the payload
  is built only from validated finite numbers, so NaN/`Infinity`/negatives never reach Postgres — and
  if a crafted call bypasses the client, the bounded column `check`s catch it.
- **Empty dish name** → required; if the user clears it, validation re-prompts (seed defaults to the
  AI's name or `"Meal"`).
- **Totals exceed a total's DB cap** after summing many items → **Save is blocked** with a clear
  message (reject, not clamp — see §Totals) so a stored total never disagrees with `sum(items)`.
- **`image_path` unique conflict** (same analyzed photo saved twice — double-tap, remount, or a
  lost-ack retry of a save that actually committed) → the **RPC returns the existing row's id as
  success** (idempotent, B3) → the UI shows the **Saved** state ("This meal is already saved · Log
  another"), never a dead-end error. The double-tap guard + `mounted` ref still prevent the common case.
- **Session expired / RLS rejects** the insert (`42501`) or null `auth.uid()` (our `28000` raise) →
  `unauthorized` → "Please sign in again" (permanent).
- **Offline / slow network / stalled RPC** → `network` (transient, bare retry); `withTimeout`
  (`RPC_TIMEOUT_MS = 20_000`) avoids an infinite spinner.
- **Sign-out mid-save** → `mounted` ref guards post-await `setState`.
- **Partial DB failure** (one item violates a check) → the whole RPC transaction rolls back → `invalid`
  → "We couldn't save this meal. Please check your edits." No orphan parent.
- **Re-pick / re-analyze while reviewing** → `<MealReview>` is **`key`ed by `uploadedPath`**, so
  choosing another photo (`chooseAnother`) remounts it; the old instance's `mounted` ref drops any
  in-flight save's late `setState`. The in-progress review is discarded with the parent reset.
- **Carry-through drift (decided v1 limitation):** edited macros can diverge from carried sugar/fiber
  (e.g. carbs edited to 0 while sugar stays 30) → a possibly-inconsistent row. Accepted for v1; a
  deterministic per-item recompute-on-edit is the named follow-up (see Non-goals).
- **Logging discipline:** never log the payload, dish, item names, path, or uid (health data); only a
  typed `kind`.

## Test / verify plan
- **Typecheck/lint:** `npx tsc --noEmit` clean; `npx expo lint` clean.
- **Migration:** `supabase db push` applies the RPC; confirm it exists and is `EXECUTE`-able by
  `authenticated` only.
- **Manual on web (the Done gate):** signed-in test user → Capture → upload a meal photo → Analyze →
  in the review: (a) edit the dish name; (b) change an item's calories/protein; (c) remove an item →
  **totals update live**; (d) Save → success state. Then verify in Supabase (dashboard/SQL): one
  `meal_logs` row under the user's id with `verified = true`, `image_path` set, totals matching the
  edited numbers, and N `meal_items` rows with the right `position` order.
- **Negative:** remove all items → Save disabled; type a non-numeric/over-range calorie → field error,
  Save blocked; a European-locale decimal `1,5` parses to `1.5` while `1,2,3` is rejected; save the
  same analyzed photo twice → idempotent **Saved** state (same id, no duplicate rows), not an error;
  (optionally) kill the network → `network` retry.
- **RLS check:** confirm a second user cannot see the saved rows (RLS select is owner-only — already
  enforced by 0001; this just spot-checks the write went to the right owner).

## Rollout
1. `/review-plan` this doc; resolve blockers before coding. **(Done — 3 blockers resolved in-plan below.)**
2. Write + `supabase db push` the `create_meal_log` RPC migration. **No type regen needed** (the client
   is untyped; `.rpc` returns `any`, cast to `string`).
3. Build `meal-form.ts` (model + validators + recompute + `toSavePayload`) → `save-meal.ts` (`withTimeout`
   + `error.code`→kind, PII-safe) → `meal-review.tsx` (UI) → wire into `capture-screen.tsx`.
4. `npx tsc --noEmit` + `npx expo lint`.
5. Verify on web end-to-end (above), **including actually invoking the RPC as a signed-in user** (an
   empty-`search_path` resolution failure only shows on a real call, not on `db push`), and spot-check
   the saved rows in Supabase.
6. Append `docs/JOURNAL.md`; mark this plan Done; **commit straight to `main`** and push.
   Next: **S3** — a meals history/list + day totals reading these rows.

## Open questions — resolved during review (2026-06-23)
1. **Editable scope → headline only.** ✅ v1 edits dish name + per-item name/calories/protein/carbs/fat;
   `portion`/`estimatedGrams`/`sugar`/`fiber`/`sodium` carried unchanged. Full per-item nutrient editing
   (and a per-item recompute that removes the carry-through drift) is the named follow-up.
2. **`eaten_at` → default `now()`** for v1. ✅ A date/time control is deferred (non-goal).
3. **Atomic insert → the RPC**, not a client two-step. ✅ Atomic + idempotent + self-validating; the one
   migration is worth it (orphan-free, one round-trip).
4. **After save → reset to a fresh capture.** ✅ No history/detail screen exists until S3.
5. **`image_path` double-save → keep the unique constraint, make the RPC idempotent** (return the
   existing id as success). ✅ (B3.)
6. **Persist `quality_score`/`quality_factors`/`assumptions` read-only → yes**, null-safe (round the
   score to int; pass `null` when `quality`/`assumptions` are absent). ✅

### Still open (decide at execution, non-blocking)
- Exact `RPC_TIMEOUT_MS` (start 20 s) and the friendly copy strings.
- The server-side item cap value (start 50, matches the analyze items cap) — tune if real meals need more.

---

## Review
_Multi-agent review (4 lenses: correctness, architecture, edge cases, data/privacy),
2026-06-23. Consolidated & deduped._

**Verdict: NEEDS CHANGES → 3 blockers** — all resolved in-plan (folded into the approach/
data-model below; see each `(resolves Bn)` marker). One reviewer-flagged "blocker" (the RPC name
won't typecheck) was **investigated and dismissed**: `src/lib/supabase.ts` creates the client
**without** the `<Database>` generic, so it's untyped and `supabase.rpc('create_meal_log', …)`
compiles (returns `any`); we cast the result ourselves. No type regen needed. (A typed client is a
possible future cleanup, out of scope.)

### BLOCKER
- **B1 — RPC SQL won't run as written: jsonb extraction + ordinality.** (Correctness.) `jsonb`
  doesn't implicitly coerce to `numeric`/`text`, and `with ordinality` needs an explicit alias (its
  column defaults to `ordinality`, not `ord`). **Resolution:** the child insert is spelled out with
  `->>` + explicit casts and an alias: `insert into public.meal_items (meal_log_id, position, name,
  portion, estimated_grams, calories, …, sodium) select v_log_id, (ord-1)::int, e->>'name',
  e->>'portion', (e->>'estimatedGrams')::numeric, (e->>'calories')::numeric, …,
  (e->>'sodium')::numeric from pg_catalog.jsonb_array_elements(p_items) with ordinality as t(e, ord)`.
  (§Data model.)
- **B2 — The RPC is the security boundary and must validate/allowlist its own input.** (Edge cases +
  Data/privacy.) It's `SECURITY INVOKER` and directly callable by any authenticated user with crafted
  jsonb; client validators are a UX nicety, not the boundary. As written ("reads … from `p_log`") a
  caller could smuggle `id`/`user_id`/`verified`/`eaten_at`/`meal_log_id`, set `verified=true` without
  reviewing, point `image_path` at another user's `<uid>/…` namespace (metadata leak + pre-claim the
  `unique` path to DoS their future save), or send 0 / 100k items. **Resolution — the RPC:** (a) reads
  ONLY an explicit **column allowlist** from `p_log` (`dish_name, confidence, quality_score,
  quality_factors, assumptions, total_*`, `image_path`) and from each item (`name, portion,
  estimated_grams, calories, protein, carbs, fat, sugar, fiber, sodium`) — never `jsonb_populate_record`;
  (b) sets `user_id := auth.uid()`, `verified := true`, `meal_log_id := v_log_id`, `position := ord-1`
  as **server literals**, never from the payload (so `id/eaten_at/created_at/updated_at` keep their
  defaults too); (c) **validates `image_path`** is NULL or its first segment `= auth.uid()::text`
  (mirrors the storage `${uid}/…` convention) else raises; (d) **guards item count** `1..50` (raise
  otherwise); (e) relies on the columns' bounded `<= MAX` checks to reject crafted `NaN`/`Infinity`
  (the schema's NaN note), doing no un-bounded server arithmetic. (§Data model, §Saving.)
- **B3 — `image_path` UNIQUE conflict turns a lost-ack retry into a guaranteed failure.** (Edge cases.)
  If the RPC commits but the response is dropped (timeout/network), the client reports transient
  `network` and offers a retry; the retry re-sends the same `image_path` → `unique_violation` → the
  user sees an error for a meal that *did* save (and may lose their review). **Resolution: make the
  save idempotent on `image_path`.** The RPC does `insert … on conflict (image_path) do nothing
  returning id`; if no row was inserted, `select id from public.meal_logs where image_path = <path> and
  user_id = auth.uid()` and return that id. A duplicate save returns the **same id as success** (no
  duplicate child rows are inserted because the parent insert was a no-op). The client treats any
  returned id as success → "Saved ✓ / Log another." (§Saving, §Error contract, §Edge cases.)

### SHOULD-FIX (all folded in)
- **No save timeout / `timeout` kind.** `supabase.rpc` can hang the spinner forever (the `mounted`/
  double-tap guard leaves Save disabled). **Fix:** wrap the call in the `withTimeout` sentinel from
  `analyze-meal.ts` with `RPC_TIMEOUT_MS = 20_000`; on stall return the transient **`network`** kind
  (don't grow the union). (§save-meal.ts.)
- **Error mapping must key on `PostgrestError.code` (SQLSTATE), not message — and never log it.**
  `.rpc()` resolves to `{ data, error }` (a `PostgrestError` with `code/message/details/hint`), NOT the
  `Functions*Error` classes the analyze helper throws; and `message/details/hint` can echo row VALUES
  (dish, path, numbers = health PII). **Fix:** the RPC raises with explicit `errcode`s; `save-meal.ts`
  maps **by `error.code` only** — `23505`→`conflict` (handled as success per B3), `23514`/`23502`/
  `22P02`→`invalid`, `P0001`/`28000` (our no-auth raise) + RLS `42501`→`unauthorized`, a thrown
  fetch/timeout→`network`, else `unknown` — and logs **only the typed kind** (PII docstring mirroring
  `upload-meal-photo.ts`). (§Error contract.)
- **Totals: reject, don't silently clamp.** Clamping `total_*` to the cap while items insert unclamped
  makes `total ≠ sum(items)` — a silent integrity break S3 reads will surface. **Fix:** `recomputeTotals`
  sums all seven nutrients from surviving items via the shared **`sumNutrients`** (nutrition.ts);
  if any total exceeds its DB cap (calories ≤100000; protein/carbs/fat/sugar/fiber ≤10000; **sodium
  ≤1000000**), **block Save** with "These totals are too large to save — remove or reduce items"
  rather than clamp. Enumerate all totals bounds in the form's `MAX_*` (the single client source the
  validators AND this check read). Note `sumAndClampTotals` lives in the Deno function and is **not
  importable** — do not try. (§Totals.)
- **`quality_score` is `integer 0–100` and `quality`/`assumptions` are optional.** `coerceNum` doesn't
  round. **Fix:** `toSavePayload` rounds `quality.score` to an int and passes `null` for
  `quality_score`/`quality_factors`/`assumptions` when absent (columns are nullable). (§toSavePayload.)
- **Architecture: don't add a `src/features/capture/components/` dir** (a third layout pattern; the repo
  uses `lib/` + `screens/`, and `settings-screen.tsx` hosts sub-components like `GoalsReview` inline).
  **Fix:** put `MealReview` at `src/features/capture/screens/meal-review.tsx` (colocated, imported by
  the capture screen) so `capture-screen.tsx` only gains the `<MealReview/>` swap. (§Files.)
- **Re-pick-mid-save teardown needs a React `key`.** "Keyed to the current analysis" only works if
  there's an actual key. **Fix:** render `<MealReview key={imagePath ?? 'none'} … />` so choosing
  another photo remounts it and the old instance's `mounted` ref drops any late `setState`. (§Files.)
- **`recomputeTotals`/validators reuse, not re-implementation.** Build on `sumNutrients` and reuse the
  `parseNumber` + bounded-validator shape from `onboarding-form.ts` (same NaN-rejecting, locale-comma,
  friendly-copy contract); item numeric fields reuse the `Input` primitive (`error` slot,
  `keyboardType="decimal-pad"`). (§meal-form.ts.)
- **`search_path = ''` hygiene.** Schema-qualify all **public** objects (`public.meal_logs`,
  `public.meal_items`) and `auth.uid()`; `pg_catalog` builtins (`jsonb_array_elements`,
  `jsonb_array_length`, `gen_random_uuid`) resolve implicitly but qualify them too for clarity. Mirror
  `bump_analyze_usage`'s `revoke all … from public; … from anon; grant execute … to authenticated`
  with the full `(jsonb, jsonb)` signature. Add a verify step that actually **calls** the RPC as an
  authenticated user (catches an empty-search_path resolution failure). (§Data model, §Test plan.)

### NIT (folded or noted)
- Carried `portion`/`estimatedGrams`/`sugar`/`fiber`/`sodium` come **already server-clamped** from
  piece 2 and are not user-editable → not re-validated client-side (stated, not implied).
- The carry-through micro/macro **drift** (edited carbs vs carried sugar; `sugar>carbs` possible) is a
  **decided v1 limitation in Non-goals** (a deterministic per-item recompute-on-edit is the named
  follow-up), not an open question.
- Zero-item Save is blocked **client-side only** (no DB constraint enforces ≥1) AND now server-side
  (B2 item-count guard); reworded — no false "DB backstop" claim.
- `parseNumber` rule pinned: trim, replace a single decimal comma with a dot, reject if multiple
  separators remain; add a European-locale example to the test plan.
- JSON numbers store as `numeric` (no DB float drift); only JS-side sum rounding is display-level.

### Affirmations (no change)
- The atomic **RPC** (vs orphan-prone client two-step) is the simplest correct way to get atomicity
  with Supabase; **`SECURITY INVOKER` + RLS** (no service-role) is the right authorization, consistent
  with the analyze function. The `meal-form.ts` pure-model split mirrors `onboarding-form.ts`; the
  `save-meal.ts` typed-`kind` helper mirrors `upload-meal-photo.ts`. Inline render in the capture
  screen (vs a new route) is right — the flow already threads `analysis`/`uploadedPath`/`chooseAnother`
  locally. No secret/cost leak (pure DB write, no AI, no service-role).

## Execution log
**2026-06-23 (session 10) — executed as planned, no material deviations.**

- **Migration** `20260623132156_create_meal_log.sql` — the `create_meal_log(p_log jsonb, p_items
  jsonb)` RPC exactly per §Data model: `SECURITY INVOKER`, `set search_path = ''`, guards
  (`28000` no-auth / `23514` item-count `1..50` / `23514` image_path-namespace), allowlisted +
  server-set parent insert, idempotent `on conflict (image_path) do nothing` → return existing
  owned id, aliased `with ordinality as t(e, ord)` child insert, `revoke … / grant execute … to
  authenticated`. `supabase db push` applied it cleanly.
- **`lib/meal-form.ts`** — `MAX_*` bounds mirroring the DB checks, `seedFormFromAnalysis`
  (editable numerics as strings, carry-through fields as numbers), `parseNumber`-reusing validators,
  `recomputeTotals` on the shared `sumNutrients`, `totalsWithinCaps`, `toSavePayload(form, imagePath)`
  (recomputes totals so `total = sum(items)`; rounds `quality_score`; null-safe quality/assumptions).
- **`lib/save-meal.ts`** — `withTimeout` 20 s → `network`; maps **by `error.code` only** (`23505`→
  conflict, `23514/23502/22P02`→invalid, `28000/42501`→unauthorized, else unknown); logs only the
  typed kind. Cast the untyped-client `any` result to a string id.
- **`screens/meal-review.tsx`** — `MealReview`: seeded form, live totals + over-cap message, per-item
  `Input` rows (name + cal/protein/carbs/fat, decimal-pad) with inline validation, remove (kept ≥1),
  double-tap + `mounted` guards, `conflict`-as-success → **Saved ✓ / Log another**.
- **`screens/capture-screen.tsx`** — swapped the read-only `AnalysisResult` (+ `Macro`, dead styles
  removed) for `<MealReview key={uploadedPath ?? 'none'} … />`.

**Deviations:** (1) `supabase.rpc()` returns a thenable builder, not a `Promise` — wrapped it in
`Promise.resolve(...)` so the `withTimeout` race typechecks (runtime behavior unchanged). (2) Dropped
two unused imports in `meal-review.tsx` (the validators are used transitively via `validateItem`).
Neither changes the design.

**Verify result:** `npx tsc --noEmit` ✅, `npx expo lint` ✅ (exit 0). **Web-verified** by the user
end-to-end: editable review renders, dish/macro edits recompute totals live, remove updates totals,
empty/invalid field gates Save, Save → **Saved ✓**. S2 piece 3 **Done** → S2 complete.
