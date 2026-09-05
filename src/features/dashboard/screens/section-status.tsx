/**
 * Inline loading / error states for the Home switcher's sections (plan 0027). They
 * render WITHIN the host's scroll region (below the pinned control) — NOT a full-screen
 * `Screen` — so the switcher stays usable while a section loads or retries.
 */
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { Button, Text } from '@/shared/ui';

export function SectionSpinner() {
  return (
    <View style={styles.center}>
      <ActivityIndicator />
    </View>
  );
}

export function SectionError({ onRetry }: { onRetry: () => void }) {
  return (
    <View style={styles.center}>
      <Text type="default" themeColor="textSecondary" style={styles.text}>
        Couldn&apos;t load this section.
      </Text>
      <Button onPress={onRetry}>Retry</Button>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', gap: Spacing.three, paddingVertical: Spacing.six },
  text: { textAlign: 'center' },
});
