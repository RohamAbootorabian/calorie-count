/**
 * Editable-meal-detail fetch (plan 0015 — seeds the edit form). The History
 * `MealCard` is too narrow (no per-item rows, no carried metadata), so the edit
 * screen fetches the ONE meal's full editable detail on open.
 *
 * Lifecycle (mirrors `useMealHistory`): the outcome is KEYED to its
 * `(id, userId, reloadKey)` and derived in a `useMemo`, so setState happens ONLY
 * in the async callback (never synchronously in the effect body — which the
 * lint rule + React both discourage) and a stale answer from a previous
 * id/user/attempt always reads as "still loading". A `mounted` ref + per-attempt
 * `active` flag drop a late setState after unmount (e.g. sign-out mid-fetch).
 *
 * SECURITY / PRIVACY (mirrors `useMealHistory`):
 *  - Parent query carries an explicit `.eq('user_id', userId)` — MANDATORY
 *    defense-in-depth on top of RLS.
 *  - The CHILD query has no in-code `user_id` filter BY DESIGN: `meal_items` has
 *    no `user_id` column; owner-scope is RLS-only (the `meal_items_select`
 *    parent-join), and we fetch children only AFTER the parent confirms ownership.
 *  - Strict `Pick<>`-backed allowlists (over-fetch is a compile error); never
 *    `select('*')`. Never selects `image_path`/totals (totals are recomputed
 *    from items on save). Never logs a row, dish, item, path, or uid.
 *
 * BOTH-OR-NEITHER gate (review SF2/SF3): a partial seed is a Save-disabled
 * dead-end, so parent-missing (deleted) OR an items-query error OR zero items (a
 * 0-item meal can't be made valid with no add-item in v1) all collapse to one
 * hard `error` state — we NEVER return a partial `detail`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useUser } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import type { StoredMealItem, StoredMealLog } from '@/features/capture/lib/meal-form';

/** The editable + carried parent fields (NOT totals — recomputed on save). */
const LOG_COLUMNS =
  'dish_name, confidence, quality_score, quality_factors, assumptions, note, eaten_at';
/** Every per-item field the form seeds (edited + carried). */
const ITEM_COLUMNS = 'name, portion, estimated_grams, calories, protein, carbs, fat, sugar, fiber, sodium';

export type MealDetail = {
  log: StoredMealLog;
  items: StoredMealItem[];
};

export type MealDetailStatus = {
  /** True until the first fetch resolves for the current id/user. */
  loading: boolean;
  /** The editable detail, or null while loading / on error. */
  detail: MealDetail | null;
  /** True when the meal can't be edited (deleted, fetch error, or 0 items). */
  error: boolean;
  /** Re-run the fetch (retry). */
  refetch: () => void;
};

export function useMealDetail(id: string | undefined): MealDetailStatus {
  const { user } = useUser();
  const userId = user?.id ?? null;

  const [reloadKey, setReloadKey] = useState(0);
  const refetch = useCallback(() => setReloadKey((k) => k + 1), []);

  // Outcome KEYED to the exact (id, user, attempt) it came from — a stale answer
  // from a previous open/attempt reads as "still loading".
  type Outcome =
    | { id: string; userId: string; reloadKey: number; kind: 'ok'; detail: MealDetail }
    | { id: string; userId: string; reloadKey: number; kind: 'error' };
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!id || !userId) return;

    let active = true;
    const attempt = reloadKey;

    (async () => {
      // Parent first — confirms ownership before any child read.
      const { data: logRow, error: logErr } = await supabase
        .from('meal_logs')
        .select(LOG_COLUMNS)
        .eq('id', id)
        .eq('user_id', userId) // MANDATORY defense-in-depth (see file header).
        .maybeSingle();

      if (!active || !mounted.current) return;

      if (logErr || logRow == null) {
        // Query error OR parent gone (deleted) → can't edit.
        setOutcome({ id, userId, reloadKey: attempt, kind: 'error' });
        return;
      }

      const { data: itemRows, error: itemErr } = await supabase
        .from('meal_items')
        .select(ITEM_COLUMNS)
        .eq('meal_log_id', id) // RLS scopes to the owner via the parent join.
        .order('position');

      if (!active || !mounted.current) return;

      // Both-or-neither: an items error OR an empty meal is unrecoverable in v1.
      if (itemErr || itemRows == null || itemRows.length === 0) {
        setOutcome({ id, userId, reloadKey: attempt, kind: 'error' });
        return;
      }

      setOutcome({
        id,
        userId,
        reloadKey: attempt,
        kind: 'ok',
        detail: {
          log: logRow as unknown as StoredMealLog,
          items: itemRows as unknown as StoredMealItem[],
        },
      });
    })();

    return () => {
      active = false;
    };
  }, [id, userId, reloadKey]);

  return useMemo<MealDetailStatus>(() => {
    // No id (bad route) or signed out → a present id is an error, absent stays inert.
    if (!id || !userId) {
      return { loading: false, detail: null, error: !!id, refetch };
    }
    const fresh =
      outcome?.id === id && outcome.userId === userId && outcome.reloadKey === reloadKey
        ? outcome
        : null;
    if (!fresh) {
      return { loading: true, detail: null, error: false, refetch };
    }
    if (fresh.kind === 'error') {
      return { loading: false, detail: null, error: true, refetch };
    }
    return { loading: false, detail: fresh.detail, error: false, refetch };
  }, [id, userId, reloadKey, outcome, refetch]);
}
