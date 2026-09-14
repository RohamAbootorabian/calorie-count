/**
 * Full-width selectable rows built from `Button` (SF3 — no new primitive), shared by the
 * onboarding wizard and the settings screen (plan 0039 — extracted from two byte-identical
 * local copies). Feature-local (auth screens only), mirroring `HealthQuestion` — not general
 * enough for the shared `@/shared/ui` kit.
 *
 * Generic over the option value `T` so each call site keeps its exact literal-union typing
 * (inferred from `options`/`value`/`onSelect` — no site passes an explicit type arg).
 */
import { StyleSheet, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { Button, Text } from '@/shared/ui';

export function SelectGroup<T extends string>({
  label,
  error,
  options,
  value,
  onSelect,
}: {
  label: string;
  error?: string;
  options: { value: T; label: string; hint?: string }[];
  value: T | undefined;
  onSelect: (value: T) => void;
}) {
  return (
    <View style={styles.group}>
      <Text type="smallBold" themeColor="textSecondary">
        {label}
      </Text>
      {options.map((option) => (
        <Button
          key={option.value}
          variant={value === option.value ? 'primary' : 'secondary'}
          onPress={() => onSelect(option.value)}
          fullWidth>
          {option.hint ? `${option.label} — ${option.hint}` : option.label}
        </Button>
      ))}
      {error ? (
        <Text type="small" themeColor="danger">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    gap: Spacing.two,
  },
});
