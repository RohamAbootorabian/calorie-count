import {
  DarkTheme,
  DefaultTheme,
  Stack,
  ThemeProvider,
} from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useMemo } from 'react';
import { StyleSheet, useColorScheme, View } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { Colors, Spacing } from '@/constants/theme';
import {
  OnboardingStatusProvider,
  useOnboardingStatus,
} from '@/features/auth/lib/use-onboarding-status';
import { AuthProvider, useAuth } from '@/lib/auth';
import { Button, Screen, Text } from '@/shared/ui';

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
      <OnboardingStatusProvider>
        <ThemeProvider value={navTheme}>
          <RootNavigator />
          <AnimatedSplashOverlay />
        </ThemeProvider>
      </OnboardingStatusProvider>
    </AuthProvider>
  );
}

/**
 * The three-state routing gate (plan 0005 B1). `Stack.Protected` is UX only —
 * Supabase RLS (plan 0001) is the real data boundary. The three guards are exact
 * complements, so once both `loading` flags are false exactly one branch renders:
 *   - `!session`                         → (auth)
 *   - signed in + needs onboarding       → (onboarding)
 *   - signed in + onboarding complete    → (app)
 *
 * While either auth or the goals-existence check is loading → render null (native
 * splash stays up; no flash). If the goals check errors (offline) → a full-screen
 * Retry, NEVER auto-routing into onboarding (which could create a duplicate row).
 */
function RootNavigator() {
  const { session, loading: authLoading } = useAuth();
  const onboarding = useOnboardingStatus();

  // The goals check only matters once we know the user is signed in.
  const onboardingResolving = !!session && onboarding.loading;
  const ready = !authLoading && !onboardingResolving;

  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null; // native splash stays up under the overlay; no flash

  // Signed in but the goals check failed (offline): offer Retry rather than
  // dumping the user into onboarding, which could create a duplicate row.
  if (session && onboarding.error) {
    return <OnboardingCheckError onRetry={onboarding.refetch} />;
  }

  const needsOnboarding = !!session && onboarding.needsOnboarding;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={!session}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
      <Stack.Protected guard={needsOnboarding}>
        <Stack.Screen name="(onboarding)" />
      </Stack.Protected>
      <Stack.Protected guard={!!session && !needsOnboarding}>
        <Stack.Screen name="(app)" />
        {/*
         * Edit a saved meal (plan 0015) — a GUARDED root sibling so it presents
         * over the tabs with a themed back chevron; only reachable when signed
         * in + onboarded (a sign-out unmounts it mid-edit). headerShown:true
         * overrides the root headerShown:false.
         */}
        <Stack.Screen name="meal-edit" options={{ headerShown: true, title: 'Edit Meal' }} />
        {/*
         * Weekly calorie trend (plan 0018) — same GUARDED root-sibling pattern as
         * meal-edit: presents over the tabs with a themed back chevron, reached from
         * the dashboard's "Weekly trend" button.
         */}
        <Stack.Screen name="trends" options={{ headerShown: true, title: 'Weekly Trend' }} />
      </Stack.Protected>
      {/*
       * Privacy policy — UNGUARDED sibling so it's reachable from every auth
       * state (sign-up before login, Settings after). headerShown:true overrides
       * the root headerShown:false to give a themed back chevron (plan 0010).
       */}
      <Stack.Screen name="privacy" options={{ headerShown: true, title: 'Privacy Policy' }} />
    </Stack>
  );
}

/** Full-screen Retry when the goals-existence check fails (transient/offline). */
function OnboardingCheckError({ onRetry }: { onRetry: () => void }) {
  return (
    <Screen contentContainerStyle={styles.errorCenter}>
      <View style={styles.errorContent}>
        <Text type="subtitle">Something went wrong</Text>
        <Text type="small" themeColor="textSecondary">
          We couldn&apos;t load your account. Check your connection and try again.
        </Text>
        <Button onPress={onRetry} fullWidth>
          Try again
        </Button>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  errorCenter: {
    justifyContent: 'center',
  },
  errorContent: {
    gap: Spacing.two,
  },
});
