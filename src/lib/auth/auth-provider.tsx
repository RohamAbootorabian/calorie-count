/**
 * Auth session provider for the trunk. Holds the Supabase Auth session, restores
 * it on launch (from the AsyncStorage-backed `supabase` singleton), and keeps it
 * live via `onAuthStateChange`. Feature screens (S1) build on top of this; they
 * never re-implement session handling.
 *
 * SECURITY: never log the `session` object — it carries `access_token` /
 * `refresh_token`. Log at most `session?.user?.id`. (Review SF1.)
 *
 * KNOWN LIMITATION (SF6): the session persists via AsyncStorage (iOS is
 * Keychain-backed; Android relies on device encryption). Acceptable for v1; a
 * later hardening pass may move token storage to `expo-secure-store`.
 *
 * NOTE: `Stack.Protected` (the navigation gate) is UX only — Supabase RLS
 * (plan 0001) is the real data boundary. Always handle 401/403 in the app layer.
 */
import type { Session, User } from '@supabase/supabase-js';
import { createContext, useEffect, useMemo, useState } from 'react';

import { supabase } from '@/lib/supabase';

export type AuthContextValue = {
  session: Session | null;
  user: User | null;
  /** True until the initial session restore resolves. */
  loading: boolean;
  signOut: () => Promise<void>;
};

export const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    // Restore the cached session (local AsyncStorage read — no network call).
    // Wrapped so a reject (e.g. corrupt storage) can't hang the splash forever.
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (active) setSession(data.session);
      })
      .catch((error: unknown) => {
        // Log only the message — never the session/storage payload (SF1/SF2).
        console.error(
          'auth: getSession failed, treating as signed-out:',
          error instanceof Error ? error.message : String(error),
        );
        if (active) setSession(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    // Stay in sync with sign-in / sign-out / token refresh.
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (active) setSession(nextSession);
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      loading,
      signOut: async () => {
        // The client is signed out regardless of a server error (offline /
        // already-expired token), so log and swallow rather than re-throw (N2).
        const { error } = await supabase.auth.signOut();
        if (error) console.error('auth: signOut error:', error.message);
      },
    }),
    [session, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
