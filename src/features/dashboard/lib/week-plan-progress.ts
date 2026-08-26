/**
 * "This week's plan, so far" — the four ring metrics for the weekly trend (plan
 * 0021). Pure, testable, screen-independent: given the already-fetched weekly
 * `days` (from `useWeeklyTotals`) + the already-fetched daily `goals` (from
 * `useDailyGoals`), it computes, for calories/protein/carbs/fat, how much of the
 * recommended plan the user has hit from **this Saturday through today**:
 *
 *   percent = consumed(Saturday→today) ÷ (dailyGoal × daysElapsedSinceSaturday)
 *
 * No I/O, no new fetch, no schema — it re-sums a contiguous tail of the SAME rows
 * the bars use. PRIVACY: never logs a consumed/target/percent/goal value.
 *
 * ELAPSED (SF1): today is always the last chronological `days` entry. The count of
 * days from the most-recent Saturday to today (inclusive) is `todaySatRank + 1`,
 * where the Saturday-first rank is `(getUTCDay() + 1) % 7` (Sat→0 … Fri→6) — the
 * SAME locale-free UTC path the day keys use (the `key` is a UTC-midnight date), so
 * it inherits the hook's DST-safe posture. Defensive: an empty / today-less `days`
 * yields `elapsed: 0` and all-null metrics, so a `goal × 0` denominator can never
 * divide (which the `goal > 0` guard alone would NOT catch).
 */
import { guardedRatio } from './guarded-ratio';
import type { DailyGoals } from './use-daily-goals';
import type { DayTotals } from './use-weekly-totals';

/** One ring's data. `percent` is the RAW ratio (may exceed 1); null = no target. */
export type MetricProgress = {
  percent: number | null;
  consumed: number;
  target: number;
};

export type WeekPlanProgress = {
  /** Days from this Saturday through today, inclusive (1–7); 0 iff `days` is unusable. */
  elapsed: number;
  calories: MetricProgress;
  protein: MetricProgress;
  carbs: MetricProgress;
  fat: MetricProgress;
};

const NULL_METRIC: MetricProgress = { percent: null, consumed: 0, target: 0 };
const EMPTY: WeekPlanProgress = {
  elapsed: 0,
  calories: NULL_METRIC,
  protein: NULL_METRIC,
  carbs: NULL_METRIC,
  fat: NULL_METRIC,
};

/** Days from the most-recent Saturday to `todayKey` (a `YYYY-MM-DD` UTC date), inclusive. */
function elapsedSinceSaturday(todayKey: string): number {
  const day = new Date(todayKey).getUTCDay(); // Sun=0 … Sat=6 (key is UTC midnight).
  if (Number.isNaN(day)) return 0;
  return ((day + 1) % 7) + 1; // Sat→1, Sun→2, … Fri→7.
}

/**
 * Build the four ring metrics. `goals` null (no plan set) → all metrics null (the
 * screen shows a "set your goals" hint instead of NaN rings).
 */
export function weekPlanProgress(days: DayTotals[], goals: DailyGoals | null): WeekPlanProgress {
  const today = days.length > 0 ? days[days.length - 1] : undefined;
  if (!today || !today.isToday) return EMPTY; // defensive: unusable / pre-gate `days`.

  const elapsed = elapsedSinceSaturday(today.key);
  if (elapsed <= 0) return EMPTY;

  // This week = the last `elapsed` chronological days (today back to Saturday) — a
  // contiguous tail (Saturday is always ≤6 days before today, inside the 7-day window).
  const week = days.slice(Math.max(0, days.length - elapsed));

  const consumed = {
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
  };
  for (const d of week) {
    consumed.calories += d.calories;
    consumed.protein += d.protein;
    consumed.carbs += d.carbs;
    consumed.fat += d.fat;
  }

  const metric = (value: number, dailyGoal: number | null | undefined): MetricProgress => {
    const target = typeof dailyGoal === 'number' ? dailyGoal * elapsed : 0;
    return { percent: guardedRatio(value, target), consumed: value, target };
  };

  return {
    elapsed,
    calories: metric(consumed.calories, goals?.calories),
    protein: metric(consumed.protein, goals?.protein),
    carbs: metric(consumed.carbs, goals?.carbs),
    fat: metric(consumed.fat, goals?.fat),
  };
}
