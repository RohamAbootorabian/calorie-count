# Plan: Manually add a meal item (create + edit flows)

- **Status**: ~~Draft~~ → ~~In Review~~ → ~~Approved~~ → ~~In Progress~~ → **Done**
- **Created**: 2026-09-14
- **Plan #**: 0036

## Problem / Goal
The meal review/edit card lets the user edit each item's fields and **remove** items, but there's
no way to **add** one the AI missed. Add an "Add item" action to `MealEditorForm` (used by BOTH the
create flow `MealReview` and the edit flow `EditMealScreen`) that appends a blank, editable item.

"Done": tapping "Add item" appends an empty item row (name + calories/protein/carbs/fat) that the
user fills in; totals recompute live; Save is blocked until the new item is valid; the item count
is capped at 50 (the RPC's `1..50` limit), with the button disabled + a note at the cap.

## Non-goals
- No per-nutrient editing of sugar/fiber/sodium (still carried; a manually-added item gets 0 for
  those — the existing v1 scope). Not adding a food database / AI re-lookup for the new item.
- No schema/RPC change — `meal_items` already stores arbitrary items; `create_meal_log`/
  `update_meal_log` already accept the items array (and already enforce `1..50`).
- No change to remove/edit behavior.

## Proposed approach

### `meal-form.ts` (pure)
- `export const MAX_ITEMS = 50;` — client mirror of the RPC's `item count 1..50` check (both
  `create_meal_log` and `update_meal_log` raise `23514` outside that range; the edge coerce also
  caps at 50). Single source for the UI cap.
- `export function emptyMealItem(id: string): MealItemForm` — all editable fields blank
  (`name:'', calories:'', protein:'', carbs:'', fat:''`), carried fields zeroed
  (`portion:'', estimatedGrams:0, sugar:0, fiber:0, sodium:0`).
- `export function appendEmptyItem(items): MealItemForm[]` — returns `[...items, emptyMealItem(id)]`
  with a fresh **unique** id (`new-<n>`, bumped until it doesn't collide with any existing id —
  seed ids are `'0'..'n'`, so `new-*` never clashes and removal-by-filter keeps keys stable).
  Pure + unit-testable (mirrors the existing helper style).

A freshly-added item is INVALID until filled (`validateItem` requires a name + valid numbers), so
`isFormValid` already returns false and Save is disabled until the user completes it — no new
validity plumbing needed. Its inline field errors render immediately (a clear "fill me" signal).

### `MealEditorForm` (shared component)
- New prop `onAddItem: () => void`.
- Render a secondary "Add item" `Button` below the item list (above the totals card). Disable it
  when `form.items.length >= MAX_ITEMS` and show a small note ("Up to 50 items per meal.") at the cap.

### `MealReview` + `EditMealScreen`
- Add an `addItem` handler: `setForm(prev => prev.items.length >= MAX_ITEMS ? prev :
  { ...prev, items: appendEmptyItem(prev.items) })` (the functional-update cap guard is race-safe;
  the disabled button is the primary guard). Pass `onAddItem={addItem}`.

## Files to change
- `src/features/capture/lib/meal-form.ts` — `MAX_ITEMS`, `emptyMealItem`, `appendEmptyItem`.
- `src/features/capture/screens/meal-editor-form.tsx` — `onAddItem` prop + "Add item" button + cap note.
- `src/features/capture/screens/meal-review.tsx` — `addItem` handler + prop.
- `src/features/history/screens/edit-meal-screen.tsx` — `addItem` handler + prop.

## Data model / schema impact
None. Items already persist via the RPCs; the `1..50` count check already exists server-side and is
now mirrored client-side.

## Edge cases & failure modes
- **Cap (50 items):** button disabled + note; the setState guard prevents exceeding even on a race;
  matches the RPC so a valid form is never rejected with `23514`.
- **Add then don't fill:** the empty item is invalid → Save stays disabled (existing `isFormValid`);
  the "add at least one item" empty-state copy is unaffected (there's always ≥1 now).
- **Add then remove:** `removeItem` filters by id; the unique `new-*` id can't collide → stable keys.
- **Totals:** `recomputeTotals` reads all items incl. the new one (blank numbers read as 0 until
  typed); `totalsWithinCaps` still guards the DB per-total caps.
- **Manually-added item's sugar/fiber/sodium = 0:** intended (v1 carries, doesn't edit them).
- **Save path unchanged:** `toSavePayload` maps every item incl. the new one; RPC accepts it.
- **Privacy:** no new logging; item names are health-adjacent but already handled by the existing
  no-log discipline.

## Test / verify plan
- `npx tsc --noEmit` → 0; `npx expo lint` → 0; `npx expo export --platform web` → success.
- Manual (create + edit): Add item → blank row appears with inline errors; fill name + numbers →
  errors clear, totals update, Save enables; save → the new item persists (reopen from History
  shows it). Add up to 50 → button disables with the note. Add then remove → list stable.

## Rollout
Pure client change. No migration/secret/deploy. Commit to `main`; user reloads (JS-only).

## Open questions
None.

---

## Review
Two focused reviewers (correctness/flow + architecture/UX). **Verdict: APPROVED — no blockers.**

### Confirmed safe
- **id uniqueness:** seed ids are digit-only (`'0'..'n'`); a `new-*` prefix can never collide with
  them, and `appendEmptyItem` scanning existing ids keeps added ids unique through add/remove churn.
- **1..50 cap:** both RPCs (`create_meal_log`/`update_meal_log`) enforce identical `1..50`; the lower
  bound is already covered (`isFormValid` false at 0, `canRemove` blocks below 1); disable-at-50 +
  the functional-update guard mirrors the upper bound — no `23514` reachable.
- **Blank item → Save disabled:** `validateItem('')` returns errors → `isFormValid` false; a blank
  item therefore never reaches `toSavePayload`, so no NaN can hit the RPC (the safety is the
  `isFormValid → canSave → handleSave` gate — consistent with the existing design).
- Both screens wire symmetrically; both hosts already scroll; React-Compiler-safe (pure helper,
  functional setState, no memo).

### SHOULD-FIX / NIT (folded into execution)
- **id generator MUST use a `Set(items.map(id))` + increment `n` from 0** until `new-${n}` is unused
  — never `items.length` or a bare counter (those re-collide after a remove).
- Add an invariant comment near `appendEmptyItem` (seed ids digit-only → `new-` prefix safe) so a
  future uuid-seed change doesn't silently break the assumption.
- Add `placeholder`s to the item inputs so a blank added row reads as "fill me" (a blank row shows
  ~5 inline errors on add — an accepted, deliberate consequence of the shared unconditional
  `validateItem`; NOT worth adding touched-state to the purely-controlled component).
- Keep the Add button `variant="secondary"` (Save stays the only primary CTA); render the cap note
  only at 50. Duplicating `addItem` across both screens is consistent with the existing duplicated
  handlers — a shared `useMealForm` hook is a separate, out-of-scope cleanup.

## Execution log
Implemented per the approved plan + resolutions.
- `src/features/capture/lib/meal-form.ts` — `MAX_ITEMS=50`, `emptyMealItem(id)`, `appendEmptyItem`
  (Set-based unique `new-<n>` id + invariant comment).
- `src/features/capture/screens/meal-editor-form.tsx` — `onAddItem` prop + secondary "Add item"
  button (disabled + note at 50) below the list; placeholders on the item inputs.
- `src/features/capture/screens/meal-review.tsx` + `src/features/history/screens/edit-meal-screen.tsx`
  — `addItem` handler (functional cap guard) + `onAddItem` prop.
- **Verify:** tsc 0 · expo lint 0 · web export 0.
