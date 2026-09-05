/**
 * A small 3-up toggle row (plan 0027) — the Daily / Weekly / Monthly switcher on Home.
 * Built from its own pressables (NOT the DS `Button`, which hardcodes padding + no
 * `numberOfLines`, so "Monthly" would wrap at large text). Selected = primary fill;
 * unselected = bordered secondary. Theme-token colors only.
 */
import { Pressable, StyleSheet, View } from 'react-native';

import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { Text } from '@/shared/ui';

export type SegmentOption<T extends string> = { value: T; label: string };

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: SegmentOption<T>[];
  onChange: (value: T) => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.row} accessibilityRole="tablist">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            style={[
              styles.segment,
              {
                backgroundColor: selected ? theme.primary : theme.background,
                borderColor: selected ? theme.primary : theme.border,
              },
            ]}
          >
            <Text
              type="smallBold"
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.7}
              style={[styles.label, { color: selected ? theme.primaryText : theme.text }]}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: Spacing.two },
  segment: {
    flex: 1,
    minHeight: 40,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.one,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { textAlign: 'center' },
});
