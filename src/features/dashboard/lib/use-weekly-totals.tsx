/**
 * Last-7-calendar-days consumed totals from `meal_logs` (plan 0018) — a widened clone
 * of `useDailyTotals` (0014). Fetches the last 8 days (tz-independent) and buckets+sums
 * into 7 local calendar days as a REACTIVE function of `tz`.
 *
 * tz is a PARAMETER, not read internally: the screen owns the single `useProfile()`
 * and passes the resolved tz down. The fetch is keyed to `(userId, reloadKey)` and never
 * re-runs on tz change; the buckets are a `useMemo([rows, tz])` so a late `profile.timezone`
 * re-buckets already-fetched rows — AND regenerates the 7 day-keys + weekday labels — with
 * no refetch and no stale data.
 *
 * Why 8 days (192 h) is enough: keys and rows use the SAME active tz, so the worst case is
 * 6 full days + one <=25 h (DST) partial day ~= 170 h. The window is tz-independent, so it
 * never refetches. (Do NOT shrink it.)
 *
 * DAY KEYS + LABELS (B1) — derived from a noon-UTC seed via UTC accessors ONLY, never a
 * second tz formatter: today's local `YYYY-MM-DD` (from the ONE tz formatter) seeds
 * `Date.UTC(y, m-1, d, 12)` (noon avoids any DST edge); walking back `i` days with
 * `setUTCDate` yields `key = toISOString().slice(0,10)` (byte-identical to the `en-CA`
 * bucket string) and `weekdayLabel = WEEKDAY_LABELS[getUTCDay()]` (static, no locale/tz).
 * This kills the invalid-tz crash and the extreme-zone (±12+) label/key drift. The tz
 * formatter is used ONLY to compute today's date and to bucket each row.
 *
 * SECURITY: explicit in-code `.eq('user_id', userId)`. PRIVACY: strict `Pick<>` allowlist
 * (never `select('*')` → no confidence/quality_factors/assumptions/etc.); never log a row,
 * a metric, the tz, or the Postgrest error — a static string only.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useUser } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/database';

import { makeDayFormatter } from './day-formatter';

/** Only the columns we sum — typed allowlist (over-fetch = compile error). */
type MealRow = Pick<
  Database['public']['Tables']['meal_logs']['Row'],
  'eaten_at' | 'total_calories' | 'total_protein' | 'total_carbs' | 'total_fat'
>;

/** Keep in sync with `MealRow`; MUST NOT include confidence/quality_factors/etc. */
const SELECT_COLUMNS = 'eaten_at, total_calories, total_protein, total_carbs, total_fat';

const DAYS = 7;
const WINDOW_MS = 8 * 24 * 60 * 60 * 1000; // 7 buckets + a >=24 h cushion (see header).
const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export type DayTotals = {
  /** `YYYY-MM-DD` in the active tz. */
  key: string;
  /** Short weekday, e.g. "Mon" (derived from the UTC seed — locale-free). */
  weekdayLabel: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  mealCount: number;
};

export type WeeklyTotalsStatus = {
  loading: boolean;
  /** Exactly 7 entries, oldest → newest (today last). Empty array before first load. */
  days: DayTotals[];
  error: boolean;
  refetch: () => void;
};

const EMPTY_DAYS: DayTotals[] = [];

export function useWeeklyTotals(tz: string): WeeklyTotalsStatus {
  const { user } = useUser();
  const userId = user?.id ?? null;

  const [reloadKey, setReloadKey] = useState(0);
  const refetch = useCallback(() => setReloadKey((k) => k + 1), []);

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

  // Only the freshest OK rows for THIS (user, attempt) feed the buckets.
  const rows =
    outcome?.userId === userId && outcome.reloadKey === reloadKey && outcome.kind === 'ok'
      ? outcome.rows
      : null;

  // Regenerates the 7 keys+labels AND re-buckets rows whenever `tz` changes — no refetch.
  const days = useMemo<DayTotals[]>(() => {
    if (!rows) return EMPTY_DAYS;
    const fmt = makeDayFormatter(tz);

    // Today's local date → a noon-UTC seed (DST-proof), then walk back to build 7 days.
    const [y, m, d] = fmt.format(new Date()).split('-').map(Number);
    const seed = new Date(Date.UTC(y, m - 1, d, 12));

    const order: DayTotals[] = [];
    const byKey = new Map<string, DayTotals>();
    for (let i = DAYS - 1; i >= 0; i--) {
      const di = new Date(seed);
      di.setUTCDate(seed.getUTCDate() - i);
      const day: DayTotals = {
        key: di.toISOString().slice(0, 10),
        weekdayLabel: WEEKDAY_LABELS[di.getUTCDay()],
        calories: 0,
        protein: 0,
        carbs: 0,
        fat: 0,
        mealCount: 0,
      };
      order.push(day);
      byKey.set(day.key, day);
    }

    for (const r of rows) {
      const dt = new Date(r.eaten_at);
      if (Number.isNaN(dt.getTime())) continue;
      const bucket = byKey.get(fmt.format(dt));
      if (!bucket) continue; // outside the 7-day window (cushion overshoot / clock skew).
      bucket.calories += r.total_calories;
      bucket.protein += r.total_protein;
      bucket.carbs += r.total_carbs;
      bucket.fat += r.total_fat;
      bucket.mealCount += 1;
    }
    return order;
  }, [rows, tz]);

  return useMemo<WeeklyTotalsStatus>(() => {
    if (!userId) return { loading: false, days: EMPTY_DAYS, error: false, refetch };
    const fresh =
      outcome?.userId === userId && outcome.reloadKey === reloadKey ? outcome : null;
    if (!fresh) return { loading: true, days: EMPTY_DAYS, error: false, refetch };
    if (fresh.kind === 'error') return { loading: false, days: EMPTY_DAYS, error: true, refetch };
    return { loading: false, days, error: false, refetch };
  }, [userId, reloadKey, outcome, days, refetch]);
}
