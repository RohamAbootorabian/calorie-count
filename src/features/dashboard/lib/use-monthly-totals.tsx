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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useUser } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/database';

import { aggregateMonth, zeroWeeks, type MonthWeek } from './month-weeks';
import type { ConsumedMacros } from './plan-progress';
import { useCurrentDayKey } from './use-current-day-key';

/** Only the columns we sum — typed allowlist (over-fetch = compile error). */
type MealRow = Pick<
  Database['public']['Tables']['meal_logs']['Row'],
  'eaten_at' | 'total_calories' | 'total_protein' | 'total_carbs' | 'total_fat'
>;

/** Keep in sync with `MealRow`; MUST NOT include confidence/quality_factors/etc. */
const SELECT_COLUMNS = 'eaten_at, total_calories, total_protein, total_carbs, total_fat';

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
  const { user } = useUser();
  const userId = user?.id ?? null;

  const [reloadKey, setReloadKey] = useState(0);
  const refetch = useCallback(() => setReloadKey((k) => k + 1), []);

  // Live "today" (plan 0023) — advances at local midnight / on resume so the month
  // prefix + elapsed re-derive without a refetch. Feeds the sum memo ONLY.
  const todayKey = useCurrentDayKey(tz);
  const elapsed = Number(todayKey.slice(8, 10)) || 0; // DD of YYYY-MM-DD (explicit, not a locale parse).

  type Outcome =
    | { userId: string; reloadKey: number; kind: 'ok'; rows: MealRow[] }
    | { userId: string; reloadKey: number; kind: 'error' };
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    const attempt = reloadKey;
    const sinceIso = new Date(Date.now() - WINDOW_MS).toISOString();

    supabase
      .from('meal_logs')
      .select(SELECT_COLUMNS)
      .eq('user_id', userId) // mandatory in-code owner filter (defense-in-depth + index).
      .gte('eaten_at', sinceIso)
      .then(({ data, error }) => {
        if (!active || !mounted.current) return;
        setOutcome(
          error || data == null
            ? { userId, reloadKey: attempt, kind: 'error' }
            : { userId, reloadKey: attempt, kind: 'ok', rows: data as unknown as MealRow[] },
        );
      });

    return () => {
      active = false;
    };
  }, [userId, reloadKey]);

  // Only the freshest OK rows for THIS (user, attempt) feed the sum.
  const rows =
    outcome?.userId === userId && outcome.reloadKey === reloadKey && outcome.kind === 'ok'
      ? outcome.rows
      : null;

  // Re-aggregates whenever tz or the day/month rolls (todayKey) — no refetch. The
  // per-row bucketing + month-to-date sum live in the pure `aggregateMonth` helper.
  const agg = useMemo(
    () =>
      rows
        ? aggregateMonth(rows, tz, todayKey)
        : { consumed: ZERO_CONSUMED, mealCount: 0, weeks: zeroWeeks(todayKey) },
    [rows, tz, todayKey],
  );

  return useMemo<MonthlyTotalsStatus>(() => {
    const empty = {
      consumed: ZERO_CONSUMED,
      elapsed,
      mealCount: 0,
      weeks: zeroWeeks(todayKey),
    };
    if (!userId) return { loading: false, error: false, refetch, ...empty };
    const fresh =
      outcome?.userId === userId && outcome.reloadKey === reloadKey ? outcome : null;
    if (!fresh) return { loading: true, error: false, refetch, ...empty };
    if (fresh.kind === 'error') return { loading: false, error: true, refetch, ...empty };
    return {
      loading: false,
      error: false,
      refetch,
      consumed: agg.consumed,
      elapsed,
      mealCount: agg.mealCount,
      weeks: agg.weeks,
    };
  }, [userId, reloadKey, outcome, agg, elapsed, todayKey, refetch]);
}
