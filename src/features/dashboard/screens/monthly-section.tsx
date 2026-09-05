/**
 * Monthly section of the Home switcher (plan 0027) — a 4-week calorie bar chart (fixed
 * buckets: days 1–7 / 8–14 / 15–21 / 22–end, current week highlighted, one flat weekly-
 * goal line at daily × 7), the four month-to-date plan rings, and a per-week average.
 * Bare content (the host owns the frame); takes `tz` + `goals` + `goalsLoading`; owns only
 * `useMonthlyTotals(tz)` + its focus-refetch + inline gates.
 */
import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useUser } from '@/lib/auth';
import { Card, Text } from '@/shared/ui';

import { planMetrics } from '../lib/plan-progress';
import type { DailyGoals } from '../lib/use-daily-goals';
import { useMonthlyTotals } from '../lib/use-monthly-totals';
import { CalorieBarChart, type ChartBar } from './calorie-bar-chart';
import { PlanRingsCard } from './metric-ring';
import { SectionError, SectionSpinner } from './section-status';

function round(n: number): number {
  return Math.round(n);
}

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
  const { consumed, elapsed, mealCount, weeks, loading, error, refetch } = useMonthlyTotals(tz);

  useFocusEffect(
    useCallback(() => {
      if (userId) refetch();
    }, [userId, refetch]),
  );

  if (error) return <SectionError onRetry={refetch} />;
  if (loading) return <SectionSpinner />;

  if (mealCount === 0) {
    return (
      <View style={styles.emptyBox}>
        <Text type="default" themeColor="textSecondary" style={styles.emptyText}>
          No meals logged this month yet — snap one from Capture.
        </Text>
      </View>
    );
  }

  const dailyCal = typeof goals?.calories === 'number' && goals.calories > 0 ? goals.calories : null;
  const goalWeekly = dailyCal != null ? dailyCal * 7 : null; // one flat weekly-goal line.
  const maxWeek = Math.max(...weeks.map((w) => w.calories));
  const domainMax = goalWeekly != null ? Math.max(maxWeek, goalWeekly * 1.1) : maxWeek;

  const bars: ChartBar[] = weeks.map((w) => ({
    key: `w${w.index}`,
    label: `Wk ${w.index + 1}`,
    value: w.calories,
    isCurrent: w.isCurrent,
    hasData: w.mealCount > 0,
  }));

  const loggedWeeks = weeks.filter((w) => w.mealCount > 0).length;
  const perWeek = (total: number) => (loggedWeeks > 0 ? Math.round(total / loggedWeeks) : 0);

  const metrics = planMetrics(consumed, goals, elapsed);

  return (
    <View style={styles.body}>
      <Card style={styles.chartCard}>
        <Text type="small" themeColor="textSecondary">
          Calories · by week
          {goalWeekly != null ? ` · goal ${round(goalWeekly)} kcal/wk` : ''}
        </Text>
        <CalorieBarChart bars={bars} domainMax={domainMax} goalValue={goalWeekly} />
      </Card>

      <PlanRingsCard
        title={`This month's plan · ${elapsed} day${elapsed === 1 ? '' : 's'}`}
        loading={goalsLoading}
        goalsMissing={!goalsLoading && goals == null}
        metrics={metrics}
      />

      {loggedWeeks > 0 ? (
        <Card style={styles.summaryCard}>
          <Text type="small" themeColor="textSecondary">
            Monthly average · over {loggedWeeks} logged week{loggedWeeks === 1 ? '' : 's'}
          </Text>
          <Text type="subtitle">{perWeek(consumed.calories)} kcal / week</Text>
          <View style={styles.macros}>
            <MacroAvg label="Protein" grams={perWeek(consumed.protein)} />
            <MacroAvg label="Carbs" grams={perWeek(consumed.carbs)} />
            <MacroAvg label="Fat" grams={perWeek(consumed.fat)} />
          </View>
        </Card>
      ) : null}
    </View>
  );
}

function MacroAvg({ label, grams }: { label: string; grams: number }) {
  return (
    <View style={styles.macroRow}>
      <Text type="small" themeColor="textSecondary">
        {label}
      </Text>
      <Text type="smallBold">{grams} g avg</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { gap: Spacing.four },
  chartCard: { gap: Spacing.three },
  summaryCard: { gap: Spacing.two },
  macros: { gap: Spacing.one, marginTop: Spacing.one },
  macroRow: { flexDirection: 'row', justifyContent: 'space-between' },
  emptyBox: { alignItems: 'center', paddingVertical: Spacing.six },
  emptyText: { textAlign: 'center' },
});
