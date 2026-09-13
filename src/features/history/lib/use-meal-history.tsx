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

import { escapeIlike, resolveRange, type HistoryFilter } from './history-filter';

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
  /** True ONLY on the very first load with no data yet — the full-screen spinner
   *  case. Filter changes do NOT flip this (they set `refetching`), so the pinned
   *  search box never unmounts mid-type (plan 0033 B1). */
  loading: boolean;
  /** A query is in flight while prior rows are still shown (filter change / refresh). */
  refetching: boolean;
  /** The user's meals for the active filter, newest first (empty when none match). */
  meals: MealCard[];
  /** True when the current query failed (transient → show Retry, keep the filter UI). */
  error: boolean;
  /** Re-run the fetch (pull-to-refresh, and after a successful delete). */
  refetch: () => void;
};

export function useMealHistory(filter: HistoryFilter): MealHistoryStatus {
  const { user } = useUser();
  const userId = user?.id ?? null;

  // Derived query primitives (stable by value within a day — see history-filter.ts).
  // These, not the `filter` object, drive the effect + outcome key so a fresh object
  // each render can't churn/refetch-loop (plan 0033 B2 + SHOULD-FIX).
  const pattern = escapeIlike(filter.search);
  const { fromIso, toIso } = resolveRange(filter);
  const attemptKey = `${pattern}|${fromIso ?? ''}|${toIso ?? ''}`;

  // Bumping this re-runs the effect; the mounted guard prevents setState after
  // unmount (e.g. sign-out mid-fetch).
  const [reloadKey, setReloadKey] = useState(0);
  const refetch = useCallback(() => setReloadKey((k) => k + 1), []);

  // The outcome is KEYED to the exact (user, attempt, filter) it came from, so a
  // stale answer from a previous user/attempt/filter never renders (debounce race).
  type Outcome =
    | { userId: string; reloadKey: number; filterKey: string; kind: 'ok'; meals: MealCard[] }
    | { userId: string; reloadKey: number; filterKey: string; kind: 'error' };
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

    let query = supabase
      .from('meal_logs')
      .select(SELECT_COLUMNS)
      .eq('user_id', userId); // MANDATORY defense-in-depth (see file header).
    if (pattern) query = query.ilike('dish_name', `%${pattern}%`);
    if (fromIso) query = query.gte('eaten_at', fromIso);
    if (toIso) query = query.lte('eaten_at', toIso);

    query
      .order('eaten_at', { ascending: false })
      .limit(HISTORY_LIMIT)
      .then(({ data, error: queryError }) => {
        if (!active || !mounted.current) return;
        setOutcome(
          queryError || data == null
            ? { userId, reloadKey: attempt, filterKey: attemptKey, kind: 'error' }
            : {
                userId,
                reloadKey: attempt,
                filterKey: attemptKey,
                kind: 'ok',
                meals: data as unknown as MealCard[],
              },
        );
      });

    return () => {
      active = false;
    };
  }, [userId, reloadKey, pattern, fromIso, toIso, attemptKey]);

  return useMemo<MealHistoryStatus>(() => {
    if (!userId) {
      return { loading: false, refetching: false, meals: [], error: false, refetch };
    }
    // Resolved for THIS exact attempt (user + reload + filter).
    const fresh =
      outcome?.userId === userId &&
      outcome.reloadKey === reloadKey &&
      outcome.filterKey === attemptKey
        ? outcome
        : null;
    // Best rows to keep on screen while a new query is in flight: the last OK result
    // for THIS filter if we have it, else the last OK result for any filter (avoids a
    // blank flash on a filter change — the header stays mounted regardless).
    const okThisFilter =
      outcome?.userId === userId && outcome.kind === 'ok' && outcome.filterKey === attemptKey
        ? outcome.meals
        : null;
    const okAny = outcome?.userId === userId && outcome.kind === 'ok' ? outcome.meals : null;

    if (fresh) {
      if (fresh.kind === 'error') {
        return { loading: false, refetching: false, meals: okThisFilter ?? [], error: true, refetch };
      }
      return { loading: false, refetching: false, meals: fresh.meals, error: false, refetch };
    }
    // No result for this attempt yet → a query is in flight.
    if (okAny) {
      return { loading: false, refetching: true, meals: okThisFilter ?? okAny, error: false, refetch };
    }
    return { loading: true, refetching: false, meals: [], error: false, refetch };
  }, [userId, reloadKey, attemptKey, outcome, refetch]);
}
