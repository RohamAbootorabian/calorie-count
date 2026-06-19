import type { Ref } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { Text } from './text';

export type InputProps = TextInputProps & {
  label?: string;
  /** Error message; turns the border red and is shown in the helper slot. */
  error?: string;
  /** Helper text shown when there is no error. */
  hint?: string;
  /** React 19 ref-as-prop, forwarded to the underlying TextInput (for .focus()). */
  ref?: Ref<TextInput>;
};

/**
 * Labeled text field. Controlled contract: pass `value` + `onChangeText`.
 * Never logs its value; accessibility derives from `label`, never from input.
 */
export function Input({ label, error, hint, ref, style, secureTextEntry, ...rest }: InputProps) {
  const theme = useTheme();
  const hasError = !!error;

  // Sensitive-field hygiene: keep secure values out of the keyboard dictionary.
  const secureDefaults = secureTextEntry
    ? ({ autoCorrect: false, autoCapitalize: 'none', spellCheck: false } as const)
    : null;

  return (
    <View style={styles.container}>
      {label ? (
        <Text type="smallBold" themeColor="textSecondary" style={styles.label}>
          {label}
        </Text>
      ) : null}

      <TextInput
        ref={ref}
        secureTextEntry={secureTextEntry}
        placeholderTextColor={theme.textSecondary}
        accessibilityLabel={label}
        {...secureDefaults}
        {...rest}
        style={[
          styles.input,
          {
            color: theme.text,
            borderColor: hasError ? theme.danger : theme.border,
            backgroundColor: theme.background,
          },
          style,
        ]}
      />

      {/* One reserved line so toggling error/hint never reflows siblings. */}
      <Text
        type="small"
        themeColor={hasError ? undefined : 'textSecondary'}
        numberOfLines={1}
        style={[styles.helper, hasError && { color: theme.danger }]}>
        {error ?? hint ?? ' '}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignSelf: 'stretch',
  },
  label: {
    marginBottom: Spacing.one,
  },
  input: {
    minHeight: 48,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 16,
  },
  helper: {
    minHeight: 20,
    marginTop: Spacing.one,
  },
});
