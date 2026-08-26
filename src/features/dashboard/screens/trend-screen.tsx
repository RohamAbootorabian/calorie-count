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

import { useWeeklyTotals, type DayTotals } from '../lib/use-weekly-totals';

const CHART_HEIGHT = 180;

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

  // Reflect a newly-logged / edited meal on return to the screen.
  useFocusEffect(
    useCallback(() => {
      if (userId) refetch();
    }, [userId, refetch]),
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
  const avg = (select: (d: DayTotals) => number) =>
    Math.round(loggedDays.reduce((sum, d) => sum + select(d), 0) / loggedDays.length);

  return (
    <Screen scroll>
      <Card style={styles.chartCard}>
        <Text type="small" themeColor="textSecondary">
          Calories · last 7 days
        </Text>
        <View style={styles.chart}>
          {days.map((day, i) => (
            <DayBar
              key={day.key}
              day={day}
              maxCalories={maxCalories}
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
  maxCalories,
  isToday,
}: {
  day: DayTotals;
  maxCalories: number;
  isToday: boolean;
}) {
  const theme = useTheme();
  const hasMeals = day.mealCount > 0;
  // Guard maxCalories>0 so an all-zero week renders flat empty bars (no divide-by-zero).
  const height = (maxCalories > 0 ? (day.calories / maxCalories) * 100 : 0) + '%';
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
      </View>
      <Text type="small" themeColor="textSecondary">
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
  col: { flex: 1, alignItems: 'center', gap: Spacing.one, height: '100%' },
  calLabel: { minHeight: 16 },
  track: {
    flex: 1,
    width: '100%',
    borderRadius: Radius.sm,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  fill: { width: '100%', borderRadius: Radius.sm },
  summaryCard: { gap: Spacing.two },
  macros: { gap: Spacing.one, marginTop: Spacing.one },
  macroRow: { flexDirection: 'row', justifyContent: 'space-between' },
});
