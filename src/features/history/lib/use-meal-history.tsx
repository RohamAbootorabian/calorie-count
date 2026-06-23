/**
 * Meal-history fetch/refetch hook (plan 0012 — the History list).
 *
 * A PLAIN hook (not a context — like `useProfile`, it has exactly one consumer,
 * the history screen, which owns this instance and calls `refetch()` after a
 * delete). It copies `useProfile`'s lifecycle discipline verbatim: a `mounted`
 * ref + a per-attempt `active` flag + an outcome KEYED to `(userId, reloadKey)`
 * so a sign-out mid-fetch can't setState-after-unmount and a stale answer from a
 * previous user/attempt never renders.
 *
 * The hook exposes ONLY `{ loading, meals, error, refetch }` — no local-state
 * mutators (the screen does a plain await-then-refetch delete; plan 0012 review).
 *
 * SECURITY: the query carries an explicit `.eq('user_id', userId)` — MANDATORY
 * defense-in-depth, not a perf nicety. RLS already scopes rows to the owner, but
 * if RLS were ever misconfigured an unfiltered read would leak another user's
 * meals; the in-code filter also uses the `meal_logs_user_eaten_idx` index.
 *
 * PRIVACY (health data): selects a strict column ALLOWLIST (typed as a `Pick<>`
 * so over-fetch is a compile error) — never `select('*')`, which would pull
 * `confidence/quality_factors/assumptions/verified`. Never logs a row, dish
 * name, path, or uid — only a structural outcome.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useUser } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/database';

/** The exact columns the history card renders — enforced at the type level. */
export type MealCard = Pick<
  Database['public']['Tables']['meal_logs']['Row'],
  | 'id'
  | 'dish_name'
  | 'eaten_at'
  | 'image_path'
  | 'total_calories'
  | 'total_protein'
  | 'total_carbs'
  | 'total_fat'
  | 'quality_score'
>;

/** Keep in sync with `MealCard` — the single source for the select string. */
const SELECT_COLUMNS =
  'id, dish_name, eaten_at, image_path, total_calories, total_protein, total_carbs, total_fat, quality_score';

/** Newest-first bound for v1 (no pagination yet — the screen flags when hit). */
export const HISTORY_LIMIT = 100;

export type MealHistoryStatus = {
  /** True until the first query resolves for the current user. */
  loading: boolean;
  /** The user's meals, newest first (empty array when none). */
  meals: MealCard[];
  /** True when the fetch failed (transient → show Retry, don't assume a shape). */
  error: boolean;
  /** Re-run the fetch (pull-to-refresh, and after a successful delete). */
  refetch: () => void;
};

export function useMealHistory(): MealHistoryStatus {
  const { user } = useUser();
  const userId = user?.id ?? null;

  // Bumping this re-runs the effect; the mounted guard prevents setState after
  // unmount (e.g. sign-out mid-fetch).
  const [reloadKey, setReloadKey] = useState(0);
  const refetch = useCallback(() => setReloadKey((k) => k + 1), []);

  // The outcome is KEYED to the exact (user, attempt) it came from, so a stale
  // answer from a previous user/attempt always reads as "still loading".
  type Outcome =
    | { userId: string; reloadKey: number; kind: 'ok'; meals: MealCard[] }
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
      .from('meal_logs')
      .select(SELECT_COLUMNS)
      .eq('user_id', userId) // MANDATORY defense-in-depth (see file header).
      .order('eaten_at', { ascending: false })
      .limit(HISTORY_LIMIT)
      .then(({ data, error: queryError }) => {
        if (!active || !mounted.current) return;
        setOutcome(
          queryError || data == null
            ? { userId, reloadKey: attempt, kind: 'error' }
            : { userId, reloadKey: attempt, kind: 'ok', meals: data as unknown as MealCard[] },
        );
      });

    return () => {
      active = false;
    };
  }, [userId, reloadKey]);

  return useMemo<MealHistoryStatus>(() => {
    if (!userId) {
      return { loading: false, meals: [], error: false, refetch };
    }
    const fresh =
      outcome?.userId === userId && outcome.reloadKey === reloadKey ? outcome : null;
    if (!fresh) {
      return { loading: true, meals: [], error: false, refetch };
    }
    if (fresh.kind === 'error') {
      return { loading: false, meals: [], error: true, refetch };
    }
    return { loading: false, meals: fresh.meals, error: false, refetch };
  }, [userId, reloadKey, outcome, refetch]);
}
