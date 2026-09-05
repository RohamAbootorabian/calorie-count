/**
 * Monthly section of the Home switcher (plan 0027) — the month-to-date plan rings.
 * Bare content (the host owns the frame); takes `tz` + `goals` + `goalsLoading`; owns
 * only `useMonthlyTotals(tz)` + its focus-refetch + inline gates.
 *
 * Stage A: the four rings only. Stage B adds the 4-week bar chart + the per-week average.
 */
import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useUser } from '@/lib/auth';

import { planMetrics } from '../lib/plan-progress';
import type { DailyGoals } from '../lib/use-daily-goals';
import { useMonthlyTotals } from '../lib/use-monthly-totals';
import { PlanRingsCard } from './metric-ring';
import { SectionError, SectionSpinner } from './section-status';

export function MonthlySection({
  tz,
  goals,
  goalsLoading,
}: {
  tz: string;
  goals: DailyGoals | null;
  goalsLoading: boolean;
}) {
  const { user } = useUser();
  const userId = user?.id ?? null;
  const { consumed, elapsed, mealCount, loading, error, refetch } = useMonthlyTotals(tz);

  useFocusEffect(
    useCallback(() => {
      if (userId) refetch();
    }, [userId, refetch]),
  );

  if (error) return <SectionError onRetry={refetch} />;
  if (loading) return <SectionSpinner />;

  const metrics = planMetrics(consumed, goals, elapsed);

  return (
    <View style={styles.body}>
      <PlanRingsCard
        title={`This month's plan · ${elapsed} day${elapsed === 1 ? '' : 's'}`}
        loading={goalsLoading}
        goalsMissing={!goalsLoading && goals == null}
        emptyNote={mealCount === 0 ? 'No meals logged this month yet.' : undefined}
        metrics={metrics}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  body: { gap: Spacing.four },
});
