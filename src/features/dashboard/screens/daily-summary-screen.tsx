/**
 * Daily summary screen (plan 0026) — the `/daily` route, reached from the dashboard's
 * "Daily" button. Presents over the tabs with a back chevron. Shows today's calories +
 * macros (the shared `DailySummary`, same content Home renders inline).
 *
 * Owns its own plumbing (mirrors the dashboard): `useResolvedTz` + `useDailyTotals(tz)`
 * + `useDailyGoals`, refetch-on-focus, profile/totals loading+error gates. Goals are
 * non-fatal (a missing goal renders totals with a "set your goals" note).
 */
import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useUser } from '@/lib/auth';
import { Button, Screen, Text } from '@/shared/ui';

import { useDailyGoals } from '../lib/use-daily-goals';
import { useDailyTotals } from '../lib/use-daily-totals';
import { useResolvedTz } from '../lib/use-resolved-tz';
import { DailySummary } from './daily-summary';

export default function DailySummaryScreen() {
  const { user } = useUser();
  const userId = user?.id ?? null;
  const { tz, profileLoading, profileError, refetchProfile } = useResolvedTz();
  const {
    totals,
    loading: totalsLoading,
    error: totalsError,
    refetch: refetchTotals,
  } = useDailyTotals(tz);
  const { goals, refetch: refetchGoals } = useDailyGoals();

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
      <Screen>
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      </Screen>
    );
  }
  if (profileError) return <ErrorState onRetry={refetchProfile} />;
  if (totalsError) return <ErrorState onRetry={refetchTotals} />;

  return (
    <Screen scroll contentContainerStyle={styles.content}>
      <DailySummary totals={totals} goals={goals} />
      {totals.mealCount === 0 ? (
        <Text type="small" themeColor="textSecondary" style={styles.empty}>
          No meals logged today — snap one from Capture.
        </Text>
      ) : null}
    </Screen>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <Screen>
      <View style={styles.center}>
        <Text type="default" themeColor="textSecondary" style={styles.centerText}>
          Couldn&apos;t load your day.
        </Text>
        <Button onPress={onRetry}>Retry</Button>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: Spacing.three },
  centerText: { textAlign: 'center' },
  content: { gap: Spacing.three },
  empty: { textAlign: 'center', marginTop: Spacing.two },
});
