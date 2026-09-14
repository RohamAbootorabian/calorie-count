# Plan: Extract `useMealForm` (DRY the meal-form handlers)

- **Status**: ~~Draft~~ → ~~In Review~~ → **Approved** → In Progress → Done
- **Created**: 2026-09-14
- **Plan #**: 0037

## Problem / Goal
`MealReview` (create) and `EditMealScreen`'s `MealEditor` (edit) carry **byte-identical** meal-form
plumbing: the `form` state, `totals`/`withinCaps` derivation, `isFormValid`, and the six handlers
(`setDishName`, `setNote`, `setEatenAt`, `setItemField`, `removeItem`, `addItem`). Any form-logic
change must be made in both (e.g. `addItem` in plan 0036 was added twice). Extract a shared
`useMealForm` hook so the logic lives once.

Pure refactor: **no behavior/UI change** — tsc/lint/web-export are the equivalence guards.

## Non-goals
- Not touching the save/error/saved lifecycle (each screen keeps its own — different RPCs:
  `create_meal_log` vs `update_meal_log`, plus `onSaving`/`gone`/`router.back`).
- Not changing `MealEditorForm`, `meal-form.ts` pure helpers, or any validation/bounds.
- Not extracting a broader "screen" hook — only the shared form state + handlers + derived flags.

## Proposed approach
New `src/features/capture/lib/use-meal-form.tsx` (colocated with the model it wraps):
```
export type MealFormController = {
  form: MealForm;
  totals: Nutrients;
  withinCaps: boolean;
  formValid: boolean;               // isFormValid(form) — screens combine with their own `saving`
  setDishName: (v: string) => void;
  setNote: (v: string) => void;
  setEatenAt: (v: Date) => void;
  setItemField: (id: string, field: keyof MealItemForm, value: string) => void;
  removeItem: (id: string) => void;
  addItem: () => void;
};
export function useMealForm(init: () => MealForm): MealFormController { … }
```
- `const [form, setForm] = useState<MealForm>(init);` — the lazy initializer preserves each screen's
  seed (`() => seedFormFromAnalysis(...)` / `() => seedFormFromMealLog(...)`) and the "seed once /
  remount on key change" behavior (create is `key`ed by imagePath; edit's `MealEditor` by id).
- Handlers are the exact functional-`setForm` bodies moved verbatim (incl. `addItem`'s
  `MAX_ITEMS`/`appendEmptyItem` cap guard).
- `totals`/`withinCaps`/`formValid` are computed in render from `form` (React Compiler memoizes; drop
  the redundant `useMemo` — behavior identical). Plain functions (no `useCallback`).

### Screen changes (mechanical)
Both screens replace the duplicated block with:
```
const { form, totals, withinCaps, formValid, setDishName, setNote, setEatenAt,
        setItemField, removeItem, addItem } = useMealForm(() => <their seed>);
const canSave = !saving && formValid && withinCaps;
```
and keep their own `saving/saveError/saveCanRetry/saved|gone`, `mounted` ref, `handleSave`, and the
`<MealEditorForm … />` wiring (unchanged props). Drop the now-unused direct imports
(`recomputeTotals`, `totalsWithinCaps`, `isFormValid`, `appendEmptyItem`, `MAX_ITEMS`,
`seedFromX` stays), and `useMemo` if no longer used.

## Files to change
- `src/features/capture/lib/use-meal-form.tsx` — NEW hook.
- `src/features/capture/screens/meal-review.tsx` — use the hook; trim imports.
- `src/features/history/screens/edit-meal-screen.tsx` — use the hook; trim imports.

## Data model / schema impact
None.

## Edge cases & failure modes
- **Seed-once / remount:** the lazy `useState(init)` + the existing `key` on each host keeps the
  "seeds once, remounts on a new meal/photo" behavior — no seeding effect introduced.
- **`mounted`/save lifecycle:** untouched (stays in each screen), so the sign-out/re-pick guards and
  the double-tap guard are unchanged.
- **React Compiler:** the hook returns plain functions + render-derived values; no manual memo. The
  returned object identity changing per render is irrelevant (`MealEditorForm` isn't memoized).
- **Behavioral equivalence:** `totals` moving from `useMemo([form.items])` to a plain call yields the
  same value every render (recompute is pure) — no functional difference.

## Test / verify plan
- `npx tsc --noEmit` → 0; `npx expo lint` → 0; `npx expo export --platform web` → success.
- Manual smoke (create + edit): edit dish/item fields, add/remove items, totals update, Save
  enable/disable, and a real save/update all behave exactly as before.

## Rollout
Pure client refactor. No migration/secret/deploy. Commit to `main`; reload.

## Open questions
None.

---

## Review
Two focused reviewers (behavioral-equivalence + architecture). **Verdict: APPROVED — no blockers.**

### Confirmed behavior-preserving
- Lazy `useState(init)` = today's `useState(() => seed(...))`: seeds once, ignores a new
  `detail`/`analysis` ref unless the HOST remounts (key on imagePath/id unchanged) — no re-seed
  timing change.
- `totals` moving off `useMemo([form.items])` to a plain pure call is identical every render;
  `MealEditorForm` is a plain (non-memoized) component, so prop identity is irrelevant.
- Six handlers are functional-`setForm` (stable) → verbatim move is safe; `addItem` cap intact.
- `canSave = !saving && formValid && withinCaps` composed per-screen = today. `isFormValid` now also
  runs during a save (pure, zero observable effect).
- `mounted` ref + divergent save lifecycle (create vs update RPC) correctly stay in each screen.
- Hook is rules-of-hooks clean; no effect/memo/callback surface → no exhaustive-deps concern.

### SHOULD-FIX (folded in)
- Trim ALL now-unused imports from both screens or `expo lint` fails: `recomputeTotals`,
  `totalsWithinCaps`, `isFormValid`, `appendEmptyItem`, `MAX_ITEMS`, **`type MealForm`,
  `type MealItemForm`**, and **`useMemo`**. Keep `seedFromX` + `toSavePayload`.

### NIT
- File extension: reviewers split (`.ts` no-JSX vs `.tsx` feature-hook convention). Using `.tsx` to
  match the repo's stateful feature hooks (`use-meal-detail.tsx`, `use-meal-history.tsx`).

## Execution log
Implemented per the approved plan.
- `src/features/capture/lib/use-meal-form.tsx` — NEW: `useMealForm(init)` owns `form` + the six
  handlers + render-derived `totals`/`withinCaps`/`formValid` (no memo; plain functions).
- `src/features/capture/screens/meal-review.tsx` + `src/features/history/screens/edit-meal-screen.tsx`
  — replaced the duplicated block with the hook; each keeps its own save lifecycle + `mounted` ref
  and composes `canSave = !saving && formValid && withinCaps`; trimmed the now-unused imports.
- **Verify:** tsc 0 · expo lint 0 · web export 0.
