/**
 * Home tab (plan 0027) — a Daily / Weekly / Monthly segmented switcher. Opens on Daily
 * (cold start; the last-chosen section is remembered across in-app tab switches) and
 * swaps the view IN PLACE (no navigation).
 *
 * The host owns the FRAME + the SHARED plumbing: `useResolvedTz` (tz + greeting +
 * profile gate) and `useDailyGoals` (goals, focus-refetched here). It pins the greeting +
 * `SegmentedControl` above a single `ScrollView`; only the active section is mounted
 * (whole-component conditional render → rules-of-hooks safe; only that section's period
 * hook fetches). `tz` + `goals` flow down as props. The profile gate renders BELOW the
 * pinned control so the switcher stays usable.
 */
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useUser } from '@/lib/auth';
import { Text } from '@/shared/ui';

import { useDailyGoals } from '../lib/use-daily-goals';
import { useResolvedTz } from '../lib/use-resolved-tz';
import { DailySection } from './daily-section';
import { MonthlySection } from './monthly-section';
import { SectionError, SectionSpinner } from './section-status';
import { SegmentedControl, type SegmentOption } from './segmented-control';
import { WeeklySection } from './weekly-section';

type Section = 'daily' | 'weekly' | 'monthly';

const SECTIONS: SegmentOption<Section>[] = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
];

export default function DashboardScreen() {
  const { user } = useUser();
  const userId = user?.id ?? null;
  const [section, setSection] = useState<Section>('daily');
  const { tz, profile, profileLoading, profileError, refetchProfile } = useResolvedTz();
  const { goals, loading: goalsLoading, refetch: refetchGoals } = useDailyGoals();
  const insets = useSafeAreaInsets();
  const theme = useTheme();

  useFocusEffect(
    useCallback(() => {
      if (userId) refetchGoals();
    }, [userId, refetchGoals]),
  );

  const name = profile?.display_name?.trim();

  return (
    <View style={[styles.flex, { backgroundColor: theme.background }]}>
      <View style={[styles.frame, { paddingTop: insets.top + Spacing.three }]}>
        <Text type="subtitle">{name ? `Hi, ${name}` : 'Today'}</Text>
        <SegmentedControl value={section} options={SECTIONS} onChange={setSection} />
      </View>

      <ScrollView style={styles.flex} contentContainerStyle={styles.scrollContent}>
        {profileLoading ? (
          <SectionSpinner />
        ) : profileError ? (
          <SectionError onRetry={refetchProfile} />
        ) : section === 'daily' ? (
          <DailySection tz={tz} goals={goals} />
        ) : section === 'weekly' ? (
          <WeeklySection tz={tz} goals={goals} goalsLoading={goalsLoading} />
        ) : (
          <MonthlySection tz={tz} goals={goals} goalsLoading={goalsLoading} />
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  frame: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.three,
    gap: Spacing.three,
  },
  scrollContent: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: Spacing.four,
    paddingBottom: BottomTabInset + Spacing.four,
  },
});
