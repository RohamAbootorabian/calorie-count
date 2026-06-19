import { Stack } from 'expo-router';

/**
 * The signed-out area. `sign-in` is declared first so it's the deterministic
 * redirect anchor when the auth gate sends an unauthenticated user here (e.g. a
 * web deep-link to a protected route). S1 must keep the `sign-in` route name.
 */
export default function AuthLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="sign-in" />
    </Stack>
  );
}
