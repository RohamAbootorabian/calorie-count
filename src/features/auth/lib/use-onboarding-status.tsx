/**
 * Goals-existence check for the root routing gate (plan 0005 B2). A signed-in
 * user with NO `goals` row needs onboarding; once the row exists they skip it.
 *
 * Exposed as a CONTEXT (provider + hook), not a bare hook, so the root gate and
 * the onboarding wizard share ONE instance: after the wizard upserts the row it
 * calls `refetch()`, `needsOnboarding` flips false on that shared instance, and
 * the declarative gate admits `(app)` with no manual navigation. (A per-component
 * hook couldn't do this — the wizard's refetch wouldn't reach the gate's state.
 * Execution-log deviation from the plan's "feature hook" phrasing — same contract,
 * shared via context.)
 *
 * Consumers get `{ loading, needsOnboarding, error, refetch }`:
 *   - while the query is in flight → `loading` (gate renders null, no flash)
 *   - on offline/error → `error` set (gate shows Retry, never auto-routes into
 *     onboarding, which could create a duplicate row)
 *   - after a save → `refetch()` re-runs the check
 *
 * The query runs on mount and whenever `user?.id` changes. RLS guarantees a user
 * only ever sees their own row (plan 0001), so `where user_id = auth.uid()` is
 * belt-and-suspenders, not the security boundary.
 *
 * PRIVACY (SF4): never log the row or any body metric — only the boolean outcome
 * at most. Errors collapse to a flag; we never surface a raw backend string.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { useUser } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

export type OnboardingStatus = {
  /** True until the first goals-existence query resolves for the current user. */
  loading: boolean;
  /** True when the signed-in user has no `goals` row yet. */
  needsOnboarding: boolean;
  /** True when the check failed (treat as transient → show Retry, don't route). */
  error: boolean;
  /** Re-run the check (the wizard calls this after a successful save). */
  refetch: () => void;
};

const OnboardingStatusContext = createContext<OnboardingStatus | undefined>(undefined);

export function OnboardingStatusProvider({ children }: { children: ReactNode }) {
  const { user } = useUser();
  const userId = user?.id ?? null;

  // Bumping this re-runs the effect (refetch); the mounted guard prevents
  // setState after the provider unmounts (e.g. sign-out mid-check).
  const [reloadKey, setReloadKey] = useState(0);
  const refetch = useCallback(() => setReloadKey((k) => k + 1), []);

  // The outcome is KEYED to the exact (user, attempt) it came from. Anything whose
  // key doesn't match the current (userId, reloadKey) reads as "still loading", so:
  //   - a sign-out→sign-in as a different user never shows the previous answer, and
  //   - tapping Retry (reloadKey++) shows a loading state, not the stale error.
  // All state writes happen in the async callback — never synchronously in the
  // effect body (avoids the cascading-render setState-in-effect smell).
  type Outcome =
    | { userId: string; reloadKey: number; kind: 'ok'; needsOnboarding: boolean }
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
    // Signed out: nothing to fetch. The gate's `!session` branch owns this case,
    // and the derived value below already reads as a clean non-loading state.
    if (!userId) return;

    let active = true;
    const attempt = reloadKey;

    supabase
      .from('goals')
      .select('user_id')
      .eq('user_id', userId)
      .maybeSingle()
      .then(({ data, error: queryError }) => {
        if (!active || !mounted.current) return;
        // Transient error (offline/RLS hiccup) → show Retry, never assume onboarding.
        setOutcome(
          queryError
            ? { userId, reloadKey: attempt, kind: 'error' }
            : { userId, reloadKey: attempt, kind: 'ok', needsOnboarding: data === null },
        );
      });

    return () => {
      active = false;
    };
  }, [userId, reloadKey]);

  const value = useMemo<OnboardingStatus>(() => {
    if (!userId) {
      return { loading: false, needsOnboarding: false, error: false, refetch };
    }
    const fresh = outcome?.userId === userId && outcome.reloadKey === reloadKey ? outcome : null;
    if (!fresh) {
      return { loading: true, needsOnboarding: false, error: false, refetch };
    }
    if (fresh.kind === 'error') {
      return { loading: false, needsOnboarding: false, error: true, refetch };
    }
    return { loading: false, needsOnboarding: fresh.needsOnboarding, error: false, refetch };
  }, [userId, reloadKey, outcome, refetch]);

  return (
    <OnboardingStatusContext.Provider value={value}>{children}</OnboardingStatusContext.Provider>
  );
}

export function useOnboardingStatus(): OnboardingStatus {
  const context = useContext(OnboardingStatusContext);
  if (!context) {
    throw new Error('useOnboardingStatus must be used within OnboardingStatusProvider');
  }
  return context;
}
