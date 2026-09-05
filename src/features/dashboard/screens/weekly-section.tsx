/**
 * Weekly section of the Home switcher (plan 0027) — the 7-day calorie bar chart
 * (Saturday→Friday, today highlighted, goal line), the "This week's plan" rings, and the
 * weekly average. Bare content (the host owns the frame); takes `tz` + `goals`; owns only
 * `useWeeklyTotals(tz)` + its focus-refetch + inline gates.
 */
import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useUser } from '@/lib/auth';
import { Card, Text } from '@/shared/ui';

import type { DailyGoals } from '../lib/use-daily-goals';
import { useWeeklyTotals, type DayTotals } from '../lib/use-weekly-totals';
import { weekPlanProgress } from '../lib/week-plan-progress';
import { CalorieBarChart, type ChartBar } from './calorie-bar-chart';
import { PlanRingsCard } from './metric-ring';
import { SectionError, SectionSpinner } from './section-status';

/** Saturday-first display rank for a `YYYY-MM-DD` UTC key: Sat→0 … Fri→6 (plan 0021). */
function saturdayFirstRank(key: string): number {
  return (new Date(key).getUTCDay() + 1) % 7;
}

function round(n: number): number {
  return Math.round(n);
}

export function WeeklySection({
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
  const { days, loading, error, refetch } = useWeeklyTotals(tz);

  useFocusEffect(
    useCallback(() => {
      if (userId) refetch();
    }, [userId, refetch]),
  );

  if (loading) return <SectionSpinner />;
  if (error) return <SectionError onRetry={refetch} />;

  const loggedDays = days.filter((d) => d.mealCount > 0);
  if (loggedDays.length === 0) {
    return (
      <View style={styles.emptyBox}>
        <Text type="default" themeColor="textSecondary" style={styles.emptyText}>
          No meals in the last 7 days — snap one from Capture.
        </Text>
      </View>
    );
  }

  const goalCal =
    typeof goals?.calories === 'number' && goals.calories > 0 ? goals.calories : null;
  const maxCalories = Math.max(...days.map((d) => d.calories));
  const domainMax = goalCal != null ? Math.max(maxCalories, goalCal * 1.1) : maxCalories;
  const avg = (select: (d: DayTotals) => number) =>
    Math.round(loggedDays.reduce((sum, d) => sum + select(d), 0) / loggedDays.length);

  // Same last-7-days data, re-ordered into a fixed Saturday→Friday layout (display-only).
  const bars: ChartBar[] = [...days]
    .sort((a, b) => saturdayFirstRank(a.key) - saturdayFirstRank(b.key))
    .map((d) => ({
      key: d.key,
      label: d.weekdayLabel,
      value: d.calories,
      isCurrent: d.isToday,
      hasData: d.mealCount > 0,
    }));

  const week = weekPlanProgress(days, goals);

  return (
    <View style={styles.body}>
      <Card style={styles.chartCard}>
        <Text type="small" themeColor="textSecondary">
          Calories · last 7 days
          {goalCal != null ? ` · goal ${round(goalCal)} kcal` : ''}
        </Text>
        <CalorieBarChart bars={bars} domainMax={domainMax} goalValue={goalCal} />
      </Card>

      <PlanRingsCard
        title={`This week's plan · ${week.elapsed} of 7 day${week.elapsed === 1 ? '' : 's'}`}
        loading={goalsLoading}
        goalsMissing={!goalsLoading && goals == null}
        metrics={week}
      />

      <Card style={styles.summaryCard}>
        <Text type="small" themeColor="textSecondary">
          Weekly average · over {loggedDays.length} logged day
          {loggedDays.length === 1 ? '' : 's'}
        </Text>
        <Text type="subtitle">{avg((d) => d.calories)} kcal / day</Text>
        <View style={styles.macros}>
          <MacroAvg label="Protein" grams={avg((d) => d.protein)} />
          <MacroAvg label="Carbs" grams={avg((d) => d.carbs)} />
          <MacroAvg label="Fat" grams={avg((d) => d.fat)} />
        </View>
      </Card>
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
