/**
 * Weekly + monthly plan review (plans 0018–0025). A 7-day calorie bar chart + a
 * weekly average, a "This week's plan" rings card, and a "This month's plan" rings
 * card — all on one screen, presented over the tabs as a root `Stack.Screen`.
 *
 * Mirrors `dashboard-screen.tsx`: owns the SINGLE `useProfile()`, resolves the tz
 * (`resolveTimezone`), and passes it into the totals hooks. Gate order: profile/
 * weekly loading → spinner; profile error → Retry; weekly totals error → Retry.
 * BELOW those, the weekly section (bars + rings + average, or an inline empty note)
 * and the monthly rings card render under ONE `<Screen>` — the monthly card is
 * UNCONDITIONAL (plan 0025 B1: a ≥7-day recent gap must not hide month-to-date data).
 *
 * Bars encode CALORIES only; macros show as the weekly average (denominator = LOGGED
 * days only, so a partial week isn't diluted; 0 logged → "—", never NaN). The rings
 * (`PlanRingsCard`) show consumed ÷ (goal × elapsed) per macro; monthly loading/error
 * are handled INSIDE its card (plan 0025 SF3 — never in the screen's top gate).
 */
import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { ActivityIndicator, StyleSheet, View, type DimensionValue } from 'react-native';

import { Radius, Spacing } from '@/constants/theme';
import { resolveTimezone } from '@/features/auth/lib/profile-form';
import { useProfile } from '@/features/auth/lib/use-profile';
import { useTheme } from '@/hooks/use-theme';
import { useUser } from '@/lib/auth';
import { Button, Card, Screen, Text } from '@/shared/ui';

import { planMetrics } from '../lib/plan-progress';
import { useDailyGoals } from '../lib/use-daily-goals';
import { useMonthlyTotals } from '../lib/use-monthly-totals';
import { useWeeklyTotals, type DayTotals } from '../lib/use-weekly-totals';
import { weekPlanProgress } from '../lib/week-plan-progress';
import { PlanRingsCard } from './metric-ring';

const CHART_HEIGHT = 200;

function round(n: number): number {
  return Math.round(n);
}

/** Saturday-first display rank for a `YYYY-MM-DD` UTC key: Sat→0 … Fri→6 (plan 0021). */
function saturdayFirstRank(key: string): number {
  return (new Date(key).getUTCDay() + 1) % 7;
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
  const tz = resolveTimezone(profile?.timezone);
  const { days, loading, error, refetch } = useWeeklyTotals(tz);
  const {
    consumed: monthConsumed,
    elapsed: monthElapsed,
    mealCount: monthMealCount,
    loading: monthlyLoading,
    error: monthlyError,
    refetch: refetchMonthly,
  } = useMonthlyTotals(tz);

  // Calorie goal for the reference line + the rings — NON-FATAL (never gates the screen).
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
        refetchMonthly();
      }
    }, [userId, refetch, refetchGoals, refetchMonthly]),
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
  const weeklyEmpty = loggedDays.length === 0;

  const maxCalories = Math.max(...days.map((d) => d.calories));
  // Domain headroom ONLY when a goal exists, so the line never pins at the ceiling (plan 0019 B1).
  const domainMax = goalCal != null ? Math.max(maxCalories, goalCal * 1.1) : maxCalories;
  const avg = (select: (d: DayTotals) => number) =>
    loggedDays.length === 0
      ? 0
      : Math.round(loggedDays.reduce((sum, d) => sum + select(d), 0) / loggedDays.length);

  // Bars: same last-7-days data, re-ordered into a fixed Saturday→Friday layout (display-only).
  const displayDays = [...days].sort((a, b) => saturdayFirstRank(a.key) - saturdayFirstRank(b.key));

  const goalsMissing = !goalsLoading && goals == null;
  const week = weekPlanProgress(days, goals);
  const monthMetrics = planMetrics(monthConsumed, goals, monthElapsed);

  return (
    <Screen scroll contentContainerStyle={styles.screenContent}>
      {weeklyEmpty ? (
        <Card style={styles.summaryCard}>
          <Text type="default" themeColor="textSecondary" style={styles.centerText}>
            No meals in the last 7 days — snap one from Capture.
          </Text>
        </Card>
      ) : (
        <>
          <Card style={styles.chartCard}>
            <Text type="small" themeColor="textSecondary">
              Calories · last 7 days
              {goalCal != null ? ` · goal ${round(goalCal)} kcal` : ''}
            </Text>
            <View style={styles.chart}>
              {displayDays.map((day) => (
                <DayBar
                  key={day.key}
                  day={day}
                  domainMax={domainMax}
                  goalCal={goalCal}
                  isToday={day.isToday}
                />
              ))}
            </View>
          </Card>

          <PlanRingsCard
            title={`This week's plan · ${week.elapsed} of 7 day${week.elapsed === 1 ? '' : 's'}`}
            loading={goalsLoading}
            goalsMissing={goalsMissing}
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
        </>
      )}

      {/* Monthly plan — UNCONDITIONAL (plan 0025 B1); own gates handled in the card (SF3). */}
      <PlanRingsCard
        title={`This month's plan · ${monthElapsed} day${monthElapsed === 1 ? '' : 's'}`}
        loading={monthlyLoading || goalsLoading}
        error={monthlyError}
        goalsMissing={goalsMissing}
        emptyNote={monthMealCount === 0 ? 'No meals logged this month yet.' : undefined}
        metrics={monthMetrics}
      />
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
  // Vertical gap between cards.
  screenContent: { gap: Spacing.four },
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
