/**
 * Month-to-date consumed totals from `meal_logs` (plan 0025) — the data behind the
 * monthly plan rings. A lighter sibling of `useWeeklyTotals`: it needs only a SUM
 * over the current calendar month (1st → today) + the elapsed day count, not
 * per-day buckets.
 *
 * tz is a PARAMETER (the screen owns the single `useProfile()` + `resolveTimezone`).
 * The fetch is keyed to `(userId, reloadKey)` and never re-runs on tz change; the
 * sum is a `useMemo([rows, tz, todayKey])` so a late tz OR a midnight/month rollover
 * (via the live `todayKey`, plan 0023) re-buckets already-fetched rows with no refetch.
 *
 * Why a ~33-day window is enough: the earliest instant still "this month" is the 1st
 * at 00:00 local; keys and rows share the active tz, so the wall-clock gap to now is
 * ≤ ~31 days (a 31-day month) + ≤1 h DST — comfortably inside 33 days. The window is
 * tz-independent → never refetches. (Do NOT shrink it.)
 *
 * "This month" = rows whose tz-date `startsWith` the current `YYYY-MM`. All logged
 * rows are ≤ today because `eaten_at` is `now()`-defaulted (initial_schema) and, since
 * plan 0028, OWNER-SETTABLE only to a PAST date (client-strict; server loosely bounds
 * future to now()+1d) — the `<= todayKey` guard in `aggregateMonth` excludes any stray
 * future/edge row — so this is month-to-date. The
 * `<= todayKey` guard is belt-and-suspenders for a future "edit meal time" feature.
 *
 * SECURITY: explicit in-code `.eq('user_id', userId)`. PRIVACY: strict `Pick<>`
 * allowlist (never `select('*')`); never log a row, a metric, the tz, or the error.
 */
import { useMemo } from 'react';

import { aggregateMonth, zeroWeeks, type MonthWeek } from './month-weeks';
import type { ConsumedMacros } from './plan-progress';
import { useCurrentDayKey } from './use-current-day-key';
import { useOwnedMealRows } from './use-owned-meal-rows';

const WINDOW_MS = 33 * 24 * 60 * 60 * 1000; // ≥ a 31-day month-to-date + DST cushion (see header).

export type MonthlyTotalsStatus = {
  loading: boolean;
  error: boolean;
  refetch: () => void;
  /** Month-to-date sums (all zero while loading / on error / signed out). */
  consumed: ConsumedMacros;
  /** Day-of-month of today (1–31) — the plan denominator's day count. */
  elapsed: number;
  /** Number of meals counted this month (0 → "no meals this month yet"). */
  mealCount: number;
  /** The four fixed week buckets (days 1–7 / 8–14 / 15–21 / 22–end), always length 4. */
  weeks: MonthWeek[];
};

const ZERO_CONSUMED: ConsumedMacros = { calories: 0, protein: 0, carbs: 0, fat: 0 };

export function useMonthlyTotals(tz: string): MonthlyTotalsStatus {
  const { rows, loading, error, refetch } = useOwnedMealRows(WINDOW_MS);

  // Live "today" (plan 0023) — advances at local midnight / on resume so the month
  // prefix + elapsed re-derive without a refetch. Feeds the sum memo ONLY.
  const todayKey = useCurrentDayKey(tz);
  const elapsed = Number(todayKey.slice(8, 10)) || 0; // DD of YYYY-MM-DD (explicit, not a locale parse).

  // Re-aggregates whenever tz or the day/month rolls (todayKey) — no refetch. The
  // per-row bucketing + month-to-date sum live in the pure `aggregateMonth` helper.
  // `rows` is null while loading/error/signed-out → zeroed consumed/weeks (but
  // `elapsed` + `zeroWeeks(todayKey)` still re-derive on a rollover, via `todayKey`).
  const agg = useMemo(
    () =>
      rows
        ? aggregateMonth(rows, tz, todayKey)
        : { consumed: ZERO_CONSUMED, mealCount: 0, weeks: zeroWeeks(todayKey) },
    [rows, tz, todayKey],
  );

  return {
    loading,
    error,
    refetch,
    consumed: agg.consumed,
    elapsed,
    mealCount: agg.mealCount,
    weeks: agg.weeks,
  };
}
