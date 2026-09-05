/**
 * Home tab (plan 0014) — today's calories + macros (the shared `DailySummary`) plus a
 * row of period buttons (Daily · Weekly · Monthly, plan 0026) that open the standalone
 * period screens over the tabs.
 *
 * Owns `useResolvedTz` (tz + greeting) + `useDailyTotals(tz)` + `useDailyGoals`,
 * refetch-on-focus. Gate order: profile/totals loading → spinner; profile error → Retry
 * (no tz = no confident totals); totals error → Retry; goals error is non-fatal.
 */
import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useUser } from '@/lib/auth';
import { Button, Text } from '@/shared/ui';

import { useDailyGoals } from '../lib/use-daily-goals';
import { useDailyTotals } from '../lib/use-daily-totals';
import { useResolvedTz } from '../lib/use-resolved-tz';
import { DailySummary } from './daily-summary';

export default function DashboardScreen() {
  const { user } = useUser();
  const userId = user?.id ?? null;
  const { tz, profile, profileLoading, profileError, refetchProfile } = useResolvedTz();
  const {
    totals,
    loading: totalsLoading,
    error: totalsError,
    refetch: refetchTotals,
  } = useDailyTotals(tz);
  const { goals, refetch: refetchGoals } = useDailyGoals();
  const insets = useSafeAreaInsets();

  // Reflect a newly-logged meal / edited goal on return to the tab.
  useFocusEffect(
    useCallback(() => {
      if (userId) {
        refetchTotals();
        refetchGoals();
      }
    }, [userId, refetchTotals, refetchGoals]),
  );

  if (profileLoading || totalsLoading) {
    return (
      <Centered>
        <ActivityIndicator />
      </Centered>
    );
  }
  if (profileError) {
    return <ErrorState onRetry={refetchProfile} />;
  }
  if (totalsError) {
    return <ErrorState onRetry={refetchTotals} />;
  }

  const noMeals = totals.mealCount === 0;
  const name = profile?.display_name?.trim();

  return (
    <Screen insetTop={insets.top}>
      <View style={styles.header}>
        <Text type="subtitle">{name ? `Hi, ${name}` : 'Today'}</Text>
      </View>

      <DailySummary totals={totals} goals={goals} />

      {/* Period sections (plan 0026) — each opens a standalone screen over the tabs. */}
      <View style={styles.periodRow}>
        <Button variant="secondary" style={styles.periodBtn} onPress={() => router.push('/daily')}>
          Daily
        </Button>
        <Button variant="secondary" style={styles.periodBtn} onPress={() => router.push('/trends')}>
          Weekly
        </Button>
        <Button variant="secondary" style={styles.periodBtn} onPress={() => router.push('/monthly')}>
          Monthly
        </Button>
      </View>

      {noMeals && (
        <Text type="small" themeColor="textSecondary" style={styles.empty}>
          No meals logged today — snap one from Capture.
        </Text>
      )}
    </Screen>
  );
}

// --- Subcomponents ----------------------------------------------------------

function Screen({ insetTop, children }: { insetTop: number; children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View style={[styles.flex, { backgroundColor: theme.background }]}>
      <View
        style={[
          styles.content,
          { paddingTop: insetTop + Spacing.three, paddingBottom: BottomTabInset + Spacing.four },
        ]}
      >
        {children}
      </View>
    </View>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View style={[styles.flex, styles.centered, { backgroundColor: theme.background }]}>
      {children}
    </View>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <Centered>
      <Text type="default" themeColor="textSecondary" style={styles.centerText}>
        Couldn&apos;t load your day.
      </Text>
      <Button onPress={onRetry}>Retry</Button>
    </Centered>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
  },
  centerText: { textAlign: 'center' },
  content: {
    paddingHorizontal: Spacing.four,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    gap: Spacing.three,
  },
  header: { marginBottom: Spacing.one },
  empty: { textAlign: 'center', marginTop: Spacing.two },
  periodRow: { flexDirection: 'row', gap: Spacing.two },
  periodBtn: { flex: 1 },
});
