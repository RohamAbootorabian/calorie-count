/**
 * The `/monthly` route (plan 0026) — a thin re-export of the monthly review screen.
 * Registered as a GUARDED root sibling in `_layout.tsx` (signed-in + onboarded), so it
 * presents over the tabs with a themed back chevron. Reached from the dashboard's
 * "Monthly" button.
 */
export { default } from '@/features/dashboard/screens/monthly-screen';
