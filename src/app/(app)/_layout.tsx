import AppTabs from '@/components/app-tabs';
import { useTimezoneHeal } from '@/features/auth/lib/use-timezone-heal';

/**
 * The signed-in area: the existing tab navigator. `(app)` is a route group so it
 * adds no URL segment — `/` and `/history` stay valid.
 */
export default function AppLayout() {
  // Best-effort once-per-session heal of the stored 'UTC' default → real device zone (plan 0024).
  useTimezoneHeal();
  return <AppTabs />;
}
