import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ScreenProps = {
  children: ReactNode;
  /** Wrap content in a ScrollView (forms, long content). Default false. */
  scroll?: boolean;
  /** Apply horizontal + vertical padding. Default true. */
  padded?: boolean;
  /**
   * Add bottom spacing for the tab bar. Default false — auth/onboarding screens
   * live outside the tab navigator and must NOT reserve phantom space.
   */
  tabBarInset?: boolean;
  /** Style for the outer full-bleed background container. */
  style?: StyleProp<ViewStyle>;
  /** Style for the inner (max-width-clamped) content container. */
  contentContainerStyle?: StyleProp<ViewStyle>;
};

/**
 * Page layout primitive: full-bleed themed background, content clamped to
 * MaxContentWidth and centered (so wide/web has no wrong-colored letterbox),
 * safe-area insets, and built-in keyboard avoidance for forms.
 */
export function Screen({
  children,
  scroll = false,
  padded = true,
  tabBarInset = false,
  style,
  contentContainerStyle,
}: ScreenProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const padding: ViewStyle = {
    paddingTop: insets.top + (padded ? Spacing.three : 0),
    paddingLeft: insets.left + (padded ? Spacing.four : 0),
    paddingRight: insets.right + (padded ? Spacing.four : 0),
    paddingBottom:
      (padded ? Spacing.three : 0) +
      (tabBarInset ? BottomTabInset : insets.bottom),
  };

  const content = (
    <View style={[styles.contentClamp, padding, contentContainerStyle]}>{children}</View>
  );

  const inner = scroll ? (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}>
      {content}
    </ScrollView>
  ) : (
    content
  );

  return (
    <View style={[styles.flex, { backgroundColor: theme.background }, style]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {inner}
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  contentClamp: {
    flex: 1,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
});
