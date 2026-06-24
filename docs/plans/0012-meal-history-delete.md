# Plan: Meal history list + delete-meal flow

- **Status**: **DONE** (2026-06-24) — built per the approved plan, static-verified (tsc/lint/web bundle),
  and **user web-verified**. The 2 blockers + should-fixes from `## Review` were folded into the body
  (`(resolves Bn)` / `(SF)` markers). Purely client-side: **no schema, RLS, RPC, secret, or function
  changes** (the delete policy + `meal_items` cascade + the 0011 photo helper already existed).
- **Created**: 2026-06-24
- **Plan #**: 0012

## Problem / Goal
Today a saved meal is **write-only**: `create_meal_log` (plan 0009) inserts it, but **nothing in the
app ever reads `meal_logs` back** — the Home and Explore tabs are still the Expo starter template, and
there is no history, list, or detail screen anywhere. So a user cannot see their logged meals, and the
only "delete" path the privacy policy can offer is **email us** (plan 0010). This plan delivers the
user-facing deletion piece — the documented future obligation from plan 0011's NIT ("a future
`delete-meal` flow should also best-effort `.remove()` the photo").

Because deletion needs something to delete *from*, and the user chose **"history list + delete in one
plan,"** this plan builds a **minimal meal-history list** (read the user's `meal_logs`, newest first)
plus a **delete action with confirmation** on each row. Deleting a meal removes the `meal_logs` row
(its `meal_items` cascade away) and **best-effort `.remove()`s the Storage photo** so it never becomes
an orphan — reusing the exact fire-and-forget / never-throws / no-PII discipline of
[delete-meal-photo.ts](../../src/features/capture/lib/delete-meal-photo.ts) from plan 0011.

**Done looks like:**
- A **History** tab lists the signed-in user's saved meals (dish name, calories, key macros, quality
  score, eaten-at), newest first, with loading / empty / error+retry states and pull-to-refresh.
- Each row has a **Delete** affordance that asks for confirmation, then removes the meal: the row
  disappears from the list, the `meal_logs` row (+ `meal_items`) is gone, and the associated photo is
  best-effort deleted from the `meal-photos` bucket.
- A user can only ever delete **their own** meal (owner-scoped RLS — already in place).
- Deleting is **idempotent** and **tolerant of an already-vanished blob** (the 0011 sweep may have
  already reaped the photo, or the row may already be gone): no error surfaced, no dangling state.

## Non-goals
- **No meal *detail*/edit screen.** v1 is a flat list + delete only. (Editing a saved meal is a separate
  future plan; review/edit-before-save already exists in `meal-review.tsx`.)
- **No daily totals / dashboard / charts / streaks.** Nothing currently aggregates `meal_logs`, so
  there is nothing to recompute on delete (see Edge cases). Aggregates are a separate plan.
- **No account-deletion / bulk "delete all my data" flow** — still routed via email; this plan deletes
  one meal at a time. (It does move us toward self-serve deletion — and **must** update the privacy
  policy copy to disclose in-app per-meal delete, B2 — but account/bulk deletion stays email-routed.)
- **No undo / soft-delete / trash.** Delete is immediate after confirmation (the confirm dialog is the
  safety gate). Re-logging is the recovery path.
- **No pagination / infinite scroll** in v1 — a bounded `limit` (e.g. 100, newest) with a noted
  follow-up if a user ever exceeds it (see Open questions).
- **No schema, RLS, or RPC changes** — the delete policy and the `meal_items` cascade already exist.

## Proposed approach
A new `history` feature, mirroring the established `capture` / `auth` feature layout (a `lib/` for data
+ a `screens/` for UI), wired into the existing tab navigator by **repurposing the throwaway Explore
tab**.

### 1. Data read — `useMealHistory` hook (`src/features/history/lib/use-meal-history.tsx`)
A plain hook (not a context — like [use-profile.tsx](../../src/features/auth/lib/use-profile.tsx), it
has exactly one consumer, the history screen) that copies that hook's **lifecycle discipline verbatim**:
a `mounted` ref + a per-attempt `active` flag + an outcome **keyed to `(userId, reloadKey)`** so a
sign-out mid-fetch can't setState-after-unmount and a stale answer from a previous user never renders.

- Query: `supabase.from('meal_logs').select('<allowlist>').eq('user_id', userId).order('eaten_at',
  { ascending: false }).limit(100)`. **The explicit `.eq('user_id', userId)` is MANDATORY (resolves the
  data SF), not a perf nicety:** RLS scopes rows to the owner, but if RLS were ever misconfigured an
  unfiltered read would leak another user's meals — the in-code owner filter is required defense-in-depth
  (it also uses the `meal_logs_user_eaten_idx (user_id, eaten_at desc)` index). Never remove it without a
  security review.
- **Column allowlist enforced at the type level (SF):** select only what the card renders — `id,
  dish_name, eaten_at, image_path, total_calories, total_protein, total_carbs, total_fat,
  quality_score` — and type the result as a **`Pick<>`** of the generated Row so an accidental
  over-fetch is a compile error:
  `type MealCard = Pick<Database['public']['Tables']['meal_logs']['Row'], 'id'|'dish_name'|'eaten_at'|
  'image_path'|'total_calories'|'total_protein'|'total_carbs'|'total_fat'|'quality_score'>`. **Never
  `select('*')`** — it would pull `confidence/quality_factors/assumptions/verified` (health PII the card
  doesn't need).
- Exposes only `{ loading, meals, error, refetch }` — **no `removeLocal`/`restoreLocal` mutators
  (resolves the arch SF).** `useProfile`/`useOnboardingStatus` expose no state mutators; the screen does
  a plain await-then-refetch delete (§3), which also removes a cluster of optimistic-rollback edge cases.
  `refetch` bumps `reloadKey` (pull-to-refresh and post-delete reconciliation).
- **PII discipline:** never log a row, dish name, path, or uid — only a structural/boolean outcome,
  exactly like `use-profile`.

### 2. Delete primitive — `deleteMeal` (`src/features/history/lib/delete-meal.ts`)
A typed, single-responsibility function the screen calls. It lives in `history/lib` because **history
owns the delete flow**, while `capture/lib` owns the photo helper it reuses (note this in the file
header). Signature **explicitly takes a nullable path (SF):**
```
deleteMeal(id: string, imagePath: string | null): Promise<DeleteMealResult>
```
- **Row first, photo second.** `await supabase.from('meal_logs').delete().eq('id', id)` — RLS scopes it
  to the owner; the `meal_items` FK is `on delete cascade`, so children vanish in the same statement.
  Then, **only after the row delete succeeds**, fire `deleteMealPhoto(imagePath)` (the existing 0011
  helper) **best-effort, not awaited** — fired from the **same authed session** (don't fire after a token
  refresh/sign-out); if the blob is already gone (0011 sweep) or offline it's swallowed and the daily
  sweep is the backstop. Ordering matters: never delete the photo before the row is confirmed gone.
- **Timeout (SF):** wrap the row-delete in a ~15 s `withTimeout` (mirror `saveMeal`'s 20 s); a timeout →
  `network` kind. A stalled delete must not hang the flow.
- **Idempotency classification, pinned (SF):** Supabase `.delete().eq('id', id)` resolves to
  `{ error: null }` whether it matched **0 or 1** rows — `.select()`/`count` is **not** needed. So
  `deleteMeal` returns `{ ok: true }` iff `error === null` (a 0-row delete = the row was already gone on
  another device = the user's intent is satisfied = success). Only `!ok` is classified.
- **Result contract** mirrors `saveMeal`'s typed-kind shape: `{ ok: true } | { ok: false; kind:
  'unauthorized' | 'network' | 'unknown' }`, classified by SQLSTATE (`28000`/`42501` → unauthorized) /
  a thrown transport error or timeout (→ network).
- **Logging discipline (SF):** never log the `id`, `imagePath`, PostgrestError message/details, or a
  data-array length — **only** the typed kind, e.g. `[deleteMeal] ok` / `[deleteMeal] network`.
- **Null path:** skip the photo step cleanly when `imagePath` is null (older/edge rows) — no error.

### 3. UI — History screen (`src/features/history/screens/history-screen.tsx`)
A `FlatList` of meal cards, themed with the existing `ThemedView` / `ThemedText` / `Spacing` system.
- **States:** loading spinner; **empty state** ("No meals logged yet — snap one from Capture"); **error
  state** with a Retry button (calls `refetch`); the list itself. `keyExtractor={(m) => m.id}` — `id` is
  a stable UUID PK (SF). **Pull-to-refresh** via `RefreshControl` — but **platform-guarded (SF):**
  `RefreshControl` may no-op on web, so the always-present **Retry/refresh affordance is the web refresh
  path**; verify pull-to-refresh on native and that web has a working refresh control.
- **`limit(100)` is not silent (SF):** when the loaded count == 100, render a small note "Showing your
  100 most recent meals" so the cap is visible, not invisible. (Pagination is a future follow-up, Open Q2.)
- **Card** shows: dish name, eaten-at (relative/short date), calories + the three macros, and the
  quality score if present. **No photo thumbnail in v1** — the bucket is private, so thumbnails would
  require the first `createSignedUrl` integration; deferred to keep this plan small (Open question 1).
- **Delete affordance — await-then-refetch, no optimistic rollback (resolves the arch SF):** a trailing
  "Delete" button (and/or row long-press) → **confirmation dialog** ("Delete this meal? This can't be
  undone."). On confirm:
  1. Mark the id **in-flight** (disable that row's button; ignore re-taps for an in-flight id) — this
     gates BOTH the dialog and the call, so a double-tap can't stack two confirms (SF).
  2. `await deleteMeal(id, image_path)`.
  3. On `ok` → `refetch()` to reflect server truth (the row drops out; also surfaces if the best-effort
     photo step failed → 0011 sweep backstop). On `!ok` (network/unknown/unauthorized) → surface a
     non-PII inline message ("Couldn't delete — try again"); the row simply stays (no rollback machinery,
     because nothing was optimistically removed). Clear the in-flight mark in a `finally`.
- **Confirmation cross-platform:** React Native's `Alert.alert` is the native path; **on web `Alert`
  is unreliable**, so branch to `window.confirm` on `Platform.OS === 'web'` — confirm `window.confirm`
  is available and returns a boolean before relying on it (SF). (Open question 3 if a custom modal is
  preferred.)

### 4. Wire into navigation — repurpose the Explore tab
The Explore tab is unmodified Expo starter boilerplate. **Rename the route `explore` → `history`** and
point the tab at the new screen:
- Rename `src/app/(app)/explore.tsx` → `src/app/(app)/history.tsx`; its body becomes
  `export { default } from '@/features/history/screens/history-screen';` (mirrors how routes are thin
  re-exports). Delete the starter content.
- **Both tab files (resolves B1):** `src/components/app-tabs.tsx` → `<NativeTabs.Trigger name="history">`
  label **History**; AND `src/components/app-tabs.web.tsx` line 28 → `<TabTrigger name="history"
  href="/history" …>`. Missing the `.web.tsx` file leaves web pointing at a dead `/explore` (the headline
  blocker). Reuse the existing tab icon for now (real art is a tracked obligation).
- **Grep for any other `/explore` reference** and verify expo-router maps the renamed file to `/history`
  on **both** native and web before relying on it. The home `index.tsx` stays the starter screen for now
  (out of scope; a real home/dashboard is a separate plan).

### Why this shape
Smallest change that *fully* delivers "a user can delete a logged meal from inside the app": one read
hook (copying a proven lifecycle pattern), one delete primitive (reusing the 0011 photo helper +
existing RLS/cascade — **zero backend work**), one list screen, and a tab rename that also deletes dead
starter code. Optimistic-with-rollback keeps the UI snappy without risking a stuck row. The photo
cleanup closes the 0011 NIT so `delete-meal` doesn't manufacture new orphans.

## Files to change
- `src/features/history/lib/use-meal-history.tsx` — **NEW**: owner-scoped, newest-first read of
  `meal_logs` display columns; `use-profile` lifecycle discipline; `{ loading, meals, error, refetch,
  removeLocal, restoreLocal }`; no-PII logging.
- `src/features/history/lib/delete-meal.ts` — **NEW**: `deleteMeal(id, imagePath)` → owner-scoped row
  delete (cascades `meal_items`) then best-effort `deleteMealPhoto`; idempotent; typed-kind result;
  no-PII logging.
- `src/features/history/screens/history-screen.tsx` — **NEW**: `FlatList` of meal cards with
  loading/empty/error+retry/pull-to-refresh; per-row delete with confirmation, optimistic removal +
  rollback, in-flight guard; web `window.confirm` branch.
- `src/app/(app)/explore.tsx` → **RENAME** to `src/app/(app)/history.tsx` — thin re-export of the
  history screen; starter content deleted.
- `src/components/app-tabs.tsx` — **EDIT**: Explore trigger → `name="history"`, label **History**.
- `src/components/app-tabs.web.tsx` — **EDIT (B1)**: line 28 `name="explore" href="/explore"` →
  `name="history" href="/history"`. (Missed in the first draft; without it web nav breaks.)
- `src/features/legal/privacy-content.ts` — **EDIT (B2)**: update the header note ("there is NO
  self-serve delete") and the §Retention-and-deletion copy to disclose in-app per-meal deletion; keep
  account/bulk deletion email-routed. Copy-only, no schema.
- `src/features/capture/lib/delete-meal-photo.ts` — **NO CHANGE**; reused as-is. Confirm its import
  path (`@/lib/supabase`) and `Promise<void>` contract fit the new caller.

## Data model / schema impact
**None.** Verified against `20260619102510_initial_schema.sql`:
- `meal_logs_delete` policy already exists: `for delete using (auth.uid() = user_id)` — owner-scoped
  delete is enforced by RLS; no policy change.
- `meal_items.meal_log_id … references public.meal_logs (id) on delete cascade` — children are removed
  automatically when the parent row is deleted; no manual child delete.
- `image_path` is the bucket-relative `{uid}/{name}` key (UNIQUE), exactly what `deleteMealPhoto`
  expects; the existing owner-scoped `storage.objects` DELETE policy authorizes the client remove.
- No new tables/columns/indexes/RPCs/secrets. The existing `meal_logs_user_eaten_idx (user_id,
  eaten_at desc)` already serves the list query.

## Edge cases & failure modes
- **Empty history** (new user, zero meals) → explicit empty state, not a blank screen or spinner.
- **Loading / fetch error** → spinner, then a Retry that re-runs the query; never assume a shape on error.
- **Sign-out mid-fetch or mid-delete** → `mounted`/`active` guards (copied from `use-profile`) prevent
  setState-after-unmount; a delete in flight when the session ends just fails `unauthorized`/`network`
  and is swallowed (the row is already optimistically gone; on next sign-in the refetch reconciles).
- **Delete fails (network/transient)** → optimistic row is **restored** via `restoreLocal`, non-PII
  message shown; no half-deleted UI.
- **Idempotent re-delete** (double-tap, or row already deleted on another device) → 0 rows affected is
  treated as success; the in-flight guard also blocks the obvious double-tap.
- **Photo already vanished** (0011 sweep reaped it, or it was never uploaded / `image_path` null) →
  `deleteMealPhoto` swallows the miss; null path skips the photo step. No dangling row, no error.
- **Photo delete fails but row delete succeeded** → acceptable: the meal is gone from the user's view;
  the now-orphaned blob is reaped by the 0011 daily sweep within grace+1 day. (We never do the inverse.)
- **Totals/aggregates** → none exist yet (no screen aggregates `meal_logs`); deleting a row needs no
  recompute. A future dashboard will read live, so it'll reflect the deletion automatically. Noted so a
  later plan doesn't assume a cached total to patch.
- **Large list** (> limit) → bounded `limit(100)` newest-first; older meals simply aren't shown in v1
  (Open question 2 / future pagination). Logged as a known v1 cap, not silent.
- **Offline** → fetch shows the error+retry state; delete fails transient → rollback. No crash.
- **Web vs native confirm** → `Platform.OS === 'web'` uses `window.confirm`; native uses `Alert.alert`.
- **Stale list after delete elsewhere** → pull-to-refresh / post-delete `refetch` reconciles.

## Test / verify plan
- **Typecheck/lint:** `npx tsc --noEmit` clean; `npx expo lint` clean.
- **Web run (Expo web, `localhost:8081`):**
  1. Save a meal via Capture → open **History** → the meal appears (correct dish/calories/macros/date).
  2. Save a second meal → it appears **above** the first (newest-first).
  3. **Delete** a meal → confirm dialog → on confirm the row disappears; verify in the Supabase
     dashboard that the `meal_logs` row is gone, its `meal_items` are gone (cascade), and the photo is
     gone from the `meal-photos` bucket.
  4. **Delete with the photo already removed** (delete the object in the dashboard first, or use a row
     whose photo the 0011 sweep reaped) → delete still succeeds, no error surfaced.
  5. **Cancel** the confirm dialog → nothing is deleted.
  6. **Empty state**: a fresh/zero-meal account shows the empty message.
  7. **Error/Retry**: simulate a failed fetch (offline) → error state → Retry recovers when back online.
  8. **Optimistic rollback**: force a delete failure (offline mid-delete) → the row reappears + message.
- **RLS sanity** (structural, no cross-account UI needed): the delete is `auth.uid() = user_id`; a
  forged id for another user's row affects 0 rows. Optionally confirm via a second account in the
  dashboard that one user can't see/delete another's meal.
- **Spot-check logs:** only typed kinds / structural outcomes — never dish names, paths, or uids.
- **Real-device (deferred, tracked):** confirm `Alert.alert` confirmation + delete on the user's iPhone
  in a later session (bundles with the 0007 real-camera device pass).

## Rollout
1. Build the three new files + the route rename + **both** tab edits (`app-tabs.tsx` + `app-tabs.web.tsx`,
   B1) + the privacy-copy edit (B2). No backend work.
2. `npx tsc --noEmit` + `npx expo lint` clean.
3. Web-verify scenarios 1–8 above, **including** that the History tab opens on web (`/history`, B1) and
   the privacy screen reads correctly.
4. Append `docs/JOURNAL.md`; mark this plan Done; commit straight to `main` and push.
5. **No migration, no secrets, no function deploy** — purely client. Nothing to set out of band.
6. Note the still-open obligations this advances but does not close: full account/bulk data-deletion
   (still email-routed), meal **edit**, daily totals/dashboard, photo **thumbnails** (signed URLs),
   real-device pass, real tab art.

## Open questions
1. **Photo thumbnails in the list?** The bucket is private, so showing the meal photo needs the first
   `createSignedUrl` (or a batch `createSignedUrls`) integration + caching. **Recommendation: defer** —
   v1 is a text card (dish/calories/macros/quality/date); thumbnails are a fast follow once the list
   exists. Cheap to add later; keeps this plan small and avoids a new signed-URL surface.
2. **List bound / pagination.** `limit(100)` newest-first for v1. Is that enough, or do we want
   infinite scroll now? **Recommendation: 100 + a noted follow-up**; revisit when a real user nears it.
3. **Confirmation UI. RESOLVED → `Alert.alert` (native) + `window.confirm` (web) for v1** (verify
   `window.confirm` returns a boolean). A themed modal is nicer but separate work; revisit if design wants it.
4. **Repurpose Explore vs. add a 5th tab. RESOLVED → repurpose** the throwaway Explore tab into History
   (rename `explore` → `history` in the route file AND **both** tab components, B1; delete boilerplate).
   The `/explore` route goes away by design.
5. **Optimistic vs. awaited delete. RESOLVED → await-then-refetch** (drop the optimistic rollback, per
   the arch SF): simpler, matches the codebase, and removes a cluster of rollback/sign-out edge cases.
   Optimistic render is a noted v2 option if single-row delete ever feels slow.

---

## Review
_Multi-agent review (4 lenses: correctness, architecture, edge cases, data/privacy),
2026-06-24. Consolidated & deduped._

**Verdict: NEEDS CHANGES → 2 blockers. → RESOLVED 2026-06-24: both blockers + the should-fixes are
folded into the body above (`(resolves Bn)` / `(SF)` markers); status is now Approved.** The plan is
sound and on-grain (feature folder, copied hook lifecycle, RLS+cascade reuse, 0011 photo helper reuse).
The two real blockers were both *missed surfaces*, not design flaws: the route rename forgot the web
tab file, and shipping in-app delete contradicts the published privacy policy. The headline simplification
— dropping the optimistic hook mutators for plain await-then-refetch — also dissolves a cluster of
edge-case findings (rollback races, sign-out-mid-delete ghost rows, idempotent-restore confusion).

### BLOCKER
- **B1 — The route rename breaks web navigation (the web tab file was missed).** (Correctness.) The plan
  renames `explore.tsx` → `history.tsx` and edits `app-tabs.tsx`, but there is **also**
  `src/components/app-tabs.web.tsx` whose line 28 hardcodes `<TabTrigger name="explore" href="/explore">`.
  Renaming the route file + only the native tab leaves web pointing at a dead `/explore`. **Resolution:**
  update **both** tab files — `app-tabs.tsx` (`name="history"`) and `app-tabs.web.tsx` (`name="history"
  href="/history"`); grep for any other `/explore` reference; verify expo-router maps the renamed file to
  `/history` on both native and web. (§Files, §4.)
- **B2 — Shipping in-app delete contradicts the published privacy policy.** (Data/privacy.) `privacy-
  content.ts` states verbatim "there is **NO self-serve delete**" (header) and "To delete your data or
  your account, email us…" (§Retention and deletion). Adding per-meal in-app delete makes the policy
  false. **Resolution:** update `privacy-content.ts` in this plan — the header note and the §Retention
  copy must disclose "you can delete individual meals from within the app," while keeping account/bulk
  deletion email-routed (still true). This is a copy edit (no schema). (§Non-goals, §Files, §Rollout.)

### SHOULD-FIX (folded in)
- **Drop the optimistic `removeLocal`/`restoreLocal` hook mutators; use await-then-refetch.** (Arch +
  Correctness + Edge.) Neither `useProfile` nor `useOnboardingStatus` expose state mutators; bolting them
  on couples the hook to one UI pattern and spawns rollback/sign-out/idempotent-restore edge cases (a
  row deleted on another device returns 0-rows = success, but the rollback path would resurrect it). For
  a single-row delete the optimistic perf win is negligible. **Fix:** hook exposes only `{ loading,
  meals, error, refetch }`; the screen awaits `deleteMeal`, then `refetch()` on success / shows a non-PII
  message on failure. Removes the rollback machinery entirely. (§1, §3.)
- **`deleteMeal` needs a timeout.** (Edge.) `saveMeal` wraps its RPC in a 20 s `withTimeout`; `deleteMeal`
  has none → a stalled delete hangs. **Fix:** wrap the row-delete in a ~15 s timeout; timeout → `network`.
- **Pin the idempotency classification.** (Correctness + Data.) Supabase `.delete().eq('id', id)` returns
  `{ error: null }` whether 0 or 1 rows matched; `.select()`/count is **not** needed. **Fix:** `deleteMeal`
  is `ok: true` iff `error === null` (0-rows = already-gone = success); classify only `!ok` by SQLSTATE /
  transport error. (§2.)
- **`imagePath: string | null` explicit in the signature.** (Edge + Data.) `meal_logs.image_path` is
  nullable. **Fix:** signature takes `string | null`; a null path skips the photo step (no error). (§2.)
- **The read's `.eq('user_id', userId)` is MANDATORY, not perf-only.** (Data.) The plan framed it as an
  index optimization; if RLS were ever misconfigured an unfiltered read leaks other users' meals. **Fix:**
  state the explicit owner filter is required defense-in-depth (and also uses the index); never remove it
  without a security review. (§1.)
- **Enforce the column allowlist with a `Pick<>` type.** (Data.) `select('*')` would pull `confidence,
  quality_factors, assumptions, verified` (health PII the card doesn't need). **Fix:** type the read as
  `Pick<…Row, 'id'|'dish_name'|'eaten_at'|'image_path'|'total_calories'|'total_protein'|'total_carbs'|
  'total_fat'|'quality_score'>` so over-fetch is a type error; never `select('*')`. (§1.)
- **Tighten `deleteMeal` logging.** (Data.) **Fix:** never log the `id`, `imagePath`, PostgrestError
  message/details, or data length — only `[deleteMeal] <kind>` (e.g. `ok` / `network`). (§2.)
- **Verify/guard web for `RefreshControl` + `window.confirm`.** (Edge + Arch.) Neither is used in the app
  yet; `RefreshControl` may no-op on web and `window.confirm` availability isn't proven. **Fix:** add a
  web check to the verify plan; platform-guard pull-to-refresh (and keep a visible Retry as the web refresh
  path); confirm `window.confirm` returns a boolean before relying on it. (§3, §Test.)
- **Don't silently hide meals past `limit(100)`.** (Edge.) **Fix:** when the returned count == 100, show a
  small "Showing your 100 most recent meals" note so the cap is explicit, not invisible. (§3.)
- **Reconcile after delete.** (Edge.) **Fix:** on `ok`, fire a quiet `refetch()` to reflect server truth
  (also surfaces if the photo step failed → 0011 sweep backstop). (§3.)

### NIT (folded or noted)
- `keyExtractor={(m) => m.id}` — `id` is a stable UUID PK; document it. (Edge.)
- Photo delete is fired from the **same authed session** before any re-auth; if the session ends, the blob
  is the 0011 sweep's job (don't fire after a token refresh). (Data.)
- `deleteMealPhoto` is fire-and-forget with no timeout — acceptable; the 0011 daily sweep is the backstop.
  Confirm the sweep is live in the deploy target (it is — plan 0011 Done). (Data + Edge.)
- `deleteMeal` lives in `history/lib` (history owns the delete *flow*), not `capture/lib` (which owns the
  photo helper) — note the rationale in the file header. (Arch.)
- Web confirm dialog isn't theme-matched — acceptable for v1 (Open Q3); a themed modal is separate work.
- Thumbnails (deferred, Open Q1) will add `createSignedUrls` cost (~1–2 calls/load + TTL tuning) — budget
  when added. (Data.)

### Affirmations (no change)
- The owner-scoped delete is correctly enforced by the existing `meal_logs_delete` RLS policy
  (`auth.uid() = user_id`) and the `meal_items … on delete cascade` — **zero backend work** is right.
- Reusing the 0011 `deleteMealPhoto` helper and copying the `use-profile` lifecycle discipline are the
  correct on-grain choices. Repurposing the throwaway Explore tab (vs. a 5th tab) is the right call.
- "Row first, photo second" ordering is correct: a failed row-delete must never delete the photo.

## Execution log
### 2026-06-24 (session 12) — built; static-verified; awaiting user web-verify
Implemented strictly per the approved plan; no design deviations.
- **NEW `src/features/history/lib/use-meal-history.tsx`** — `{ loading, meals, error, refetch }` only
  (no optimistic mutators). Copies `useProfile`'s lifecycle discipline (mounted ref + active flag +
  `(userId, reloadKey)`-keyed outcome). Mandatory `.eq('user_id', userId)` + newest-first + `limit(100)`.
  Column allowlist enforced by the exported `MealCard = Pick<…Row, …>` type; a `SELECT_COLUMNS` string is
  the single source. No-PII logging.
- **NEW `src/features/history/lib/delete-meal.ts`** — `deleteMeal(id, imagePath: string | null)`: row
  delete (RLS owner-scoped; `meal_items` cascades) wrapped in a 15 s `withTimeout` (mirrors `saveMeal`);
  `ok` iff `error === null` (0-row = already-gone = success); SQLSTATE `28000/42501` → `unauthorized`,
  thrown/timeout → `network`. Best-effort `deleteMealPhoto(imagePath)` fired (not awaited) only after the
  row delete succeeds, skipped on null path. Logs only the typed kind.
- **NEW `src/features/history/screens/history-screen.tsx`** — `FlatList` (`keyExtractor` = `id`) with
  loading / empty / error+Retry; delete is **await-then-refetch** (no rollback); in-flight `Set<id>`
  gates both the confirm dialog and the call; `Alert.alert` native / `window.confirm` web; pull-to-refresh
  via `RefreshControl` on native, header **Refresh** button as the web path; "Showing your 100 most
  recent meals" note when at the limit; non-PII inline "Couldn't delete" message; `mounted` ref.
- **RENAME `(app)/explore.tsx` → `(app)/history.tsx`** (thin re-export). **EDIT both tab files**
  (`app-tabs.tsx` + `app-tabs.web.tsx` → `name="history"` / `href="/history"`, label History) — B1.
  Updated the `(app)/_layout.tsx` comment. Grepped: no remaining `/explore` references in code.
- **EDIT `privacy-content.ts`** (B2) — header note + §Retention now disclose in-app per-meal deletion
  (removes the meal + its photo); account/bulk deletion stays email-routed.
- **Verified (static):** `npx tsc --noEmit` PASS; `npx expo lint` exit 0 clean; **web bundle compiles
  (HTTP 200, ~7.1 MB, no error)** — the renamed `/history` route + new screen/hook/primitive + both tab
  edits all bundle cleanly on web.
- **User web-verified (2026-06-24):** the user confirmed the flow works end-to-end in a logged-in
  browser session ("درسته همه چی"). **Plan 0012 DONE.** Real-device `Alert.alert` pass remains deferred
  (bundles with the 0007 device session); thumbnails / pagination / meal-edit are tracked follow-ups.
