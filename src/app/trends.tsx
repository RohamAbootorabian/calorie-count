/**
 * The `/trends` route (plan 0018) — a thin re-export of the weekly-trend screen.
 * Registered as a GUARDED root sibling in `_layout.tsx` (inside the signed-in +
 * onboarded guard), so it presents over the tabs with a themed back chevron and is
 * unreachable when signed out. Reached from the dashboard's "Weekly trend" button.
 */
export { default } from '@/features/dashboard/screens/trend-screen';
