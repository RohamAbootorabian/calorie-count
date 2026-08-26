/**
 * The ONE guarded consumed÷goal ratio (plan 0021 SF4). Shared by the dashboard
 * daily-progress bars (`dashboard-screen.tsx`) and the weekly plan rings
 * (`week-plan-progress.ts`) so the "has a real target" rule lives in one place.
 *
 * `goal > 0` is the only "has target" case — a missing/null/zero/NaN/negative goal
 * returns `null` (never NaN/Infinity). Returns the RAW ratio (may exceed 1); each
 * caller decides whether to clamp for display.
 *
 * PRIVACY: pure arithmetic, no I/O — never logs a consumed/goal/ratio value.
 */
export function guardedRatio(consumed: number, goal: number | null | undefined): number | null {
  if (typeof goal !== 'number' || !(goal > 0)) return null;
  return consumed / goal;
}
