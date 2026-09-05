/**
 * Shared calorie bar chart (plan 0027, extracted from the weekly `DayBar` for reuse by
 * the weekly 7-day chart AND the monthly 4-week chart). A row of bars scaled to
 * `domainMax`, an optional flat goal line, a top value label (blanked when the bar has
 * no data), a bottom category label, and a highlighted "current" bar.
 *
 * Generic value-space: `value`/`goalValue` are whatever the caller measures — weekly
 * per-day calories vs. the daily goal, or monthly per-week calories vs. the weekly goal
 * (daily × 7). The chart treats `goalValue` as a single scalar reference line.
 *
 * PRIVACY: renders numbers as plain text; never logs a value.
 */
import { StyleSheet, View, type DimensionValue } from 'react-native';

import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { Text } from '@/shared/ui';

const CHART_HEIGHT = 200;

export type ChartBar = {
  /** Stable React key. */
  key: string;
  /** Bottom category label (e.g. "Mon", "Wk 1"). */
  label: string;
  value: number;
  /** Highlighted (full opacity) — e.g. today / the current week. */
  isCurrent: boolean;
  /** Whether this period has logged data — false blanks the top value label (not "0"). */
  hasData: boolean;
};

export function CalorieBarChart({
  bars,
  domainMax,
  goalValue,
}: {
  bars: ChartBar[];
  domainMax: number;
  /** Optional flat reference line (same value-space as `value`); null = no line. */
  goalValue: number | null;
}) {
  return (
    <View style={styles.chart}>
      {bars.map((bar) => (
        <Bar key={bar.key} bar={bar} domainMax={domainMax} goalValue={goalValue} />
      ))}
    </View>
  );
}

function round(n: number): number {
  return Math.round(n);
}

function Bar({
  bar,
  domainMax,
  goalValue,
}: {
  bar: ChartBar;
  domainMax: number;
  goalValue: number | null;
}) {
  const theme = useTheme();
  // Guard domainMax>0 so an all-zero + no-goal chart renders flat empty bars (no /0).
  const height = (domainMax > 0 ? (bar.value / domainMax) * 100 : 0) + '%';
  // The goal line shares the track's coordinate space with the fill (both % of the track),
  // so it aligns with no pixel math; clamp ≤95% so it never sits on the track's top edge.
  const goalBottom =
    goalValue != null && domainMax > 0
      ? Math.min((goalValue / domainMax) * 100, 95) + '%'
      : null;
  return (
    <View style={styles.col}>
      <Text
        type="smallBold"
        style={styles.valueLabel}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.6}
      >
        {bar.hasData ? round(bar.value) : ''}
      </Text>
      <View style={[styles.track, { backgroundColor: theme.backgroundElement }]}>
        <View
          style={[
            styles.fill,
            {
              height: height as DimensionValue,
              backgroundColor: theme.primary,
              opacity: bar.isCurrent ? 1 : 0.45,
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
      <Text type="small" themeColor="textSecondary" style={styles.categoryLabel}>
        {bar.label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.two,
    height: CHART_HEIGHT,
  },
  col: { flex: 1, alignItems: 'center', gap: Spacing.two, height: '100%' },
  valueLabel: { minHeight: 16, marginBottom: Spacing.one, textAlign: 'center' },
  categoryLabel: { marginTop: Spacing.two },
  track: {
    flex: 1,
    width: '100%',
    borderRadius: Radius.sm,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  fill: { width: '100%', borderRadius: Radius.sm },
  goalLine: { position: 'absolute', left: 0, right: 0, height: 1.5 },
});
