/**
 * Weekly calorie trend (plan 0018) — a 7-day bar chart of daily calories + a weekly
 * average summary. Presented over the tabs as a root `Stack.Screen` (reached from the
 * dashboard's "Weekly trend" button).
 *
 * Mirrors `dashboard-screen.tsx`: owns the SINGLE `useProfile()`, resolves the timezone
 * (stored tz → device tz → UTC), and passes it into `useWeeklyTotals(tz)`. Gate order:
 * loading (profile||totals) → spinner; profile error → Retry; totals error → Retry;
 * all-7-empty → friendly empty state.
 *
 * Bars encode CALORIES only (no per-macro color token exists); macros show as the weekly
 * average. The average denominator is LOGGED days only (mealCount > 0), so a partial week
 * isn't diluted; 0 logged days shows "—", never NaN.
 */
import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { ActivityIndicator, StyleSheet, View, type DimensionValue } from 'react-native';

import { Radius, Spacing } from '@/constants/theme';
import { getDeviceTimezone } from '@/features/auth/lib/profile-form';
import { useProfile } from '@/features/auth/lib/use-profile';
import { useTheme } from '@/hooks/use-theme';
import { useUser } from '@/lib/auth';
import { Button, Card, Screen, Text } from '@/shared/ui';

import { useDailyGoals } from '../lib/use-daily-goals';
import { useWeeklyTotals, type DayTotals } from '../lib/use-weekly-totals';

const CHART_HEIGHT = 200;

function round(n: number): number {
  return Math.round(n);
}

export default function TrendScreen() {
  const { user } = useUser();
  const userId = user?.id ?? null;
  const {
    profile,
    loading: profileLoading,
    error: profileError,
    refetch: refetchProfile,
  } = useProfile();
  const tz = profile?.timezone?.trim() || getDeviceTimezone() || 'UTC';
  const { days, loading, error, refetch } = useWeeklyTotals(tz);

  // Calorie goal for the reference line — NON-FATAL (never gates the chart; plan 0019).
  // Derived during render (a hold-last-value cache via ref/state is blocked by the
  // react-compiler lint rules); the brief line-drop while a goals refetch is in flight is
  // masked by the totals loading gate (the whole chart is a spinner then, and the single-row
  // goals query resolves before the 8-day totals query). Health data — never logged.
  const { goals, loading: goalsLoading, refetch: refetchGoals } = useDailyGoals();
  const goalCal =
    !goalsLoading && typeof goals?.calories === 'number' && goals.calories > 0
      ? goals.calories
      : null;

  // Reflect a newly-logged / edited meal + an edited goal on return to the screen.
  useFocusEffect(
    useCallback(() => {
      if (userId) {
        refetch();
        refetchGoals();
      }
    }, [userId, refetch, refetchGoals]),
  );

  if (profileLoading || loading) {
    return (
      <Screen>
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      </Screen>
    );
  }
  if (profileError) return <ErrorState onRetry={refetchProfile} />;
  if (error) return <ErrorState onRetry={refetch} />;

  const loggedDays = days.filter((d) => d.mealCount > 0);
  if (loggedDays.length === 0) {
    return (
      <Screen>
        <View style={styles.center}>
          <Text type="default" themeColor="textSecondary" style={styles.centerText}>
            No meals in the last 7 days — snap one from Capture.
          </Text>
        </View>
      </Screen>
    );
  }

  const maxCalories = Math.max(...days.map((d) => d.calories));
  // Domain headroom ONLY when a goal exists, so the line never pins at the ceiling and the
  // no-goal path stays identical to 0018 (bars fill fully to maxCalories). (plan 0019, B1)
  const domainMax = goalCal != null ? Math.max(maxCalories, goalCal * 1.1) : maxCalories;
  const avg = (select: (d: DayTotals) => number) =>
    Math.round(loggedDays.reduce((sum, d) => sum + select(d), 0) / loggedDays.length);

  return (
    <Screen scroll>
      <Card style={styles.chartCard}>
        <Text type="small" themeColor="textSecondary">
          Calories · last 7 days
          {goalCal != null ? ` · goal ${round(goalCal)} kcal` : ''}
        </Text>
        <View style={styles.chart}>
          {days.map((day, i) => (
            <DayBar
              key={day.key}
              day={day}
              domainMax={domainMax}
              goalCal={goalCal}
              isToday={i === days.length - 1}
            />
          ))}
        </View>
      </Card>

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
    </Screen>
  );
}

// --- Subcomponents ----------------------------------------------------------

function DayBar({
  day,
  domainMax,
  goalCal,
  isToday,
}: {
  day: DayTotals;
  domainMax: number;
  goalCal: number | null;
  isToday: boolean;
}) {
  const theme = useTheme();
  const hasMeals = day.mealCount > 0;
  // Guard domainMax>0 so an all-zero + no-goal week renders flat empty bars (no /0).
  const height = (domainMax > 0 ? (day.calories / domainMax) * 100 : 0) + '%';
  // The goal line shares the track's coordinate space with the fill (both % of the track),
  // so it aligns with no pixel math; clamp ≤95% so it never sits on the track's top edge.
  const goalBottom =
    goalCal != null && domainMax > 0
      ? Math.min((goalCal / domainMax) * 100, 95) + '%'
      : null;
  return (
    <View style={styles.col}>
      <Text type="smallBold" style={styles.calLabel}>
        {hasMeals ? round(day.calories) : ''}
      </Text>
      <View style={[styles.track, { backgroundColor: theme.backgroundElement }]}>
        <View
          style={[
            styles.fill,
            {
              height: height as DimensionValue,
              backgroundColor: theme.primary,
              opacity: isToday ? 1 : 0.45,
            },
          ]}
        />
        {goalBottom != null && (
          <View
            style={[
              styles.goalLine,
              { bottom: goalBottom as DimensionValue, backgroundColor: theme.textSecondary },
            ]}
          />
        )}
      </View>
      <Text type="small" themeColor="textSecondary" style={styles.dayLabel}>
        {day.weekdayLabel}
      </Text>
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

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <Screen>
      <View style={styles.center}>
        <Text type="default" themeColor="textSecondary" style={styles.centerText}>
          Couldn&apos;t load your trend.
        </Text>
        <Button onPress={onRetry}>Retry</Button>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.three,
  },
  centerText: { textAlign: 'center' },
  chartCard: { gap: Spacing.three },
  chart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.two,
    height: CHART_HEIGHT,
  },
  col: { flex: 1, alignItems: 'center', gap: Spacing.two, height: '100%' },
  calLabel: { minHeight: 16, marginBottom: Spacing.one },
  // Extra breathing room so the weekday sits clearly below the bars, not glued to them.
  dayLabel: { marginTop: Spacing.two },
  track: {
    flex: 1,
    width: '100%',
    borderRadius: Radius.sm,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  fill: { width: '100%', borderRadius: Radius.sm },
  goalLine: { position: 'absolute', left: 0, right: 0, height: 1.5 },
  summaryCard: { gap: Spacing.two },
  macros: { gap: Spacing.one, marginTop: Spacing.one },
  macroRow: { flexDirection: 'row', justifyContent: 'space-between' },
});
