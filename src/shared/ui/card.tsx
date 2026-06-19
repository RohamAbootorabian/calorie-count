import type { ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  type GestureResponderEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';

export type CardProps = {
  children: ReactNode;
  /** When set, the whole card becomes a button. */
  onPress?: (event: GestureResponderEvent) => void;
  /** Accessible label when the card is tappable. */
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
};

/** Themed surface container. Composes ThemedView so theming stays in one place. */
export function Card({ children, onPress, accessibilityLabel, style }: CardProps) {
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        style={({ pressed }) => [pressed && styles.pressed]}>
        <ThemedView type="backgroundElement" style={[styles.card, style]}>
          {children}
        </ThemedView>
      </Pressable>
    );
  }

  return (
    <ThemedView type="backgroundElement" style={[styles.card, style]}>
      {children}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.lg,
    padding: Spacing.three,
    overflow: 'hidden',
  },
  pressed: {
    opacity: 0.85,
  },
});
