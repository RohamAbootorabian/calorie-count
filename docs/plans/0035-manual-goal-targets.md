# Plan: Manual (custom) calorie + macro targets

- **Status**: ~~Draft~~ → ~~In Review~~ → ~~Approved~~ → ~~In Progress~~ → **Done**
- **Created**: 2026-09-14
- **Plan #**: 0035

## Problem / Goal
Targets are always the TDEE-formula output (`computeGoals`). Users want to set their **own**
calorie + macro targets (a coach's numbers, a specific cut, etc.). Add a "custom targets" mode to
the Settings → Daily goals editor: toggle it on, type calories/protein/carbs/fat directly, save —
and the dashboards (which already read the stored `goals` columns) reflect them.

"Done": a toggle in Daily goals; ON → four editable target fields (seeded from the current
targets) that are saved verbatim; OFF → today's computed behavior. The choice persists (reloading
Settings shows the same mode + numbers), and the dashboards use whatever is stored.

## Non-goals
- No change to the TDEE formula (`tdee.ts`) or to how `useDailyGoals`/dashboards READ goals (they
  already read the stored columns — manual values flow through automatically).
- Not adding custom targets to the onboarding wizard (new users compute from TDEE;
  `is_custom` defaults false). They can switch to custom later in Settings.
- No per-day / per-meal target overrides; this is the single daily target row.

## Proposed approach

### Data — one boolean on `goals`
Migration `..._goals_is_custom.sql`: `add column is_custom boolean not null default false`.
Existing rows backfill to `false` (computed) — no behavior change for anyone until they opt in.
RLS unchanged (owner policy already covers the row). Regenerate `src/types/database.ts`.
Why persist it: the stored `calories/macros` are authoritative for the dashboards regardless, but
the **editor** must know not to silently recompute/overwrite a manual row on the next open — the
flag is what tells it "these numbers are user-set."

### Pure helper — new `src/features/auth/lib/custom-goals.ts`
- Bounds mirroring the DB checks: `CAL_MIN=1, CAL_MAX=20000`, `MACRO_MIN=0, MACRO_MAX=5000`.
- `validateTargetCalories(raw): string | undefined`, `validateTargetMacro(raw, noun): string | undefined`
  (integer, in range; friendly copy; never echo the value) — reuse `parseNumber` from onboarding-form.
- Pure, no I/O, no logging.

### Settings — Daily goals editor (`settings-screen.tsx`)
- Load `is_custom` with the row (its `useGoalsRow` already `select('*')`).
- New state: `customTargets: boolean` + four manual input strings (`calInput`, `proteinInput`,
  `carbsInput`, `fatInput`). Seed on row load: `customTargets = row.is_custom`; seed the four inputs
  from the stored `row.calories/protein/carbs/fat` (the last targets, computed or manual) so turning
  the toggle on starts from sensible numbers.
- UI: a "Use custom targets" toggle (No/Yes, the same Button-row idiom). When ON, render the four
  editable target inputs (centered, numeric) with inline validation, and HIDE the auto `GoalsReview`
  card (or show it only in computed mode). Body inputs (age/sex/height/weight/activity/goal) stay
  visible + editable + saved in BOTH modes (they remain the user's record and the computed source).
- Save (`handleSaveGoals`):
  - Always require a valid `metricInput` (body) — unchanged (body columns are NOT NULL-ish and are
    always written).
  - `customTargets` ON → additionally validate the four manual fields; the saved targets are the
    parsed manual values; `is_custom = true`.
  - `customTargets` OFF → saved targets are `computeGoals(metricInput)` (today's behavior);
    `is_custom = false`.
  - Upsert `goals` with `{ user_id, calories, protein, carbs, fat, is_custom, weight_goal,
    activity_level, age, sex, height_cm, weight_kg }` (`onConflict: 'user_id'`, unchanged shape +
    `is_custom`).
- Save-enabled: OFF → `!!computed` (today); ON → manual fields valid AND `metricInput != null`.

## Files to change
- `supabase/migrations/..._goals_is_custom.sql` — NEW (`is_custom boolean not null default false`).
- `src/types/database.ts` — regenerated (goals gains `is_custom`).
- `src/features/auth/lib/custom-goals.ts` — NEW (bounds + validators).
- `src/features/auth/screens/settings-screen.tsx` — toggle + manual inputs + seed + save logic.

## Data model / schema impact
One boolean column on `goals` (`is_custom`, default false). No RLS/policy/index change; the
existing `calories/protein/macros` check constraints already bound the manual values (client
validators mirror them so a valid form is never rejected by Postgres).

## Edge cases & failure modes
- **Toggle ON with no prior manual values:** inputs seeded from the stored/last targets → never blank.
- **Manual out-of-range / non-numeric:** client validator blocks save (mirrors the DB check → the
  `23514` path is unreachable from the app; keep a friendly classify as a backstop).
- **Switch custom→computed and save:** targets recompute from body; `is_custom=false`; the manual
  numbers are intentionally discarded (that's the point of switching back).
- **Editing body while custom ON:** body is still saved (record), but the saved targets stay the
  manual numbers (body doesn't override them while custom).
- **Dashboards:** read stored columns → reflect manual values with no change (verify daily/weekly/
  monthly rings use the stored goal, which they do via `useDailyGoals`).
- **Onboarding:** writes no `is_custom` → DB default false → computed, unchanged.
- **Privacy:** targets are the user's own numbers (not health-note free text); existing no-log
  discipline for body metrics is preserved (never log the values).

## Test / verify plan
- `npx tsc --noEmit` → 0; `npx expo lint` → 0; `npx expo export --platform web` → success.
- Migration: `npx supabase db push`; regenerate types; `tsc` still 0.
- Manual: toggle custom ON, set calories 2200 / P180 / C200 / F70, save → dashboards show 2200 goal
  + rings use it; reopen Settings → custom still ON with the same numbers. Toggle OFF + save →
  reverts to computed. Out-of-range value → inline error, save blocked.

## Rollout
1. `supabase db push` (add column) → regenerate `database.ts`.
2. Ship client.
Order safe: the column exists before the client reads/writes it. No secret/function deploy. Commit to `main`.

## Open questions
- Should custom mode also let the user IGNORE body inputs entirely? For v1, body stays required
  (it's already populated from onboarding and is the computed-mode source). Default: keep required.

---

## Review
Full four-agent review (correctness, architecture, edge, data/privacy). **Verdict: NEEDS CHANGES →
resolved → APPROVED.** No RLS/secret/cost concerns; `is_custom` boolean is the right, robust model;
dashboards already read the stored columns (no recompute).

### BLOCKER / must-fix (resolved)
- **Decimal calories drift.** `calories` is an `integer` column but `parseNumber`/`validateBoundedNumber`
  accept decimals → Postgres silently rounds → stored ≠ typed. → **Resolved:** target validators
  parse via a separator-stripping `parseTarget` and **require `Number.isInteger`**; all four are
  `Math.round`ed at save (belt-and-suspenders). (Also fixes the locale `2,200`→`2.2` bug: strip
  `,`/spaces before parse.)

### SHOULD-FIX (resolved)
- **Custom save must not be gated on a valid body.** → In custom mode the body editor is **hidden**
  and the upsert **omits the body columns entirely** (on-conflict UPDATE leaves them untouched — the
  goals row always exists when this editor shows, and `weight_goal`/`activity_level` NOT NULL are
  preserved). Custom save-enable = manual targets valid only; computed save unchanged (needs body).
- **Save button `disabled` must be mode-aware** (it currently keys off `!computed`): →
  `disabled = customTargets ? !manualValid : !computed`.
- **Safety-floor asymmetry / no clamp feedback in custom mode.** → a **non-blocking** soft warning
  when custom calories fall below `MIN_CALORIES` (reused from `tdee.ts`); save still allowed
  (custom is intentional).
- **Reuse over new code:** the two target validators live in a small pure `custom-goals.ts`
  (bounds + `parseTarget` + `validateTarget`) — reusing the bounds concept, not re-implementing
  range logic ad hoc. (Architecture also advised extracting a `DailyGoalsCard`; **deferred** to a
  follow-up to avoid refactoring the working body editor in the same pass — noted as tech debt.)
- **Re-seed manual inputs on toggle.** → seeded once from the row on load; when toggling custom ON,
  if the fields aren't user-edited (a `manualDirty` ref), re-seed from the live computed targets
  (else stored) so they're never a stale preview.

### NIT (addressed)
- Migration uses `add column if not exists`; timestamp sorts after the initial schema.
- Computed-mode save writes `is_custom: false` explicitly (clears a prior custom flag).
- Onboarding still omits `is_custom` (DB default false) — safe (it only runs with no existing row);
  noted so a future re-onboarding/reset path writes it explicitly.
- Reuse the `SelectGroup`/Button-row idiom for the toggle; centered numeric inputs (consistent);
  no manual `useMemo`/`useCallback` (React Compiler ON); seed via the existing one-shot `seededGoals`
  effect (plain seeded state, not derive-in-render).

## Execution log
Implemented per the approved plan + resolutions.
- `supabase/migrations/20260914120000_goals_is_custom.sql` — `add column if not exists is_custom
  boolean not null default false`. Applied via `db push`; `database.ts` regenerated.
- `src/features/auth/lib/custom-goals.ts` — NEW pure helper: `CAL_MIN/MAX`, `MACRO_MAX`,
  `parseTarget` (strip separators), `validateTargetCalories`/`validateTargetMacro` (integer + range,
  never echo the value), `isBelowSafeFloor`.
- `src/features/auth/screens/settings-screen.tsx` — Daily goals: a "Use custom targets" toggle;
  custom mode shows four centered integer inputs (seeded/re-seeded, `manualDirty` ref) + a soft
  sub-floor warning and HIDES the body editor + GoalsReview; computed mode unchanged. `handleSaveGoals`
  branches: custom → upsert `{calories,protein,carbs,fat (rounded), is_custom:true}` (body omitted);
  computed → today's write + `is_custom:false`. Save button `disabled` is mode-aware.
- **Verify:** tsc 0 · expo lint 0 · web export 0; migration applied.
