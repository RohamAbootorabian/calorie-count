# Plan: Extract shared `SelectGroup` (DRY onboarding + settings)

- **Status**: ~~Draft~~ → ~~In Review~~ → ~~Approved~~ → ~~In Progress~~ → **Done**
- **Created**: 2026-09-14
- **Plan #**: 0039

## Problem / Goal
`SelectGroup<T extends string>` — the full-width "selectable rows built from `Button`" component — is
defined **byte-for-byte identically** in two screens:
- `src/features/auth/screens/onboarding-wizard.tsx` (~L300–334)
- `src/features/auth/screens/settings-screen.tsx` (~L810–844)

Both copies also rely on a local `styles.group = { gap: Spacing.two }` (identical in both files). A
change to the select-row look/behavior (a11y label, variant logic, hint separator) must be made twice.

Extract ONE shared presentational `SelectGroup` into `src/features/auth/components/select-group.tsx`
(the same home as the already-extracted `HealthQuestion`, plan 0034), and import it in both screens.
**Pure refactor — no behavior/UI change.**

## Non-goals
- No change to the component's props, markup, variant logic, hint rendering, or the error text.
- `ReviewRow` is ALSO duplicated across the two screens — **considered-and-excluded** this pass
  (keep scope to the one component the user named; can be a follow-up).
- No change to any call site's props (all four+three usages pass the same shape today).
- No new UI primitive in `@/shared/ui` — this stays a feature-local (`auth`) component, matching
  `HealthQuestion`. It is auth-screens-only; not general enough for the shared kit.

## Proposed approach
New `src/features/auth/components/select-group.tsx` — the exact current definition, made exportable
and owning its own style (so neither screen's `styles.group` is needed by it):
```tsx
import { StyleSheet, View } from 'react-native';
import { Spacing } from '@/constants/theme';
import { Button, Text } from '@/shared/ui';

/** Full-width selectable rows built from `Button` (SF3 — no new primitive). */
export function SelectGroup<T extends string>({
  label, error, options, value, onSelect,
}: {
  label: string;
  error?: string;
  options: { value: T; label: string; hint?: string }[];
  value: T | undefined;
  onSelect: (value: T) => void;
}) {
  return (
    <View style={styles.group}>
      <Text type="smallBold" themeColor="textSecondary">{label}</Text>
      {options.map((option) => (
        <Button
          key={option.value}
          variant={value === option.value ? 'primary' : 'secondary'}
          onPress={() => onSelect(option.value)}
          fullWidth>
          {option.hint ? `${option.label} — ${option.hint}` : option.label}
        </Button>
      ))}
      {error ? (<Text type="small" themeColor="danger">{error}</Text>) : null}
    </View>
  );
}

const styles = StyleSheet.create({ group: { gap: Spacing.two } });
```
Then in EACH screen:
1. Delete the local `function SelectGroup<…>` definition.
2. `import { SelectGroup } from '../components/select-group';`
3. Remove the now-unused `group` key from that screen's local `StyleSheet.create` **iff** nothing else
   references `styles.group` (verify per file — grep before deleting).

## Files to change
- `src/features/auth/components/select-group.tsx` — NEW shared component (+ its own `group` style).
- `src/features/auth/screens/onboarding-wizard.tsx` — delete local copy; import; **remove the now-orphaned `group` style key** (its only use was inside `SelectGroup`, L314).
- `src/features/auth/screens/settings-screen.tsx` — delete local copy; import; **KEEP `styles.group`** — it is still used by the Units (L568) and Timezone (L583) blocks, NOT only by `SelectGroup`.

## Data model / schema impact
None. Pure client, presentational only.

## Edge cases & failure modes
- **Generic `<T extends string>` preserved** — call sites infer `T` from `options`/`value`/`onSelect`
  exactly as before; no site passes an explicit type arg.
- **Orphaned style** — deleting `styles.group` from a file that still uses it elsewhere would break it;
  MUST grep each file for other `styles.group` uses first and only remove if truly unused.
- **React Compiler / strict hooks** — no hooks in the component; nothing to trip.
- **Verify catches the rest** — tsc surfaces any missed import/removed symbol; lint surfaces an unused
  import or orphaned style var.

## Test / verify plan
- `npx tsc --noEmit` → 0; `npx expo lint` → 0; `npx expo export --platform web` → success.
- Manual smoke: onboarding wizard (activity/goal/unit selects) + Settings (units, target-mode, and the
  goal selects) render and select identically to before.

## Rollout
Pure client refactor. No migration/secret/deploy. Commit to `main`; reload.

## Open questions
None.

---

## Review
Two focused reviewers (architecture/equivalence, edge-cases/lint). **Verdict: APPROVED — no blockers.**
The two `SelectGroup` definitions are byte-identical (only a trivial JSDoc backtick differs); the
extraction, home path (`../components/select-group`, mirroring `HealthQuestion`), generic `<T>`
inference, and self-owned `group` style are all confirmed safe.

### Must implement exactly (SHOULD-FIX — both reviewers, same finding)
- **`styles.group` is NOT symmetric across the two screens.**
  - `onboarding-wizard.tsx`: `styles.group` used ONLY at L314 (inside `SelectGroup`) → after extraction
    it is orphaned → **delete the `group` key** (L401–403).
  - `settings-screen.tsx`: `styles.group` used at **L568 (Units block), L583 (Timezone block)**, AND
    L824 (SelectGroup) → after extraction it is STILL live → **KEEP the `group` key** (L903–905).
    Deleting it would break L568/L583 (tsc TS2339 would catch it, but don't rely on that).

### Confirmed OK
- No import becomes unused in either screen after removal: `Button`/`Text`/`View`/`Spacing`/`StyleSheet`
  all still used elsewhere; both screens ADD `import { SelectGroup } from '../components/select-group'`.
- No other symbol (`ReviewRow`, `GoalsReview`, `ReviewCard`, option constants, other style keys) is
  orphaned by the extraction.
- Lint note: stock `eslint-config-expo` does NOT enable `react-native/no-unused-styles`, so a leftover
  orphan style in onboarding would NOT fail the triad — remove it by hand as planned.

## Execution log
Implemented per the approved plan + the SHOULD-FIX resolution.
- `src/features/auth/components/select-group.tsx` — NEW: the shared generic `SelectGroup<T extends
  string>` (exact prior markup) owning its own `group` style; imports `Button`/`Text` from
  `@/shared/ui`, `Spacing` from `@/constants/theme`, `View`/`StyleSheet` from `react-native`.
- `onboarding-wizard.tsx` — deleted the local copy; added the import; **removed** the now-orphaned
  `group` style key (was used only inside `SelectGroup`).
- `settings-screen.tsx` — deleted the local copy; added the import; **KEPT** `styles.group` (still
  used by the Units + Timezone blocks, per the review finding).
- **Verify:** tsc 0 · expo lint 0 · web export success. Pure client refactor (JS-only → reload).
