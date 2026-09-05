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
 * Pure-`View` donut progress ring (plan 0021, geometry rewritten in 0026 — no SVG,
 * no new dependency). The **overflow-clip two-half** technique, whose fill is exactly
 * `fraction × 360°` (the earlier border-arc trick over-filled — the arc didn't match
 * the percent).
 *
 * A full track ring, then TWO half-annulus "domes" — a top semicircular arc (top
 * radii + no bottom border) rotated about the ring centre (`transformOrigin` at its
 * bottom-centre) and CLIPPED to one side by an `overflow:'hidden'` half-container, so
 * only the swept wedge shows. The fill grows 12 o'clock → clockwise:
 *   - right half sweeps the first 0–180° at `rotate = min(deg,180) − 90`;
 *   - left half sweeps 180–360° at `rotate = max(deg−180,0) + 90`.
 * `fraction` is clamped to [0,1] so an over-target value fills fully (the real % lives
 * in the centre label).
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
  const deg = Math.min(Math.max(fraction, 0), 1) * 360;
  const rightRotate = Math.min(deg, 180) - 90; // right half fills first (0–180°).
  const leftRotate = Math.max(deg - 180, 0) + 90; // left half fills second (180–360°).
  return (
    <View style={styles.ringWrap}>
      <View style={[styles.ringLayer, { borderColor: trackColor }]} />
      <View style={styles.rightClip}>
        <View
          style={[styles.arcDomeRight, { borderColor: color, transform: [{ rotate: `${rightRotate}deg` }] }]}
        />
      </View>
      <View style={styles.leftClip}>
        <View
          style={[styles.arcDomeLeft, { borderColor: color, transform: [{ rotate: `${leftRotate}deg` }] }]}
        />
      </View>
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
  // Each half of the box, clipping its rotating dome so only the swept wedge shows.
  rightClip: {
    position: 'absolute',
    left: RING_SIZE / 2,
    top: 0,
    width: RING_SIZE / 2,
    height: RING_SIZE,
    overflow: 'hidden',
  },
  leftClip: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: RING_SIZE / 2,
    height: RING_SIZE,
    overflow: 'hidden',
  },
  // Top semicircular arc (half annulus): full-width, half-height, top radii, no bottom
  // border; rotated about the ring centre (its own bottom-centre). `left` places it so
  // it spans the whole box inside its half clip.
  arcDomeRight: {
    position: 'absolute',
    left: -RING_SIZE / 2,
    top: 0,
    width: RING_SIZE,
    height: RING_SIZE / 2,
    borderTopLeftRadius: RING_SIZE / 2,
    borderTopRightRadius: RING_SIZE / 2,
    borderWidth: RING_THICKNESS,
    borderBottomWidth: 0,
    transformOrigin: '50% 100%',
  },
  arcDomeLeft: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: RING_SIZE,
    height: RING_SIZE / 2,
    borderTopLeftRadius: RING_SIZE / 2,
    borderTopRightRadius: RING_SIZE / 2,
    borderWidth: RING_THICKNESS,
    borderBottomWidth: 0,
    transformOrigin: '50% 100%',
  },
});
