# Plan: Onboarding wizard + TDEE → goals (S1 · piece 2)

- **Status**: Done (2026-06-19) — executed, verified (tsc/lint/web bundle + tdee
  reference checks green; manual web walkthrough confirmed by user), shipped to `main`.
  Approved 2026-06-19 — multi-agent review passed; 5 blockers resolved in-plan; all 5
  open questions decided (raw inputs → `goals`; metric-only v1; macro split + 1200
  floor confirmed; no test framework).
- **Created**: 2026-06-19
- **Plan #**: 0005

## Problem / Goal
A freshly signed-up user lands in the `(app)` tabs with **no daily targets** — the
`goals` row doesn't exist yet, so nothing downstream (diary totals, progress rings)
has anything to compare against. We need a **first-run onboarding wizard** that
collects the user's body metrics + intent, computes daily calorie + macro targets
via a TDEE formula, and writes the `goals` row. After that, the user goes straight
to the tabs on every launch.

**Done looks like:**
- A signed-in user **without** a `goals` row is routed into the onboarding wizard,
  not the tabs.
- The wizard collects **age, sex, height, weight, activity level, weight goal**
  (`lose`/`maintain`/`gain`), respecting the profile's `units` (metric/imperial).
- On finish, it computes **daily calories + protein/carbs/fat** (Mifflin–St Jeor +
  activity multiplier + goal adjustment) and **inserts the `goals` row**; the raw
  inputs are persisted too (see schema decision) so piece 3 can edit/recompute.
- The gate then lets the user into `(app)`; on next launch they skip onboarding.
- TDEE math lives in a **pure, unit-tested module**; `tsc` + `lint` pass; verified
  on web.

## Non-goals
- **Auth screens** — S1 piece 1 (done, plan 0004).
- **Profile & Settings (editing goals/units/display name later)** — S1 piece 3.
  This piece only *creates* the first goals row; editing is piece 3.
- **Camera / meal analysis / diary / trends** — other modules.
- **Re-onboarding / "redo my goals" UX** — piece 3.
- **Localizing the formula or supporting athlete/clinical formulas** — one
  reasonable default (Mifflin–St Jeor) for v1.
- **Changing RLS** — existing owner-scoped policies on `profiles`/`goals` already
  cover every read/write here.

## Proposed approach

### Where it lives
Per ARCHITECTURE.md/MODULES.md, onboarding belongs to the S1 module
(`src/features/auth/`). **Flat structure** matching piece 1 (SF1 — no `onboarding/`
subtree): `src/features/auth/screens/onboarding-wizard.tsx`, plus
`src/features/auth/lib/{tdee.ts, use-onboarding-status.ts, onboarding-form.ts}`
alongside `auth-utils.ts`. The thin route lives in `src/app/(onboarding)/`.
**PII discipline (SF4):** never log age/sex/height/weight or intermediate BMR/TDEE
anywhere (console/errors/analytics); validation shows per-field copy, never the
rejected value. Goals/onboarding input types stay local to the feature lib — **not**
in `nutrition.ts`, which is meal-only (SF2).

### The routing gate (signed-in → needs-onboarding vs. ready) — root gate (B1)
Today the root gate (`src/app/_layout.tsx`) is binary: `session` → `(app)`, else
`(auth)`. We add a **third state in the same trunk root gate** (resolved B1 — Option
B): a `(onboarding)` route group, gated by three complementary `Stack.Protected`
guards so exactly one branch renders once everything resolves:
- `guard={!session}` → `(auth)`
- `guard={!!session && needsOnboarding}` → `(onboarding)`
- `guard={!!session && !needsOnboarding}` → `(app)`

The **goals-existence check** is the feature hook `useOnboardingStatus()` →
`{ loading, needsOnboarding, error, refetch }` (B2), living in
`src/features/auth/lib/` and consumed by the root layout (the composition root).
Backed by `select user_id from goals where user_id = auth.uid()` via `maybeSingle()`
on the `supabase` singleton; RLS guarantees a user only sees their own row. Query on
mount + when `user?.id` changes.

**No flash / no loop (B1/B2):** while `auth.loading || onboarding.loading` → render
`null` (native-splash pattern, same as today). On `onboarding.error` (offline) →
render a full-screen **Retry** (never auto-route into onboarding — that could create
a duplicate row). After a successful Save, the wizard calls `refetch()`, which flips
`needsOnboarding=false` and the declarative gate admits `(app)` — no manual navigation.

### The wizard
A single screen with a small **step state machine** (not separate routes) — steps:
1. **About you** — age, sex (`male`/`female`; drives Mifflin–St Jeor).
2. **Body** — height + weight, with inputs labeled per `units` (cm/kg vs. in/lb).
3. **Activity** — 5 levels (`sedentary`…`very_active`).
4. **Goal** — `lose` / `maintain` / `gain`.
5. **Review** — show computed daily calories + macros, then **Save**.

Built entirely on `@/shared/ui` (`Screen`, `Text`, `Input`, `Button`, `Card`).
Selection controls (sex/activity/goal) reuse **`Button` as full-width selectable
rows** — selected = `primary`, unselected = `secondary` — **no new primitive in v1**
(SF3). A back/next footer drives the step index; per-step validation (field-level,
clears on change, piece-1 style) gates Next; step state is in-memory only (no
mid-wizard persistence). The mounted-ref guard (SF6) wraps the Save step's
post-`await` setState.

### TDEE math — `lib/tdee.ts` (pure). `computeGoals` always takes metric (N4).
**Strict order so the macros-sum-to-calories invariant holds and nothing can go
negative/NaN (B3):**
1. **BMR** (Mifflin–St Jeor): `10*kg + 6.25*cm − 5*age + s`, `s = +5 (male) /
   −161 (female)`.
2. **TDEE** = BMR × activity multiplier (sedentary 1.2, light 1.375, moderate 1.55,
   active 1.725, very_active 1.9).
3. **Goal adjustment:** lose ×0.80, maintain ×1.0, gain ×1.15.
4. **Clamp to the safe floor (1200 kcal)** → then **round calories to nearest 10**.
   Set `clampedToMinimum` if the floor fired (N5 — shown on Review).
5. **Macros from the clamped/rounded calories:** `protein = round(1.8 * kg)`;
   `fat = round(0.25 * calories / 9)`; **`carbs = max(0, floor((calories −
   4*protein − 9*fat) / 4))`** so carbs absorbs all rounding and can never be
   negative. (Invariant: `4*protein + 9*fat + 4*carbs ≈ calories`.)
- **Guards:** every division guarded; if any input ≤ 0 or any output is
  `NaN`/`Infinity`, throw — never write it (the form already blocks this, but
  defense in depth against the plan-0001 Postgres NaN trap).
- Exposes `computeGoals(metricInput): { calories, protein, carbs, fat, bmr, tdee,
  clampedToMinimum }`. No I/O, no React — fully testable.

### Writing goals (B5)
On Save: `supabase.from('goals').upsert({ user_id, calories, protein, carbs, fat,
weight_goal, activity_level, age, sex, height_cm, weight_kg }, { onConflict:
'user_id' })`. Upsert (not insert) so a retry is idempotent (no dup row). `user_id =
useUser().user.id` (null-guarded before the call, N6). The existing `goals`
INSERT/UPDATE RLS policies enforce `auth.uid() = user_id` via `WITH CHECK`, so a
wrong id is rejected at the policy layer — **do not add `DEFAULT auth.uid()` to
`goals.user_id`** (unlike `meal_logs`); the client supplies it. After success the
wizard calls `useOnboardingStatus().refetch()` → `needsOnboarding=false` → the gate
admits the tabs (no manual navigation).

## Files to change
- **Migration** `supabase/migrations/<ts>_goals_body_inputs.sql` — add the four
  bounded columns to `goals` (B4 SQL below).
- `src/features/auth/lib/tdee.ts` — NEW: pure TDEE + macro math (B3).
- `src/features/auth/lib/use-onboarding-status.ts` — NEW: `{ loading,
  needsOnboarding, error, refetch }` goals-existence hook (B2).
- `src/features/auth/lib/onboarding-form.ts` — NEW: metric input types + per-step
  validators (pure; bounds mirror B4) + imperial→metric conversion helper (N4).
- `src/features/auth/screens/onboarding-wizard.tsx` — NEW: the step machine + UI.
- `src/app/(onboarding)/_layout.tsx` + `src/app/(onboarding)/index.tsx` — NEW route
  group + thin route → `<OnboardingWizard/>`.
- `src/app/_layout.tsx` — extend the root gate with the third `(onboarding)` guard
  (B1) + the loading/error rendering. Trunk routing edit; keep it minimal.
- `src/types/database.ts` — regenerate after the migration (N2).

## Data model / schema impact
**A migration is required.** The `goals` table stores only *computed* targets;
neither `goals` nor `profiles` has **age/sex/height/weight**, so piece 3 ("edit
goals") couldn't recompute TDEE without re-asking everything. **DECIDED (OQ1): add
the raw inputs to `goals`** — they're the inputs that produced the targets, and
`goals` is already 1-row-per-user (`profiles` stays identity/preferences only).

The migration (NaN-safe bounded `check`, plan-0001 pattern — B4):
```sql
alter table public.goals
  add column if not exists age       int     check (age between 13 and 120),
  add column if not exists sex       text    check (sex in ('male','female')),
  add column if not exists height_cm numeric check (height_cm between 50 and 272),
  add column if not exists weight_kg numeric check (weight_kg between 20 and 500);
```
- **Store normalized metric** (cm/kg) always; conversion happens at the UI edge;
  `profiles.units` is *display* only (N4).
- Columns **nullable** at creation (existing rows have none); a completed onboarding
  always sets them, and piece 3 keeps them populated on edit (SF5 invariant).
- **No RLS changes** — existing owner-scoped policies cover the new columns; **no
  `DEFAULT auth.uid()` on `user_id`** (B5). The `set_updated_at` trigger already
  fires on `goals` updates, so the new columns bump `updated_at` automatically (N3).
- No new tables, no storage. Regenerate `database.ts` after `db push` (N2).

## Edge cases & failure modes
- **No goals row but onboarding query in-flight** → `useOnboardingStatus` returns
  `loading`; render nothing (avoid a tabs→onboarding flash). Mirrors the splash gate.
- **Goals-existence query fails (offline)** → treat as a transient error: show a
  retry rather than dumping the user into onboarding (which could create a duplicate
  on a flaky network). Upsert on `user_id` also protects against dup rows.
- **Invalid / out-of-range inputs** (age 0, negative height, absurd weight, empty) →
  per-step validation blocks Next; mirror the DB `check` bounds so a valid form can
  never be rejected by Postgres.
- **Imperial parsing** — height in ft/in vs. inches; decimals ("5.9"); locale commas.
  Decide the imperial input shape (Open Question 2) and validate it.
- **Aggressive deficit** — `lose` could push calories below a safe floor for small
  users; clamp to a minimum (e.g. 1200 kcal) and note it on Review.
- **NaN/Infinity in the formula** — guard divisions; never write NaN (Postgres
  `numeric` treats `NaN >= 0` as true — the plan 0001 lesson; rely on bounded
  `between` checks + clamp in `tdee.ts`).
- **Save partially fails / double-tap Save** → `Button` in-flight guard + idempotent
  upsert; on error show a friendly message and keep the form (don't lose inputs).
- **User signs out mid-wizard** → the gate flips to `(auth)`; mounted-ref guards
  prevent setState-after-unmount.
- **Back navigation** — hardware/web back should move between steps, not exit to
  tabs (no goals yet); the step machine owns back within the screen.

## Test / verify plan
- **`tdee.ts` reference checks** (no framework — a one-off `npx tsx` script, OQ5):
  hand-computed cases (e.g. 30 yo male, 180 cm, 80 kg, moderate, maintain → known
  kcal); goal adjustments + the 1200 floor (small user) behave; `clampedToMinimum`
  set when floored; `4*protein + 9*fat + 4*carbs ≈ calories` and carbs ≥ 0; absurd/
  empty inputs throw rather than emit NaN.
- `npx tsc --noEmit` + `npx expo lint` clean (regenerate typed routes for the new
  `onboarding` route, per the piece-1 churn lesson).
- **Manual on web** with the confirmed test user (who has **no** goals row):
  1. Sign in → routed to onboarding (not tabs).
  2. Walk the steps; bad inputs blocked; Review shows sensible numbers.
  3. Save → lands in tabs; reload → straight to tabs (goals now exist).
  4. Toggle `profiles.units` to imperial (via SQL or piece-3 later) → inputs relabel
     and convert correctly. (If units editing isn't available yet, test the metric
     path and unit-convert in the `tdee.ts` unit tests.)
  5. Offline goals-check → full-screen Retry, no accidental onboarding/dup row.
  6. Sign out mid-wizard → flips to `(auth)`, no setState-after-unmount error, no
     stray/dup `goals` row.
- Verify the written `goals` row in Supabase matches the Review screen.

## Rollout
1. Write + review this plan; resolve the schema decision (Open Question 1) **before**
   touching SQL.
2. Apply the migration: `SUPABASE_DB_PASSWORD=… npx supabase db push`, then
   `SUPABASE_DB_PASSWORD=… npx supabase gen types typescript --linked >
   src/types/database.ts`; stage + commit the regenerated file (N2).
3. Build the pure `tdee.ts` + tests, then the hook, wizard, route, and the `(app)`
   guard.
4. Verify per above; append `docs/JOURNAL.md`; mark Done; **commit straight to
   `main`** and push (project rule; sequential, no PRs).

## Open questions — all resolved during review (2026-06-19)
1. **Raw body inputs → `goals`** (not `profiles`), nullable, normalized metric. ✅
2. **Imperial: metric-only inputs for v1.** Default `profiles.units` is already
   `metric`; we store metric regardless, and the `onboarding-form` ships an
   imperial→metric helper but the **input UI surfaces metric only** in v1 (imperial
   display lands with units editing in piece 3). Shrinks this piece, zero rework
   (storage is metric either way). ✅
3. **Macro split:** protein 1.8 g/kg + fat 25 % + carbs-as-remainder for v1
   (isolated in `tdee.ts`, cheap to tune later). ✅
4. **Adjustment:** lose ×0.80 / gain ×1.15, **safe floor 1200 kcal**, clamp before
   macros (B3). ✅
5. **No test runner exists** (checked: no jest/vitest in `package.json`). For v1,
   **don't add a framework** — verify `tdee.ts` with a one-off `npx tsx`/node script
   asserting hand-computed reference cases during the verify step; adding `jest-expo`
   is its own future task. ✅

---

## Review
_Multi-agent review (4 lenses), 2026-06-19. Consolidated & deduped._

**Verdict: NEEDS CHANGES → resolved in-plan (edits applied below). 5 blockers cleared.**

### BLOCKER
- **B1 — Gate placement & race/loop safety.** (Arch #1 + Correctness #2 + Edge #1.)
  Editing `(app)/_layout.tsx` with a `<Redirect>` (Option A) both crosses into the
  trunk routing layer *and* invites a tabs↔onboarding flash / redirect loop while
  the goals query resolves. **Resolution: use Option B — a single declarative gate
  in the trunk root `src/app/_layout.tsx`** with a third route group `(onboarding)`
  alongside `(app)`/`(auth)`. The goals-existence check is a feature hook
  `useOnboardingStatus()` (lives in `src/features/auth/`) consumed by the root
  layout (the composition root). While `loading` → render `null` (native splash
  pattern); on `error` → a full-screen Retry (never auto-route); only when resolved
  do the three complementary guards pick exactly one branch. No nested redirect, no
  loop.
- **B2 — `useOnboardingStatus` lifecycle.** (Correctness #2, Edge #4.) Must return
  `{ loading, needsOnboarding, error, refetch }`; query on mount + when `user?.id`
  changes; **after a successful upsert the wizard calls `refetch()`** so
  `needsOnboarding` flips false and the gate admits the tabs. Offline/error →
  `error` set, gate shows Retry (does NOT dump the user into onboarding → avoids a
  duplicate-row attempt).
- **B3 — Clamp calories BEFORE macros; guard the math; rounding must preserve the
  invariant.** (Correctness #1, Edge #2/#3, Data #1.) Order in `tdee.ts`: (1) compute
  TDEE, apply goal adjustment, **clamp to the safe floor (1200 kcal)**, round to
  nearest 10; (2) protein = round(1.8 g/kg), fat = round(0.25·cal/9); (3)
  **carbs = floor((cal − 4·protein − 9·fat)/4)** so carbs absorbs rounding and can't
  go negative (floor at 0). Guard every division; if any input ≤ 0 or any output is
  `NaN`/`Infinity`, fail loudly (never write it). A `clampedToMinimum` flag surfaces
  on Review.
- **B4 — NaN-safe bounded CHECK constraints on the new columns.** (Data #1, Edge #2.)
  Per the plan-0001 lesson (`NaN >= 0` is true in Postgres), the migration MUST use
  bounded `between`:
  ```sql
  add column age        int     check (age between 13 and 120),
  add column sex        text    check (sex in ('male','female')),
  add column height_cm  numeric check (height_cm between 50 and 272),
  add column weight_kg  numeric check (weight_kg between 20 and 500)
  ```
  Client validation mirrors these exact bounds so a valid form is never rejected by PG.
- **B5 — RLS contract for the upsert.** (Data #2.) Source `user_id` from
  `useUser().user.id`; the existing `goals` INSERT/UPDATE policies enforce
  `auth.uid() = user_id` via `WITH CHECK` (plan 0001), so a wrong `user_id` is
  rejected at the policy layer. **Do NOT add `DEFAULT auth.uid()` to `goals.user_id`**
  (unlike `meal_logs`) — the client supplies it; document this so it isn't "fixed"
  later.

### SHOULD-FIX
- **SF1 — Flatten the folder.** No `onboarding/` subtree; match piece 1:
  `src/features/auth/screens/onboarding-wizard.tsx`,
  `src/features/auth/lib/tdee.ts`, `.../lib/use-onboarding-status.ts`,
  `.../lib/onboarding-form.ts`. (Arch #6.)
- **SF2 — No body-metric types in `nutrition.ts`** (it's meal-only). Keep the Goals/
  onboarding-input types local to the feature lib. (Arch #7.)
- **SF3 — Selection controls (sex/activity/goal) reuse `Button`** as full-width
  selectable rows (selected = `primary`, else `secondary`); **no new primitive** in
  v1. (Arch #2.)
- **SF4 — PII logging discipline.** Never log age/sex/height/weight or intermediate
  BMR/TDEE to console/errors/analytics; validation shows friendly per-field copy,
  never echoes the rejected value. Mirrors plan 0004's token hygiene. (Data #4.)
- **SF5 — Nullable persistence strategy.** New columns nullable at creation; once a
  user completes onboarding their row has them set; piece 3 keeps them populated on
  edit. Documented invariant. (Data #3.)
- **SF6 — Upsert robustness.** Mounted-ref guard (piece 1 SF2) on the post-`await`
  setState; on error keep the form + inputs and show a friendly message; idempotent
  upsert means a retry never dups. (Edge #5.)

### NIT
- **N1 — Resolve all open questions before SQL** (done below). (Correctness #4, Arch #3.)
- **N2 — Spell out the regen step:** after `db push`, run `supabase gen types` with
  `SUPABASE_DB_PASSWORD`, commit `src/types/database.ts`. (Correctness #3.)
- **N3 — `set_updated_at` already covers `goals`** — new columns bump `updated_at`
  automatically; no new trigger. (Data #5.)
- **N4 — Conversion contract:** `computeGoals` always takes metric (age yr, cm, kg);
  the UI converts at the edge; the DB only ever stores metric. (Data #6.)
- **N5 — `clampedToMinimum` note on Review** so a floored calorie target isn't
  confusing. (Edge #7.)
- **N6 — Null-guard `user.id`** before the upsert (defensive; mounted-ref should
  already prevent reaching it). (Edge #8.)

### Praise (reviewers concurred)
TDEE math is pure/testable and the Mifflin–St Jeor constants + activity multipliers
are correct; the macro split is sound once rounding order is fixed (B3). Strong
reuse of piece-1 patterns (mounted-ref, upsert, `@/shared/ui`, friendly errors).
Storing normalized metric regardless of display units is the right call. Edge-case
list (loading, offline, sign-out mid-wizard, double-tap) is mature.

## Execution log
_Executed 2026-06-19 (session 5)._

**Built (in plan order):**
- Migration `supabase/migrations/20260619192848_goals_body_inputs.sql` — the four
  bounded columns (B4 SQL verbatim). Applied to prod via `supabase db push`;
  regenerated `src/types/database.ts` (age/sex/height_cm/weight_kg now `… | null`).
- `src/features/auth/lib/tdee.ts` — pure `computeGoals(metricInput)`, strict B3 order
  (BMR → TDEE → goal adj → clamp@1200 → round/10 → macros, carbs absorbs rounding),
  guards throw on non-finite/≤0 in or out.
- `scripts/check-tdee.ts` — one-off `npx tsx` reference checks (OQ5). 19 assertions,
  all pass (case1 30M/180/80/mod/maintain → 2760 kcal / 144P / 77F / 372C; the 1200
  floor fires + `clampedToMinimum` for a small user; macro-sum ≈ kcal; bad inputs throw).
- `src/features/auth/lib/onboarding-form.ts` — metric input model, per-step validators
  (bounds mirror the DB checks), `toMetricInput`, imperial→metric helper (N4, for piece 3).
- `src/features/auth/lib/use-onboarding-status.tsx` — the goals-existence check.
- `src/features/auth/screens/onboarding-wizard.tsx` — 5-step in-memory machine on
  `@/shared/ui`; selection rows reuse `Button` (SF3); mounted-ref guard + idempotent
  upsert (B5/SF6); Review shows targets + clamp note (N5).
- `src/app/(onboarding)/{_layout,index}.tsx` + the third gate guard in
  `src/app/_layout.tsx` (B1, three complementary `Stack.Protected` branches; loading→
  null, signed-in+error→full-screen Retry).

**Deviations from the plan (and why):**
1. **`useOnboardingStatus` is a context (provider + hook), not a bare hook**, and the
   file is **`.tsx`** (not `.ts`). The plan said the wizard calls
   `useOnboardingStatus().refetch()` to flip the gate — but a per-component hook
   instance in the wizard can't reach the gate's state. Sharing one instance via
   `OnboardingStatusProvider` (wrapped in the root layout, inside `AuthProvider`) makes
   the stated behavior actually work. Same contract `{ loading, needsOnboarding, error,
   refetch }`; no API change for consumers.
2. **Outcome is keyed to `(userId, reloadKey)`** instead of three loose `useState`s.
   The lint rule `react-hooks/set-state-in-effect` forbids synchronous `setState` in an
   effect body; the keyed-outcome shape moves all writes into the async callback AND, as
   a bonus, makes a sign-out→sign-in-as-different-user read as "loading" (never the
   previous user's answer) and makes Retry show a loading state, not the stale error.

**Verification:** `npx tsx scripts/check-tdee.ts` → ALL PASS (19); `npx tsc --noEmit`
→ 0; `npx expo lint` → clean; `npx expo export --platform web` → bundles clean (route
group + provider compile). Manual web walkthrough (sign-in → onboarding → steps →
validation blocks bad input → Review → Save → tabs → reload stays on tabs) **confirmed
working by the user**.
