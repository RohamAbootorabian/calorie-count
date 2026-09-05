/**
 * Shared plan-progress rings (plan 0021, extracted in 0025 for reuse by the weekly
 * AND monthly Trend cards). Dashboard-local (not `shared/ui`) — it bakes in the
 * `MetricProgress` shape + the over-target→`danger` rule, so it isn't a generic
 * primitive (mirrors `meal-editor-form.tsx` living in `capture/screens/`).
 *
 * `ProgressRing` is a pure-`View` donut (no SVG, no new dependency): the classic
 * two-layer border-arc technique. `PlanRingsCard` wraps the four rings with the
 * shared loading / error / no-goal / empty gates so neither Trend card duplicates
 * that JSX.
 *
 * PRIVACY: renders the percent/consumed/target as plain text; never logs a value.
 */
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { Card, Text } from '@/shared/ui';
import type { ReactNode } from 'react';

import type { MetricProgress, PlanMetrics } from '../lib/plan-progress';

const RING_SIZE = 76;
const RING_THICKNESS = 8;

function round(n: number): number {
  return Math.round(n);
}

/** Center label: rounded percent, capped so an absurd value can't overflow the donut. */
function formatPercent(percent: number | null): string {
  if (percent === null) return '—';
  const pct = Math.round(percent * 100);
  return pct > 999 ? '999%+' : `${pct}%`;
}

/**
 * A titled card of four rings with shared gates (plan 0025). Precedence:
 * loading → error → goalsMissing → emptyNote → the four rings.
 */
export function PlanRingsCard({
  title,
  loading,
  error,
  goalsMissing,
  emptyNote,
  metrics,
}: {
  title: string;
  loading?: boolean;
  error?: boolean;
  goalsMissing: boolean;
  /** Shown (instead of rings) when there's a plan but no meals in range. */
  emptyNote?: string;
  metrics?: PlanMetrics;
}) {
  return (
    <Card style={styles.card}>
      <Text type="small" themeColor="textSecondary">
        {title}
      </Text>
      {loading ? (
        <View style={styles.ringsLoading}>
          <ActivityIndicator />
        </View>
      ) : error ? (
        <Text type="small" themeColor="textSecondary">
          Couldn&apos;t load this section — pull back to refresh.
        </Text>
      ) : goalsMissing ? (
        <Text type="small" themeColor="textSecondary">
          Set your goals in Settings to see your progress.
        </Text>
      ) : emptyNote ? (
        <Text type="small" themeColor="textSecondary">
          {emptyNote}
        </Text>
      ) : metrics ? (
        <View style={styles.rings}>
          <MetricRing label="Calories" unit="kcal" metric={metrics.calories} />
          <MetricRing label="Protein" unit="g" metric={metrics.protein} />
          <MetricRing label="Carbs" unit="g" metric={metrics.carbs} />
          <MetricRing label="Fat" unit="g" metric={metrics.fat} />
        </View>
      ) : null}
    </Card>
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
          minimumFontScale={0.5}
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

const styles = StyleSheet.create({
  card: { gap: Spacing.two },
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
  // Consumed/target subtext: smaller base + auto-shrink so a long value (weekly
  // "1715/17148 kcal" or a 6-digit monthly total) fits the ring width (0021/0025).
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
