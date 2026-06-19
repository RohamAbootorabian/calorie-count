/**
 * Auth infrastructure (trunk). Feature screens import from here:
 *
 *   import { AuthProvider, useAuth, useUser } from '@/lib/auth';
 */
export { AuthProvider, type AuthContextValue } from './auth-provider';
export { useAuth } from './use-auth';
export { useUser } from './use-user';
