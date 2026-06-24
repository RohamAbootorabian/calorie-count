/**
 * The `/meal-edit` route (plan 0015) — a thin re-export of the edit screen.
 * Registered as a GUARDED root sibling in `_layout.tsx` (inside the signed-in +
 * onboarded guard), so it presents over the tabs with a themed back chevron and
 * is unreachable when signed out. Reads `?id=` via `useLocalSearchParams`.
 */
export { default } from '@/features/history/screens/edit-meal-screen';
