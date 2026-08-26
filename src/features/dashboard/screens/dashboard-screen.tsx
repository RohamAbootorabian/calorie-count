/**
 * Daily totals dashboard — the Home tab (plan 0014). Shows today's consumed calories
 * + macros (P/C/F) from `meal_logs` against the user's `goals`, bounded to "today" in
 * the user's timezone.
 *
 * The screen owns the SINGLE `useProfile()` (tz + greeting), resolves the timezone
 * (stored tz → device tz → UTC), and passes it into `useDailyTotals(tz)` so there's
 * no second profile fetch and the totals re-bucket when the real tz arrives.
 *
 * Gate order (so 3 independent errors can't make a confusing partial screen):
 * loading (profile||totals) → spinner; profile error → Retry (no tz = no confident
 * totals); totals error → Retry; goals error is non-fatal (render totals, "no goals").
 *
 * `progressFor` is the ONE guarded helper used by all four metrics — `goal > 0` is the
 * only "has target" case, so a missing/zero goal never divides (no NaN/Infinity bar).
 *
 * Refetch-on-focus (totals + goals) so logging a meal or editing a goal reflects on
 * return to Home. Numbers are plain rounded integers (matches the History screen).
 */
import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { ActivityIndicator, type DimensionValue, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomTabInset, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { resolveTimezone } from '@/features/auth/lib/profile-form';
import { useProfile } from '@/features/auth/lib/use-profile';
import { useTheme } from '@/hooks/use-theme';
import { useUser } from '@/lib/auth';
import { Button, Card, Text } from '@/shared/ui';

import { guardedRatio } from '../lib/guarded-ratio';
import { useDailyGoals } from '../lib/use-daily-goals';
import { useDailyTotals } from '../lib/use-daily-totals';

type Progress = { fraction: number; remaining: number; over: number; hasGoal: boolean };

/**
 * The single guarded progress helper — `goal > 0` is the only "has target" case.
 * Shares the divide-by-zero guard with the weekly rings via `guardedRatio` (plan
 * 0021 SF4); here we clamp the fraction for the bar + derive remaining/over.
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

export default function DashboardScreen() {
  const { user } = useUser();
  const userId = user?.id ?? null;
  const {
    profile,
    loading: profileLoading,
    error: profileError,
    refetch: refetchProfile,
  } = useProfile();
  const tz = resolveTimezone(profile?.timezone);
  const {
    totals,
    loading: totalsLoading,
    error: totalsError,
    refetch: refetchTotals,
  } = useDailyTotals(tz);
  const { goals, refetch: refetchGoals } = useDailyGoals();
  const insets = useSafeAreaInsets();

  // Reflect a newly-logged meal / edited goal on return to the tab.
  useFocusEffect(
    useCallback(() => {
      if (userId) {
        refetchTotals();
        refetchGoals();
      }
    }, [userId, refetchTotals, refetchGoals]),
  );

  if (profileLoading || totalsLoading) {
    return (
      <Centered>
        <ActivityIndicator />
      </Centered>
    );
  }
  if (profileError) {
    return <ErrorState onRetry={refetchProfile} />;
  }
  if (totalsError) {
    return <ErrorState onRetry={refetchTotals} />;
  }

  const cal = progressFor(totals.calories, goals?.calories);
  const noMeals = totals.mealCount === 0;
  const name = profile?.display_name?.trim();

  return (
    <Screen insetTop={insets.top}>
      <View style={styles.header}>
        <Text type="subtitle">{name ? `Hi, ${name}` : 'Today'}</Text>
      </View>

      {/* Calories ------------------------------------------------------------- */}
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

      {/* Macros -------------------------------------------------------------- */}
      <Card style={styles.macroCard}>
        <MetricBar label="Protein" consumed={totals.protein} goal={goals?.protein} unit="g" />
        <MetricBar label="Carbs" consumed={totals.carbs} goal={goals?.carbs} unit="g" />
        <MetricBar label="Fat" consumed={totals.fat} goal={goals?.fat} unit="g" />
      </Card>

      {/* Weekly trend (plan 0018) — opens the 7-day trend over the tabs. */}
      <Button variant="secondary" onPress={() => router.push('/trends')}>
        Weekly trend →
      </Button>

      {noMeals && (
        <Text type="small" themeColor="textSecondary" style={styles.empty}>
          No meals logged today — snap one from Capture.
        </Text>
      )}
    </Screen>
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

function Screen({ insetTop, children }: { insetTop: number; children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View style={[styles.flex, { backgroundColor: theme.background }]}>
      <View
        style={[
          styles.content,
          { paddingTop: insetTop + Spacing.three, paddingBottom: BottomTabInset + Spacing.four },
        ]}
      >
        {children}
      </View>
    </View>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View style={[styles.flex, styles.centered, { backgroundColor: theme.background }]}>
      {children}
    </View>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <Centered>
      <Text type="default" themeColor="textSecondary" style={styles.centerText}>
        Couldn&apos;t load your day.
      </Text>
      <Button onPress={onRetry}>Retry</Button>
    </Centered>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
  },
  centerText: { textAlign: 'center' },
  content: {
    paddingHorizontal: Spacing.four,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    gap: Spacing.three,
  },
  header: { marginBottom: Spacing.one },
  calCard: { gap: Spacing.two },
  macroCard: { gap: Spacing.three },
  empty: { textAlign: 'center', marginTop: Spacing.two },
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
