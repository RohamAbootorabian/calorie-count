/**
 * Monthly review screen (plan 0026) — the `/monthly` route, reached from the
 * dashboard's "Monthly" button. Presents over the tabs with a back chevron. Shows the
 * four month-to-date plan rings (moved off the weekly screen).
 *
 * Owns its plumbing: `useResolvedTz` + `useMonthlyTotals(tz)` + `useDailyGoals`,
 * refetch-on-focus, profile loading/error gates. Monthly loading/error/empty/no-goal
 * are handled INSIDE `PlanRingsCard` (non-fatal), never in the top gate.
 */
import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useUser } from '@/lib/auth';
import { Button, Screen, Text } from '@/shared/ui';

import { planMetrics } from '../lib/plan-progress';
import { useDailyGoals } from '../lib/use-daily-goals';
import { useMonthlyTotals } from '../lib/use-monthly-totals';
import { useResolvedTz } from '../lib/use-resolved-tz';
import { PlanRingsCard } from './metric-ring';

export default function MonthlyScreen() {
  const { user } = useUser();
  const userId = user?.id ?? null;
  const { tz, profileLoading, profileError, refetchProfile } = useResolvedTz();
  const {
    consumed,
    elapsed,
    mealCount,
    loading: monthlyLoading,
    error: monthlyError,
    refetch: refetchMonthly,
  } = useMonthlyTotals(tz);
  const { goals, loading: goalsLoading, refetch: refetchGoals } = useDailyGoals();

  useFocusEffect(
    useCallback(() => {
      if (userId) {
        refetchMonthly();
        refetchGoals();
      }
    }, [userId, refetchMonthly, refetchGoals]),
  );

  if (profileLoading) {
    return (
      <Screen>
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      </Screen>
    );
  }
  if (profileError) return <ErrorState onRetry={refetchProfile} />;

  const metrics = planMetrics(consumed, goals, elapsed);

  return (
    <Screen scroll contentContainerStyle={styles.content}>
      <PlanRingsCard
        title={`This month's plan · ${elapsed} day${elapsed === 1 ? '' : 's'}`}
        loading={monthlyLoading || goalsLoading}
        error={monthlyError}
        goalsMissing={!goalsLoading && goals == null}
        emptyNote={mealCount === 0 ? 'No meals logged this month yet.' : undefined}
        metrics={metrics}
      />
    </Screen>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <Screen>
      <View style={styles.center}>
        <Text type="default" themeColor="textSecondary" style={styles.centerText}>
          Couldn&apos;t load your month.
        </Text>
        <Button onPress={onRetry}>Retry</Button>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: Spacing.three },
  centerText: { textAlign: 'center' },
  content: { gap: Spacing.four },
});
