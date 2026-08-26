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
import { useCallback, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View, type DimensionValue } from 'react-native';

import { Radius, Spacing } from '@/constants/theme';
import { resolveTimezone } from '@/features/auth/lib/profile-form';
import { useProfile } from '@/features/auth/lib/use-profile';
import { useTheme } from '@/hooks/use-theme';
import { useUser } from '@/lib/auth';
import { Button, Card, Screen, Text } from '@/shared/ui';

import { useDailyGoals } from '../lib/use-daily-goals';
import { useWeeklyTotals, type DayTotals } from '../lib/use-weekly-totals';
import { weekPlanProgress, type MetricProgress } from '../lib/week-plan-progress';

const CHART_HEIGHT = 200;
const RING_SIZE = 76;
const RING_THICKNESS = 8;

function round(n: number): number {
  return Math.round(n);
}

/** Saturday-first display rank for a `YYYY-MM-DD` UTC key: Sat→0 … Fri→6 (plan 0021). */
function saturdayFirstRank(key: string): number {
  return (new Date(key).getUTCDay() + 1) % 7;
}

/** Center label: rounded percent, capped so an absurd value can't overflow the donut. */
function formatPercent(percent: number | null): string {
  if (percent === null) return '—';
  const pct = Math.round(percent * 100);
  return pct > 999 ? '999%+' : `${pct}%`;
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

  // Bars: same last-7-days data, re-ordered into a fixed Saturday→Friday layout (plan 0021).
  // `days` stays chronological (the plan rings below depend on it); this is display-only.
  const displayDays = [...days].sort((a, b) => saturdayFirstRank(a.key) - saturdayFirstRank(b.key));

  // "This week's plan, so far" rings — computed AFTER the gates, where `days` is length-7
  // (plan 0021 SF2). Goals may be null/loading — non-fatal (handled in the rings card).
  const plan = weekPlanProgress(days, goals);

  return (
    <Screen scroll contentContainerStyle={styles.screenContent}>
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

      {/* This week's plan progress — four rings (plan 0021). */}
      <Card style={styles.summaryCard}>
        <Text type="small" themeColor="textSecondary">
          This week&apos;s plan · {plan.elapsed} of 7 day{plan.elapsed === 1 ? '' : 's'}
        </Text>
        {goalsLoading ? (
          <View style={styles.ringsLoading}>
            <ActivityIndicator />
          </View>
        ) : goals == null ? (
          <Text type="small" themeColor="textSecondary">
            Set your goals in Settings to see weekly progress.
          </Text>
        ) : (
          <View style={styles.rings}>
            <MetricRing label="Calories" unit="kcal" metric={plan.calories} />
            <MetricRing label="Protein" unit="g" metric={plan.protein} />
            <MetricRing label="Carbs" unit="g" metric={plan.carbs} />
            <MetricRing label="Fat" unit="g" metric={plan.fat} />
          </View>
        )}
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

/** One plan-progress ring: donut + center percent + label + consumed/target. */
function MetricRing({
  label,
  unit,
  metric,
}: {
  label: string;
  unit: string;
  metric: MetricProgress;
}) {
  const theme = useTheme();
  // Over-target (real % > 100) → danger color; the ring still fills to a visual cap.
  const over = metric.percent != null && metric.percent > 1;
  const color = over ? theme.danger : theme.primary;
  return (
    <View style={styles.ring}>
      <ProgressRing fraction={metric.percent ?? 0} color={color} trackColor={theme.backgroundElement}>
        <Text type="smallBold" numberOfLines={1} adjustsFontSizeToFit style={styles.ringCenter}>
          {formatPercent(metric.percent)}
        </Text>
      </ProgressRing>
      <Text type="smallBold" style={styles.ringLabel}>
        {label}
      </Text>
      {metric.percent != null ? (
        <Text
          type="small"
          themeColor="textSecondary"
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.6}
          style={styles.ringSub}
        >
          {round(metric.consumed)}/{round(metric.target)} {unit}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * Pure-`View` donut progress ring (plan 0021 — no SVG, no new dependency). The
 * classic two-layer border-arc technique: a full track ring, a top+right-bordered
 * half-ring rotated to sweep the first 0–50%, then either a track-colored "offset"
 * layer that re-hides the left half (≤50%) or a second colored half-ring that sweeps
 * 50–100% (>50%). Arc starts at 12 o'clock, clockwise. `fraction` is clamped to
 * [0,1] so an over-target value fills fully (the real % lives in the center label).
 */
function ProgressRing({
  fraction,
  color,
  trackColor,
  children,
}: {
  fraction: number;
  color: string;
  trackColor: string;
  children: ReactNode;
}) {
  const pct = Math.min(Math.max(fraction, 0), 1) * 100;
  const firstRotate = pct > 50 ? '45deg' : `${pct * 3.6 - 135}deg`;
  return (
    <View style={styles.ringWrap}>
      <View style={[styles.ringLayer, { borderColor: trackColor }]} />
      <View
        style={[
          styles.ringArc,
          { borderTopColor: color, borderRightColor: color, transform: [{ rotateZ: firstRotate }] },
        ]}
      />
      {pct <= 50 ? (
        <View
          style={[
            styles.ringArc,
            {
              borderTopColor: trackColor,
              borderRightColor: trackColor,
              transform: [{ rotateZ: '-135deg' }],
            },
          ]}
        />
      ) : (
        <View
          style={[
            styles.ringArc,
            {
              borderTopColor: color,
              borderRightColor: color,
              transform: [{ rotateZ: `${(pct - 50) * 3.6 - 135}deg` }],
            },
          ]}
        />
      )}
      {children}
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
  // Vertical gap between the chart card and the summary card.
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
  // Plan-progress rings (0021).
  rings: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-around',
    gap: Spacing.three,
    marginTop: Spacing.two,
  },
  ringsLoading: { alignItems: 'center', paddingVertical: Spacing.three },
  ring: { alignItems: 'center', gap: Spacing.one, width: RING_SIZE },
  ringLabel: { marginTop: Spacing.one },
  ringCenter: { width: RING_SIZE - RING_THICKNESS * 2 - 6, textAlign: 'center' },
  // Consumed/target subtext: smaller base + auto-shrink so a long calories value
  // (e.g. "1715/17148 kcal") fits the ring's width without truncating (0021 polish).
  ringSub: { fontSize: 12, lineHeight: 16, textAlign: 'center' },
  ringWrap: { width: RING_SIZE, height: RING_SIZE, alignItems: 'center', justifyContent: 'center' },
  ringLayer: {
    position: 'absolute',
    width: RING_SIZE,
    height: RING_SIZE,
    borderRadius: RING_SIZE / 2,
    borderWidth: RING_THICKNESS,
  },
  ringArc: {
    position: 'absolute',
    width: RING_SIZE,
    height: RING_SIZE,
    borderRadius: RING_SIZE / 2,
    borderWidth: RING_THICKNESS,
    borderLeftColor: 'transparent',
    borderBottomColor: 'transparent',
  },
});
