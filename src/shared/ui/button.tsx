import { useRef, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type GestureResponderEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { Text } from './text';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';

export type ButtonProps = {
  children: ReactNode;
  onPress?: (event: GestureResponderEvent) => void;
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
};

/** Leading-edge window (ms) that swallows a second press before the parent flips `loading`. */
const DOUBLE_TAP_GUARD_MS = 600;

export function Button({
  children,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  fullWidth = false,
  style,
}: ButtonProps) {
  const theme = useTheme();
  const lastPressAt = useRef(0);

  const interactive = !disabled && !loading;

  // Per-variant colors.
  const bg =
    variant === 'primary' ? theme.primary : variant === 'secondary' ? theme.background : 'transparent';
  const borderColor = variant === 'ghost' ? 'transparent' : variant === 'primary' ? theme.primary : theme.border;
  const fg = variant === 'primary' ? theme.primaryText : theme.text;
  // Disabled appearance: mute the foreground/border instead of a blanket opacity
  // (which barely reads on transparent ghost/secondary fills).
  const mutedFg = disabled ? theme.textSecondary : fg;
  const mutedBorder = disabled && variant !== 'ghost' ? theme.border : borderColor;

  function handlePress(event: GestureResponderEvent) {
    if (!interactive || !onPress) return;
    // In-flight guard: ignore a rapid second tap before the parent re-renders
    // with loading=true (prevents double sign-in / double save).
    const now = event.timeStamp || performance.now();
    if (now - lastPressAt.current < DOUBLE_TAP_GUARD_MS) return;
    lastPressAt.current = now;
    onPress(event);
  }

  return (
    <Pressable
      onPress={handlePress}
      disabled={!interactive}
      accessibilityRole="button"
      accessibilityState={{ disabled: !interactive, busy: loading }}
      style={(state) => {
        // `hovered` is web-only and absent from RN's PressableStateCallbackType.
        const hovered = (state as { hovered?: boolean }).hovered ?? false;
        return [
          styles.base,
          fullWidth && styles.fullWidth,
          { backgroundColor: bg, borderColor: mutedBorder },
          // Pressed/hover feedback only when interactive; state styles win otherwise.
          interactive && hovered && styles.hovered,
          interactive && state.pressed && styles.pressed,
          style,
        ];
      }}>
      {/* Fixed-height row keeps width/height stable when the spinner swaps in. */}
      <View style={styles.content}>
        {loading ? (
          <ActivityIndicator color={fg} />
        ) : (
          <Text type="smallBold" style={{ color: mutedFg }}>
            {children}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 48,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.four,
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullWidth: {
    alignSelf: 'stretch',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
  },
  hovered: {
    opacity: 0.9,
  },
  pressed: {
    opacity: 0.7,
  },
});
