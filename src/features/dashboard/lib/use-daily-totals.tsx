/**
 * Today's consumed totals from `meal_logs` (plan 0014) — the app's first aggregate
 * read. Fetches the last 48 h (tz-independent) and buckets+sums to "today" as a
 * REACTIVE function of `tz`.
 *
 * tz is a PARAMETER, not read internally: the screen owns the single `useProfile()`
 * and passes the resolved tz down. This kills a second profile fetch, keeps the hook
 * pure/testable, and — crucially — lets the bucket recompute when a late
 * `profile.timezone` arrives (the fetch is keyed to `(userId, reloadKey)` and never
 * re-runs on tz change; the bucket is a `useMemo(rows, tz)` so it re-buckets the
 * already-fetched rows with no refetch and no stale totals).
 *
 * Why 48 h is provably enough: a calendar day is <=25 h (DST) and tz offsets span
 * <=14 h, so the oldest instant that can still be "today" somewhere is ~39 h before
 * now — 48 h covers it with margin. The window is tz-independent, so it never refetches.
 *
 * TZ BUCKET (DST-safe, no offset math): one `Intl.DateTimeFormat('en-CA', {timeZone})`
 * → `YYYY-MM-DD`; a meal is "today" iff its formatted date equals today's. Same-formatter
 * string compare sidesteps all UTC-offset/DST arithmetic. Locale is hardcoded `en-CA`
 * (never the device/Persian locale — would break equality / emit non-Latin digits).
 * NATIVE CAVEAT: on Hermes without full-ICU the `timeZone` option can be silently
 * ignored (no throw) → device-local bucket; web has full Intl, the iPhone pass verifies.
 *
 * SECURITY: explicit in-code `.eq('user_id', userId)`. PRIVACY: strict `Pick<>`
 * allowlist (never `select('*')` → no confidence/quality_factors/assumptions/etc.);
 * never log a row, a metric, the tz, or the Postgrest error — a static string only.
 */
import { useMemo } from 'react';

import { makeDayFormatter } from './day-formatter';
import { useCurrentDayKey } from './use-current-day-key';
import { useOwnedMealRows } from './use-owned-meal-rows';

const WINDOW_MS = 48 * 60 * 60 * 1000;

export type DailyTotals = {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  mealCount: number;
};

const ZERO: DailyTotals = { calories: 0, protein: 0, carbs: 0, fat: 0, mealCount: 0 };

export type DailyTotalsStatus = {
  loading: boolean;
  totals: DailyTotals;
  error: boolean;
  refetch: () => void;
};

export function useDailyTotals(tz: string): DailyTotalsStatus {
  const { rows, loading, error, refetch } = useOwnedMealRows(WINDOW_MS);

  // Live "today" (plan 0023) — advances at local midnight / on resume so the bucket
  // re-buckets without a refetch. Feeds the bucket memo ONLY.
  const todayKey = useCurrentDayKey(tz);

  // Re-buckets whenever `tz` changes (late profile tz) WITHOUT a refetch. `rows` is
  // null while loading/error/signed-out → totals stay ZERO (matches the old returns).
  const totals = useMemo<DailyTotals>(() => {
    if (!rows) return ZERO;
    const fmt = makeDayFormatter(tz);
    const acc: DailyTotals = { ...ZERO };
    for (const r of rows) {
      const d = new Date(r.eaten_at);
      if (Number.isNaN(d.getTime())) continue;
      if (fmt.format(d) !== todayKey) continue; // not today in `tz` (live key, plan 0023).
      acc.calories += r.total_calories;
      acc.protein += r.total_protein;
      acc.carbs += r.total_carbs;
      acc.fat += r.total_fat;
      acc.mealCount += 1;
    }
    return acc;
  }, [rows, tz, todayKey]);

  return { loading, totals, error, refetch };
}
