import { useContext } from 'react';

import { AuthContext, type AuthContextValue } from './auth-provider';

/** Full auth context: `{ session, user, loading, signOut }`. */
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
