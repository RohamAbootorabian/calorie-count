/**
 * Today's numeric summary — calories + macros against the daily goals (plan 0014,
 * extracted in 0026 for reuse by Home AND the standalone Daily screen). Pure
 * presentational: it takes the already-fetched `totals` + `goals` and renders the
 * two cards; the host screen owns the data plumbing + gates.
 *
 * `progressFor` shares the divide-by-zero guard with the rings via `guardedRatio`
 * (a missing/zero goal → `hasGoal:false`, never NaN). PRIVACY: renders numbers as
 * plain text; never logs a value.
 */
import { StyleSheet, View, type DimensionValue } from 'react-native';

import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { Card, Text } from '@/shared/ui';

import { guardedRatio } from '../lib/guarded-ratio';
import type { DailyGoals } from '../lib/use-daily-goals';
import type { DailyTotals } from '../lib/use-daily-totals';

type Progress = { fraction: number; remaining: number; over: number; hasGoal: boolean };

/**
 * The single guarded progress helper — `goal > 0` is the only "has target" case.
 * Shares the divide-by-zero guard with the rings via `guardedRatio` (plan 0021 SF4);
 * here we clamp the fraction for the bar + derive remaining/over.
 */
function progressFor(consumed: number, goal: number | null | undefined): Progress {
  const ratio = guardedRatio(consumed, goal);
  if (ratio === null) {
    return { fraction: 0, remaining: 0, over: 0, hasGoal: false };
  }
  return {
    fraction: Math.min(ratio, 1),
    remaining: Math.max((goal as number) - consumed, 0),
    over: Math.max(consumed - (goal as number), 0),
    hasGoal: true,
  };
}

function round(n: number): number {
  return Math.round(n);
}

export function DailySummary({
  totals,
  goals,
}: {
  totals: DailyTotals;
  goals: DailyGoals | null;
}) {
  const cal = progressFor(totals.calories, goals?.calories);
  return (
    <>
      {/* Calories ----------------------------------------------------------- */}
      <Card style={styles.calCard}>
        <Text type="small" themeColor="textSecondary">
          Calories today
        </Text>
        {cal.hasGoal ? (
          <>
            <Text type="title">
              {round(totals.calories)} / {round(goals!.calories)} kcal
            </Text>
            <Text type="default" themeColor={cal.over > 0 ? 'danger' : 'textSecondary'}>
              {cal.over > 0 ? `over by ${round(cal.over)} kcal` : `${round(cal.remaining)} left`}
            </Text>
          </>
        ) : (
          <>
            <Text type="title">{round(totals.calories)} kcal</Text>
            <Text type="default" themeColor="textSecondary">
              Set your goals in Settings to track progress.
            </Text>
          </>
        )}
        <Bar fraction={cal.fraction} large />
      </Card>

      {/* Macros ------------------------------------------------------------- */}
      <Card style={styles.macroCard}>
        <MetricBar label="Protein" consumed={totals.protein} goal={goals?.protein} unit="g" />
        <MetricBar label="Carbs" consumed={totals.carbs} goal={goals?.carbs} unit="g" />
        <MetricBar label="Fat" consumed={totals.fat} goal={goals?.fat} unit="g" />
      </Card>
    </>
  );
}

// --- Subcomponents ----------------------------------------------------------

function Bar({ fraction, large }: { fraction: number; large?: boolean }) {
  const theme = useTheme();
  const width = `${Math.max(0, Math.min(fraction, 1)) * 100}%` as DimensionValue;
  return (
    <View style={[styles.track, large && styles.trackLg, { backgroundColor: theme.backgroundElement }]}>
      <View style={[styles.fill, { width, backgroundColor: theme.primary }]} />
    </View>
  );
}

function MetricBar({
  label,
  consumed,
  goal,
  unit,
}: {
  label: string;
  consumed: number;
  goal: number | null | undefined;
  unit: string;
}) {
  const p = progressFor(consumed, goal);
  return (
    <View style={styles.metric}>
      <View style={styles.metricTop}>
        <Text type="smallBold">{label}</Text>
        <Text type="small" themeColor="textSecondary">
          {p.hasGoal
            ? `${round(consumed)} / ${round(goal as number)} ${unit}`
            : `${round(consumed)} ${unit}`}
        </Text>
      </View>
      <Bar fraction={p.fraction} />
      {p.over > 0 && (
        <Text type="small" themeColor="danger">
          over by {round(p.over)} {unit}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  calCard: { gap: Spacing.two },
  macroCard: { gap: Spacing.three },
  metric: { gap: Spacing.one },
  metricTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  track: {
    height: 8,
    borderRadius: Radius.pill,
    overflow: 'hidden',
  },
  trackLg: { height: 12 },
  fill: { height: '100%', borderRadius: Radius.pill },
});
