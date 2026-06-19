import {
  DarkTheme,
  DefaultTheme,
  Stack,
  ThemeProvider,
} from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useMemo } from 'react';
import { useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { Colors } from '@/constants/theme';
import { AuthProvider, useAuth } from '@/lib/auth';

// Keep the native splash up until the initial session restore resolves.
SplashScreen.preventAutoHideAsync();

/** Brand-synced navigation theme derived from our Colors tokens (review SF16). */
function buildNavTheme(scheme: 'light' | 'dark') {
  const c = Colors[scheme];
  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  return {
    ...base,
    colors: {
      ...base.colors,
      primary: c.primary,
      background: c.background,
      card: c.backgroundElement,
      text: c.text,
      border: c.border,
    },
  };
}

export default function RootLayout() {
  // RN useColorScheme directly at root; coalesce null/'unspecified' → light
  // (same null-safe rule as the fixed useTheme).
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const navTheme = useMemo(() => buildNavTheme(scheme), [scheme]);

  return (
    <AuthProvider>
      <ThemeProvider value={navTheme}>
        <RootNavigator />
        <AnimatedSplashOverlay />
      </ThemeProvider>
    </AuthProvider>
  );
}

/**
 * The auth gate. `Stack.Protected` is UX only — Supabase RLS (plan 0001) is the
 * real data boundary. `guard={!!session}` and `guard={!session}` are exact
 * complements, so exactly one branch is active once `loading` is false.
 */
function RootNavigator() {
  const { session, loading } = useAuth();

  useEffect(() => {
    if (!loading) SplashScreen.hideAsync();
  }, [loading]);

  if (loading) return null; // native splash stays up under the overlay; no auth flash

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={!!session}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
      <Stack.Protected guard={!session}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
    </Stack>
  );
}
