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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useUser } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/database';

import { makeDayFormatter } from './day-formatter';
import { useCurrentDayKey } from './use-current-day-key';

/** Only the columns we sum — typed allowlist (over-fetch = compile error). */
type MealRow = Pick<
  Database['public']['Tables']['meal_logs']['Row'],
  'eaten_at' | 'total_calories' | 'total_protein' | 'total_carbs' | 'total_fat'
>;

/** Keep in sync with `MealRow`; MUST NOT include confidence/quality_factors/etc. */
const SELECT_COLUMNS = 'eaten_at, total_calories, total_protein, total_carbs, total_fat';

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
  const { user } = useUser();
  const userId = user?.id ?? null;

  const [reloadKey, setReloadKey] = useState(0);
  const refetch = useCallback(() => setReloadKey((k) => k + 1), []);

  // Live "today" (plan 0023) — advances at local midnight / on resume so the bucket
  // re-buckets without a refetch. Feeds the bucket memo ONLY (never the fetch effect).
  const todayKey = useCurrentDayKey(tz);

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

  // Only the freshest OK rows for THIS (user, attempt) feed the bucket.
  const rows =
    outcome?.userId === userId && outcome.reloadKey === reloadKey && outcome.kind === 'ok'
      ? outcome.rows
      : null;

  // Re-buckets whenever `tz` changes (late profile tz) WITHOUT a refetch.
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

  return useMemo<DailyTotalsStatus>(() => {
    if (!userId) return { loading: false, totals: ZERO, error: false, refetch };
    const fresh =
      outcome?.userId === userId && outcome.reloadKey === reloadKey ? outcome : null;
    if (!fresh) return { loading: true, totals: ZERO, error: false, refetch };
    if (fresh.kind === 'error') return { loading: false, totals: ZERO, error: true, refetch };
    return { loading: false, totals, error: false, refetch };
  }, [userId, reloadKey, outcome, totals, refetch]);
}
