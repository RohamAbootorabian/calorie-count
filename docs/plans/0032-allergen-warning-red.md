# Plan: Red allergen warning in the meal analysis result

- **Status**: ~~Draft~~ → ~~In Review~~ → **Approved** → In Progress → Done
- **Created**: 2026-09-13
- **Plan #**: 0032

## Problem / Goal
Plan 0031 made `analyze-meal` aware of the user's declared allergies and told it to flag likely
allergen conflicts **inside `assumptions`** — which render as plain gray text mixed with ordinary
assumptions ("Assumed: …"). The user wants an allergen conflict to stand out as a **RED warning**
in the analysis result.

"Done": when the AI detects that the analyzed meal likely contains one of the user's declared
allergens, the review card shows a distinct **red** warning line (e.g. "⚠️ May contain peanuts")
separate from the gray assumptions. No red warning appears when there's no conflict.

## Non-goals
- No change to the TDEE math, goals, or the smart-suggestion idea (still deferred).
- **No new DB column / RPC / migration** — the allergen warning is a review-time safety flag; it
  is NOT persisted to `meal_logs` (so it does not reappear when editing an old meal from History).
  (If persistence is wanted later, it's a separate plan.)
- No client-side keyword-sniffing of assumptions (unreliable) — use a dedicated model field.

## Proposed approach
Add a dedicated, separate `allergenWarnings: string[]` to the analysis (not folded into
`assumptions`), fill it from the model, and render it in red.

### Server — `analyze-meal`
- `meal-analysis.ts`:
  - Add `allergenWarnings?: string[]` to the `MealAnalysis` interface.
  - `coerceMealAnalysis`: `const allergenWarnings = coerceStrArray(obj.allergenWarnings, MAX_ASSUMPTIONS)`;
    attach only when non-empty (mirrors `assumptions`).
  - `OPENAI_RESPONSE_SCHEMA`: add `allergenWarnings: { type: "array", items: { type: "string" } }`
    to `properties` **and** to `required` — OpenAI strict structured output requires **every**
    property to appear in `required` (the model returns `[]` when there's no conflict;
    `coerceStrArray` tolerates empty). This is the one correctness trap.
- `openai.ts` system prompt: when the meal likely contains one of the user's **declared** allergens
  (from the health context), put a short warning string in `allergenWarnings` (e.g. "May contain
  peanuts") and do NOT also duplicate it in `assumptions`. When there's no declared allergy or no
  conflict, return an empty `allergenWarnings`.

### Client
- `src/types/nutrition.ts`: add `allergenWarnings?: string[]` to `MealAnalysis`.
- `meal-form.ts`: add `allergenWarnings?: string[]` to `MealForm`; `seedFormFromAnalysis` copies
  `analysis.allergenWarnings`. `seedFormFromMealLog` leaves it undefined (not stored), and
  `toSavePayload` does NOT persist it — no DB/RPC change, no `StoredMealLog` change.
- `meal-editor-form.tsx`: above the gray "Assumed: …" line, render — only when
  `form.allergenWarnings?.length` — each warning as a red line (`Text themeColor="danger"`, ⚠️
  prefix). Read-only, like assumptions.

## Files to change
- `supabase/functions/analyze-meal/meal-analysis.ts` — interface + coerce + schema (properties+required).
- `supabase/functions/analyze-meal/openai.ts` — prompt wording (fill `allergenWarnings`, no dupes).
- `src/types/nutrition.ts` — `MealAnalysis.allergenWarnings`.
- `src/features/capture/lib/meal-form.ts` — `MealForm.allergenWarnings` + seed from analysis.
- `src/features/capture/screens/meal-editor-form.tsx` — red warning block.

## Data model / schema impact
None (no DB column, no migration, no RPC change). `allergenWarnings` lives only on the in-memory
analysis → form, shown at review time.

## Edge cases & failure modes
- **No declared allergies / no conflict:** model returns `[]` → no red line (identical to today).
- **Model omits the field / returns junk:** `coerceStrArray` → `[]`; safe.
- **OpenAI strict schema:** the new property MUST be in `required` or the request errors — covered.
- **History edit screen:** shares `meal-editor-form`; `form.allergenWarnings` is undefined there
  (not stored) → no red line. Acceptable (review-time flag only).
- **Privacy:** the warning text is health-adjacent; it is part of the analysis (already treated as
  health data) and, per non-goal, NOT persisted. Never logged (existing discipline unchanged).
- **Duplicate flag:** prompt tells the model to put allergen conflicts ONLY in `allergenWarnings`,
  not also in `assumptions`, so the user doesn't see it twice.

## Test / verify plan
- `npx tsc --noEmit` → 0; `npx expo lint` → 0; `npx expo export --platform web` → success.
- `npx supabase functions deploy analyze-meal`.
- Manual: with a declared peanut allergy, analyze a peanut-containing dish → a red "⚠️ May
  contain peanuts" line appears above the gray assumptions. Analyze a non-conflicting dish →
  no red line. A user with no declared allergies → no red line, unchanged flow.

## Rollout
1. Ship client (tolerates the new optional field whether or not the function returns it yet).
2. `supabase functions deploy analyze-meal`.
Order is safe either way (optional field). No secret/migration. Commit to `main`.

## Open questions
None.

---

## Review
Two focused reviewers (correctness/API + edge/UX/privacy), right-sized for a moderate change
with one real trap. **Verdict: APPROVED — no blockers.**

### Verified
- **OpenAI strict schema:** adding `allergenWarnings` to BOTH `properties` and `required` is
  correct (mirrors `assumptions`); an empty `[]` is valid (no `minItems`) so "no conflict" is fine.
- **Type sync / not-persisting is consistent:** optional field flows through `analyze-meal.ts`
  (casts `body.analysis`) and `setForm(prev => …)` spreads, so it survives edits; History edit
  correctly shows no red line; no RPC/DB/`StoredMealLog` change needed.
- **Privacy:** no new log/persist path; warning rides `result.analysis` (never logged), stays out
  of `toSavePayload`.

### SHOULD-FIX (resolved)
- **Prompt: REPLACE, don't append.** The plan-0031 line "add a clear assumption saying so" must be
  swapped for "put a short warning in `allergenWarnings` and do NOT repeat it in `assumptions`" —
  else the model gets contradictory routing and double-displays. The separate **conditions** clause
  ("take declared conditions into account when noting assumptions/quality") is **kept**.
- **Anchor to visible/described ingredients** to curb false positives / alarm fatigue: warn "only
  when the item, as shown or described, plausibly contains the allergen as an ingredient; do not
  warn on speculative trace/cross-contamination." Keep tentative "May contain X" phrasing.

### NIT (addressed)
- Render the red block **near the top** (right under the Confidence/Quality line), not at the
  bottom, so a safety cue isn't scrolled past.
- **⚠️ prefix is mandatory** (WCAG 1.4.1 — not color-only); the text itself is meaningful.
- Comment in `seedFormFromMealLog` that `allergenWarnings` is **intentionally not seeded** (so a
  future maintainer doesn't "fix" it). History-edit dropping the flag is a deliberate,
  review-time-only decision; persistence is a possible deferred follow-up.
- `allergenWarnings` is a non-nullable array (like `assumptions`), not the nullable-object style —
  intentional.

## Execution log
Implemented per the approved plan + resolutions.
- `supabase/functions/analyze-meal/meal-analysis.ts` — `allergenWarnings?: string[]` on the
  interface; coerced via `coerceStrArray` (attach when non-empty); added to
  `OPENAI_RESPONSE_SCHEMA` properties **and** required.
- `supabase/functions/analyze-meal/openai.ts` — REPLACED the allergen-in-assumptions sentence with
  an `allergenWarnings`-only + no-duplicate + visible-ingredient-anchored instruction; kept the
  conditions clause.
- `src/types/nutrition.ts` — `MealAnalysis.allergenWarnings?: string[]`.
- `src/features/capture/lib/meal-form.ts` — `MealForm.allergenWarnings?`; seeded in
  `seedFormFromAnalysis`; explicit "not seeded" comment in `seedFormFromMealLog`; `toSavePayload`
  unchanged (not persisted).
- `src/features/capture/screens/meal-editor-form.tsx` — red ⚠️ warning block right under the
  Confidence/Quality line.
- **Verify:** tsc 0 · expo lint 0 · web export 0; `functions deploy analyze-meal`.
