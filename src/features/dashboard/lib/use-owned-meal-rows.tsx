/**
 * Shared owner-scoped `meal_logs` row fetch for the dashboard totals hooks (plan
 * 0038). `useDailyTotals` / `useWeeklyTotals` / `useMonthlyTotals` previously
 * triplicated this exact fetch + lifecycle; it now lives once here and each period
 * hook keeps only its own WINDOW + aggregation.
 *
 * Fetches the last `windowMs` of the caller's meals (tz-INDEPENDENT window, so it
 * never refetches on a tz/midnight change — the callers re-bucket the returned rows).
 * Returns the raw rows BY REFERENCE (stable while `outcome` is unchanged) so each
 * caller's aggregation `useMemo` doesn't re-run spuriously.
 *
 * SECURITY: mandatory in-code `.eq('user_id', userId)` owner filter (defense-in-depth
 * + index) — now a SINGLE source. PRIVACY: strict `Pick<>` allowlist (never
 * `select('*')` → no confidence/quality_factors/assumptions/etc.); never logs a row,
 * a metric, or the Postgrest error. Sign-out mid-fetch can't setState-after-unmount
 * (`mounted` ref + per-attempt `active` flag); a stale answer from a previous
 * user/attempt never renders (`outcome` keyed to `(userId, reloadKey)`).
 *
 * Signed-out contract: `{ rows: null, loading: false, error: false }` (settled +
 * zeroed, NOT perpetual loading) — matches what every totals hook returned before.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { useUser } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/database';

/** Only the columns the totals hooks sum — typed allowlist (over-fetch = compile error). */
export type OwnedMealRow = Pick<
  Database['public']['Tables']['meal_logs']['Row'],
  'eaten_at' | 'total_calories' | 'total_protein' | 'total_carbs' | 'total_fat'
>;

/** Keep in sync with `OwnedMealRow`; MUST NOT include confidence/quality_factors/etc. */
const SELECT_COLUMNS = 'eaten_at, total_calories, total_protein, total_carbs, total_fat';

export type OwnedMealRowsStatus = {
  /** Freshest OK rows for the current (user, attempt); null while loading, on error, or signed out. */
  rows: OwnedMealRow[] | null;
  /** True until the first query resolves for the current user (false when signed out). */
  loading: boolean;
  /** True when the current attempt failed. */
  error: boolean;
  /** Re-run the fetch. */
  refetch: () => void;
};

export function useOwnedMealRows(windowMs: number): OwnedMealRowsStatus {
  const { user } = useUser();
  const userId = user?.id ?? null;

  const [reloadKey, setReloadKey] = useState(0);
  const refetch = useCallback(() => setReloadKey((k) => k + 1), []);

  type Outcome =
    | { userId: string; reloadKey: number; kind: 'ok'; rows: OwnedMealRow[] }
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
    const sinceIso = new Date(Date.now() - windowMs).toISOString();

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
            : { userId, reloadKey: attempt, kind: 'ok', rows: data as unknown as OwnedMealRow[] },
        );
      });

    return () => {
      active = false;
    };
  }, [userId, reloadKey, windowMs]);

  // Fresh ONLY for this exact (user, attempt). `rows` is the raw reference (stable
  // while `outcome` is unchanged). Signed-out (`!userId`) reads as settled + zeroed.
  const fresh =
    outcome?.userId === userId && outcome.reloadKey === reloadKey ? outcome : null;
  return {
    rows: fresh?.kind === 'ok' ? fresh.rows : null,
    loading: !!userId && !fresh,
    error: !!userId && fresh?.kind === 'error',
    refetch,
  };
}
