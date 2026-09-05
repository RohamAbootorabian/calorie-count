/**
 * Daily section of the Home switcher (plan 0027) — today's calories + macros. Bare
 * content (no `Screen`/scroll/insets; the host owns the frame). Takes the resolved `tz`
 * + shared `goals` from the host; owns only `useDailyTotals(tz)` + its focus-refetch +
 * inline gates.
 */
import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useUser } from '@/lib/auth';
import { Text } from '@/shared/ui';

import type { DailyGoals } from '../lib/use-daily-goals';
import { useDailyTotals } from '../lib/use-daily-totals';
import { DailySummary } from './daily-summary';
import { SectionError, SectionSpinner } from './section-status';

export function DailySection({ tz, goals }: { tz: string; goals: DailyGoals | null }) {
  const { user } = useUser();
  const userId = user?.id ?? null;
  const { totals, loading, error, refetch } = useDailyTotals(tz);

  useFocusEffect(
    useCallback(() => {
      if (userId) refetch();
    }, [userId, refetch]),
  );

  if (loading) return <SectionSpinner />;
  if (error) return <SectionError onRetry={refetch} />;

  return (
    <View style={styles.body}>
      <DailySummary totals={totals} goals={goals} />
      {totals.mealCount === 0 ? (
        <Text type="small" themeColor="textSecondary" style={styles.empty}>
          No meals logged today — snap one from Capture.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  body: { gap: Spacing.three },
  empty: { textAlign: 'center', marginTop: Spacing.two },
});
