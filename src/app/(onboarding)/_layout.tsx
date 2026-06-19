import { Stack } from 'expo-router';

/**
 * The first-run onboarding area (plan 0005). A signed-in user with no `goals` row
 * is routed here by the root gate; the single `index` screen owns its own step
 * machine. `(onboarding)` is a route group so it adds no URL segment.
 */
export default function OnboardingLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
    </Stack>
  );
}
