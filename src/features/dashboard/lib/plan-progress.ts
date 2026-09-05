/**
 * Shared plan-progress mapping (plan 0025) — the ONE place that turns a summed
 * `consumed` + daily `goals` + `elapsed` days into the four ring metrics, via the
 * shared `guardedRatio`. Consumed by BOTH the weekly (`week-plan-progress.ts`) and
 * the monthly (`use-monthly-totals` → the Trend screen) paths, so neither imports
 * the other's "week…"/"month…" module.
 *
 *   percent = consumed ÷ (dailyGoal × elapsed)   (raw ratio, may exceed 1)
 *
 * PRIVACY: pure, no I/O — never logs a consumed/target/percent/goal value.
 */
import { guardedRatio } from './guarded-ratio';
import type { DailyGoals } from './use-daily-goals';

/** One ring's data. `percent` is the RAW ratio (may exceed 1); null = no target. */
export type MetricProgress = {
  percent: number | null;
  consumed: number;
  target: number;
};

/** The four macro sums a plan section measures. */
export type ConsumedMacros = {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
};

/** The four ring metrics. */
export type PlanMetrics = {
  calories: MetricProgress;
  protein: MetricProgress;
  carbs: MetricProgress;
  fat: MetricProgress;
};

/**
 * Map `consumed` + `goals` + `elapsed` → four `MetricProgress`. `goals` null (no
 * plan set) → every `target` is 0 → every `percent` is null (the screen shows a
 * "set your goals" hint instead of NaN rings). Call only with `elapsed >= 1` for a
 * real target (weekly/monthly both guarantee that upstream); `elapsed` 0 yields
 * all-null metrics, never a divide-by-zero.
 */
export function planMetrics(
  consumed: ConsumedMacros,
  goals: DailyGoals | null,
  elapsed: number,
): PlanMetrics {
  const metric = (value: number, dailyGoal: number | null | undefined): MetricProgress => {
    const target = typeof dailyGoal === 'number' ? dailyGoal * elapsed : 0;
    return { percent: guardedRatio(value, target), consumed: value, target };
  };
  return {
    calories: metric(consumed.calories, goals?.calories),
    protein: metric(consumed.protein, goals?.protein),
    carbs: metric(consumed.carbs, goals?.carbs),
    fat: metric(consumed.fat, goals?.fat),
  };
}
