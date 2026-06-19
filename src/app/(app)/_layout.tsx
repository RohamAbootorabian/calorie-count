import AppTabs from '@/components/app-tabs';

/**
 * The signed-in area: the existing tab navigator. `(app)` is a route group so it
 * adds no URL segment — `/` and `/explore` stay valid.
 */
export default function AppLayout() {
  return <AppTabs />;
}
