import type { User } from '@supabase/supabase-js';

import { useAuth } from './use-auth';

/**
 * Convenience hook for screens that only need the current user. Richer access
 * (session, signOut) is available via `useAuth()`.
 */
export function useUser(): { user: User | null; loading: boolean } {
  const { user, loading } = useAuth();
  return { user, loading };
}
