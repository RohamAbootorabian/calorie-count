# Plan: Collect allergies + conditions during Onboarding

- **Status**: ~~Draft~~ → ~~In Review~~ → **Approved** → In Progress → Done
- **Created**: 2026-09-14
- **Plan #**: 0034

## Problem / Goal
Plan 0031 added food allergies + medical conditions to the Profile screen, but a **new** user
never sees them until they dig into Settings. Add a health step to the onboarding wizard so a new
user can declare them up front (still optional, default "No"), persisted to the same `profiles`
columns, so the meal-analysis allergen flag (0031/0032) works from day one.

"Done": the wizard has a **Health** step (before Review) with the two Yes/No questions (default No),
each revealing a note box on Yes; on "Save & continue" the health info is written to `profiles`
alongside the existing `goals` write; a user who skips it (leaves both No) is unaffected.

## Non-goals
- No change to TDEE math / the goals write shape / the gating logic (goals row still gates
  onboarding completion).
- No new DB column/migration — the `profiles` health columns + constraints already exist (0031).
- No redesign of the wizard's step machine beyond inserting one step.
- No re-prompting existing users (they already have profiles rows; they use Settings).

## Proposed approach

### Reuse: extract `HealthQuestion` to a shared component
`HealthQuestion` currently lives inside `settings-screen.tsx`. Move it to
`src/features/auth/components/health-question.tsx` (presentational: `label`, `noLabel`, `yesLabel`,
`notePlaceholder`, `value`, `onSelect`, `note`, `onChangeNote`, `disabled`) and import it in BOTH
the settings screen and the wizard. No behavior change; each parent still clears its own note on
"No" and its own saved/error banner (keeps the component free of hidden side effects). Reuses the
existing `HEALTH_NOTE_MAX` + `normalizeHealthNote` (0031).

### Form model — `onboarding-form.ts`
- `OnboardingForm` gains `hasAllergies: boolean; allergiesNote: string; hasConditions: boolean;
  conditionsNote: string`.
- `EMPTY_FORM` defaults them to `false` / `''`.
- `STEPS` = `['about','body','activity','goal','health','review']` (KEEP `goal`; insert `health`
  between `goal` and `review`). **[Review fix — the draft dropped `goal`.]**
- `validateStep('health', …)` → `{}` (notes are optional; length is capped by the input's
  `maxLength`, mirrored by the DB check — no validator, same decision as 0031).
- `toMetricInput` unchanged (health is not a TDEE input → goes to a separate `profiles` write).

### Wizard — `onboarding-wizard.tsx`
- Render the `health` step: two `HealthQuestion`s wired through the existing `update()` helper;
  selecting "No" also clears that note (`update(note,'')`).
- `STEP_TITLE.health` / `STEP_SUBTITLE.health`.
- `handleSave` order (goals must remain the LAST, gate-flipping write):
  1. `computeGoals` (unchanged guard).
  2. **First** upsert `profiles` health: `{ id, has_allergies, allergies_note: has ? normalize : null,
     has_conditions, conditions_note: has ? normalize : null }` with `{ onConflict: 'id' }` (the row
     always exists via the `handle_new_user` trigger; upsert self-heals regardless). On error →
     `saveError`, stop (nothing gated yet).
  3. **Then** upsert `goals` (unchanged). On error → `saveError`, stop.
  4. `refetch()` (flips the gate to `(app)`).
  Both writes are idempotent, so a retry after a partial failure is safe.

### Settings — `settings-screen.tsx`
- Delete the local `HealthQuestion`; import the shared one. No other change.

## Files to change
- `src/features/auth/components/health-question.tsx` — NEW (extracted, shared).
- `src/features/auth/lib/onboarding-form.ts` — 4 fields + EMPTY_FORM + `health` step + validateStep.
- `src/features/auth/screens/onboarding-wizard.tsx` — health step UI + profiles health upsert in save.
- `src/features/auth/screens/settings-screen.tsx` — use the shared `HealthQuestion`.

## Data model / schema impact
None — reuses the `profiles` health columns + length/gate checks from plan 0031.

## Edge cases & failure modes
- **Skip health (both No):** notes force-nulled; profiles upsert writes `false`/`null` (a no-op vs.
  the trigger defaults) — harmless.
- **Yes then No before saving:** note cleared in state on "No"; and force-nulled in the payload —
  the DB gate check `(flag or note is null)` can never be violated.
- **Partial save (profiles ok, goals fails):** user isn't onboarded (gate = goals), retries; both
  upserts idempotent. **goals ok is impossible before profiles** because profiles is written first.
- **Signed out mid-save:** existing `mounted` guard covers post-await setState.
- **Over-long note:** `maxLength` on the input prevents it; DB check is the backstop.
- **Privacy:** health notes are health PII — never logged (validators/normalize never echo; the
  wizard already logs nothing). Unchanged posture.

## Test / verify plan
- `npx tsc --noEmit` → 0; `npx expo lint` → 0; `npx expo export --platform web` → success.
- Manual (fresh account): onboarding shows the Health step; declare an allergy → finish → it's
  saved (visible in Settings); analyzing a conflicting meal flags it (0032). Skip health (both No)
  → onboarding completes normally. Settings health section still works (shared component).

## Rollout
Pure client change. No migration/secret/deploy. Commit to `main`; user reloads (JS-only).

## Open questions
None.

---

## Review
Two focused reviewers (correctness/flow + architecture), right-sized (this mirrors the
already-reviewed 0031 fields/DB/normalize). **Verdict: NEEDS CHANGES → resolved → APPROVED.**

### BLOCKER (resolved)
- **The draft `STEPS` literal dropped `goal`.** As written it would never collect `weightGoal` →
  `computeGoals` NaN/throws → Save permanently disabled → onboarding impossible (and `validateStep`'s
  `case 'goal'` would be a compile error). → **Resolved:** `STEPS =
  ['about','body','activity','goal','health','review']` (keep `goal`, insert `health` before review).

### SHOULD-FIX (resolved)
- **Extracted `HealthQuestion` must own its styles.** It currently borrows `styles.group` +
  `styles.healthNote` from settings-screen's StyleSheet. → the shared component defines its own
  `group` + `healthNote` styles; import `HEALTH_NOTE_MAX`/`normalizeHealthNote` from `../lib/profile-form`
  (no import cycle).

### Confirmed OK
- Exhaustiveness enforced by TS: `Record<Step,…>` for titles/subtitles + `validateStep`'s no-default
  switch force the `health` entries. Step machine is index-based → no other change.
- Save ordering (profiles first, goals last as the gate) is correct + idempotent on retry; the
  partial-column upsert leaves `display_name`/`units`/`timezone` intact (row exists via
  `handle_new_user`). `update()` handles boolean + note; force-null behind No satisfies the DB gate.
- No new hooks → no React-Compiler risk; presentational component, no manual memo.

### NIT (addressed)
- Remove the now-unused `styles.healthNote` from `settings-screen.tsx` after extraction.

## Execution log
Implemented per the approved plan + resolutions.
- `src/features/auth/components/health-question.tsx` — NEW shared presentational component (owns its
  `group` + `healthNote` styles; imports `HEALTH_NOTE_MAX`/`normalizeHealthNote`… note: normalize is
  applied by callers at save, the component only enforces `maxLength`).
- `src/features/auth/lib/onboarding-form.ts` — 4 health fields on `OnboardingForm` + `EMPTY_FORM`;
  `STEPS` now `['about','body','activity','goal','health','review']`; `validateStep('health') → {}`.
- `src/features/auth/screens/onboarding-wizard.tsx` — health step UI (two `HealthQuestion`s, clear
  note on No) + `STEP_TITLE`/`STEP_SUBTITLE`; `handleSave` upserts profiles health FIRST, goals LAST.
- `src/features/auth/screens/settings-screen.tsx` — import the shared `HealthQuestion`; delete the
  local copy + its now-unused `healthNote` style.
- **Verify:** tsc 0 · expo lint 0 · web export 0.
