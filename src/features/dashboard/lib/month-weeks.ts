/**
 * Pure month aggregation (plan 0027 Stage B) — turns this-month `meal_logs` rows into
 * the month-to-date `consumed` sum + `mealCount` + four fixed week buckets (days 1–7,
 * 8–14, 15–21, 22–end). Called from `useMonthlyTotals`'s memo so the hook stays thin and
 * this logic is testable without a fetch (mirrors `weekPlanProgress`/`planMetrics`).
 *
 * "This month" = rows whose tz-date `startsWith` the current `YYYY-MM` and are `<=
 * todayKey`. `eaten_at` is `now()`-defaulted but OWNER-SETTABLE to a past date (plan 0028;
 * client-strict past-only, server loosely bounds future to now()+1d) — so the `<= todayKey`
 * guard is the real safety net that excludes any stray future/edge row. PRIVACY: pure, no
 * I/O, never logs a row/metric/tz.
 */
import { makeDayFormatter } from './day-formatter';
import type { ConsumedMacros } from './plan-progress';

/** One fixed week bucket. `index` 0–3; NO view label (formatted in the screen). */
export type MonthWeek = {
  index: number;
  isCurrent: boolean;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  mealCount: number;
};

/** Minimal row shape (a structural subset of the hook's `MealRow`). */
type MonthRow = {
  eaten_at: string;
  total_calories: number;
  total_protein: number;
  total_carbs: number;
  total_fat: number;
};

/** Fixed bucket for a day-of-month: 1–7→0, 8–14→1, 15–21→2, 22–end→3. */
function bucketOf(dayOfMonth: number): number {
  return Math.min(Math.floor((dayOfMonth - 1) / 7), 3);
}

/** The four empty buckets with `isCurrent` set from `todayKey`'s day-of-month. */
export function zeroWeeks(todayKey: string): MonthWeek[] {
  const todayBucket = bucketOf(Number(todayKey.slice(8, 10)) || 1);
  return [0, 1, 2, 3].map((index) => ({
    index,
    isCurrent: index === todayBucket,
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    mealCount: 0,
  }));
}

export type MonthAggregate = {
  consumed: ConsumedMacros;
  mealCount: number;
  weeks: MonthWeek[];
};

export function aggregateMonth(
  rows: MonthRow[],
  tz: string,
  todayKey: string,
): MonthAggregate {
  const fmt = makeDayFormatter(tz);
  const prefix = todayKey.slice(0, 7); // YYYY-MM
  const weeks = zeroWeeks(todayKey);
  const consumed: ConsumedMacros = { calories: 0, protein: 0, carbs: 0, fat: 0 };
  let mealCount = 0;

  for (const r of rows) {
    const dt = new Date(r.eaten_at);
    if (Number.isNaN(dt.getTime())) continue;
    const key = fmt.format(dt);
    if (!key.startsWith(prefix)) continue; // not this month.
    if (key > todayKey) continue; // never count a future-dated row (belt-and-suspenders).
    const w = weeks[bucketOf(Number(key.slice(8, 10)))];
    w.calories += r.total_calories;
    w.protein += r.total_protein;
    w.carbs += r.total_carbs;
    w.fat += r.total_fat;
    w.mealCount += 1;
    consumed.calories += r.total_calories;
    consumed.protein += r.total_protein;
    consumed.carbs += r.total_carbs;
    consumed.fat += r.total_fat;
    mealCount += 1;
  }

  return { consumed, mealCount, weeks };
}
