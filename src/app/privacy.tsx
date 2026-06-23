import { PrivacyPolicyScreen } from '@/features/legal/privacy-policy-screen';

/**
 * The `/privacy` route. Registered as an UNGUARDED sibling of the auth/onboarding/
 * app groups in `_layout.tsx`, so it's reachable both signed-out (from sign-up)
 * and signed-in (from Settings).
 */
export default function PrivacyRoute() {
  return <PrivacyPolicyScreen />;
}
