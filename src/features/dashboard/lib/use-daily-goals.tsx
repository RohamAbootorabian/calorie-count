/**
 * Dashboard-scoped daily-goals reader (plan 0014).
 *
 * Deliberately NOT a reuse of Settings' `useGoalsRow`: that one does `select('*')`,
 * which pulls body PII (age/sex/height/weight) that Settings edits but the Home
 * landing surface renders none of. This reader selects ONLY the four target columns
 * the dashboard shows — a strict `Pick<>` allowlist (over-fetch = compile error),
 * mirroring `useMealHistory`'s discipline.
 *
 * SECURITY: explicit in-code `.eq('user_id', userId)` (defense-in-depth — RLS already
 * scopes rows, but the in-code filter is non-negotiable here). Lifecycle: `mounted`
 * ref + per-attempt `active` flag, outcome keyed to `(userId, reloadKey)` (verbatim
 * from `useProfile`). Exposes `refetch` so a goals edit in Settings reflects on Home.
 *
 * PRIVACY: never log a row or a metric — structural outcome only.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useUser } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/database';

/** The four targets the dashboard renders — typed allowlist (no body PII). */
export type DailyGoals = Pick<
  Database['public']['Tables']['goals']['Row'],
  'calories' | 'protein' | 'carbs' | 'fat'
>;

/** Keep in sync with `DailyGoals`; MUST NOT include age/sex/height_cm/weight_kg/etc. */
const SELECT_COLUMNS = 'calories, protein, carbs, fat';

export type DailyGoalsStatus = {
  loading: boolean;
  goals: DailyGoals | null;
  error: boolean;
  refetch: () => void;
};

export function useDailyGoals(): DailyGoalsStatus {
  const { user } = useUser();
  const userId = user?.id ?? null;

  const [reloadKey, setReloadKey] = useState(0);
  const refetch = useCallback(() => setReloadKey((k) => k + 1), []);

  type Outcome =
    | { userId: string; reloadKey: number; kind: 'ok'; goals: DailyGoals | null }
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

    supabase
      .from('goals')
      .select(SELECT_COLUMNS)
      .eq('user_id', userId) // mandatory in-code owner filter (defense-in-depth).
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active || !mounted.current) return;
        setOutcome(
          error
            ? { userId, reloadKey: attempt, kind: 'error' }
            : {
                userId,
                reloadKey: attempt,
                kind: 'ok',
                goals: (data as DailyGoals | null) ?? null,
              },
        );
      });

    return () => {
      active = false;
    };
  }, [userId, reloadKey]);

  return useMemo<DailyGoalsStatus>(() => {
    if (!userId) return { loading: false, goals: null, error: false, refetch };
    const fresh =
      outcome?.userId === userId && outcome.reloadKey === reloadKey ? outcome : null;
    if (!fresh) return { loading: true, goals: null, error: false, refetch };
    if (fresh.kind === 'error') return { loading: false, goals: null, error: true, refetch };
    return { loading: false, goals: fresh.goals, error: false, refetch };
  }, [userId, reloadKey, outcome, refetch]);
}
