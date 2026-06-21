/**
 * Profile fetch/refetch hook for the settings screen (plan 0006 SF2).
 *
 * A PLAIN hook, NOT a context (unlike `useOnboardingStatus`): the profile is read
 * by exactly ONE consumer — the settings screen — which owns this instance and
 * calls its own `refetch()` after a successful save. A context would add a
 * provider for no second consumer (SF2; Arch #2 rejected).
 *
 * It still copies `useOnboardingStatus`'s lifecycle discipline: a `mounted` ref +
 * a per-attempt `active` flag keyed to `(userId, reloadKey)` so a sign-out
 * mid-fetch can't setState-after-unmount (Edge #11), and a stale answer from a
 * previous user/attempt never renders.
 *
 * PRIVACY (N4): never log the row, `display_name`, or any body metric — only the
 * boolean/structural outcome at most. Errors collapse to a flag.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useUser } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/database';

export type Profile = Database['public']['Tables']['profiles']['Row'];

export type ProfileStatus = {
  /** True until the first profile query resolves for the current user. */
  loading: boolean;
  /** The profile row, or null if it somehow doesn't exist yet (self-heals on save). */
  profile: Profile | null;
  /** True when the fetch failed (transient → show Retry, don't assume a shape). */
  error: boolean;
  /** Re-run the fetch (the screen calls this after a successful save). */
  refetch: () => void;
};

export function useProfile(): ProfileStatus {
  const { user } = useUser();
  const userId = user?.id ?? null;

  // Bumping this re-runs the effect; the mounted guard prevents setState after
  // unmount (e.g. sign-out mid-fetch).
  const [reloadKey, setReloadKey] = useState(0);
  const refetch = useCallback(() => setReloadKey((k) => k + 1), []);

  // The outcome is KEYED to the exact (user, attempt) it came from, so a stale
  // answer from a previous user/attempt always reads as "still loading".
  type Outcome =
    | { userId: string; reloadKey: number; kind: 'ok'; profile: Profile | null }
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
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data, error: queryError }) => {
        if (!active || !mounted.current) return;
        setOutcome(
          queryError
            ? { userId, reloadKey: attempt, kind: 'error' }
            : { userId, reloadKey: attempt, kind: 'ok', profile: data },
        );
      });

    return () => {
      active = false;
    };
  }, [userId, reloadKey]);

  return useMemo<ProfileStatus>(() => {
    if (!userId) {
      return { loading: false, profile: null, error: false, refetch };
    }
    const fresh = outcome?.userId === userId && outcome.reloadKey === reloadKey ? outcome : null;
    if (!fresh) {
      return { loading: true, profile: null, error: false, refetch };
    }
    if (fresh.kind === 'error') {
      return { loading: false, profile: null, error: true, refetch };
    }
    return { loading: false, profile: fresh.profile, error: false, refetch };
  }, [userId, reloadKey, outcome, refetch]);
}
