/**
 * Learn more about light and dark modes:
 * https://docs.expo.dev/guides/color-schemes/
 */

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export function useTheme() {
  const scheme = useColorScheme();
  // useColorScheme() can be 'light' | 'dark' | 'unspecified' | null (no OS
  // preference, and on web first paint). Treat anything that isn't explicitly
  // 'dark' as light so we never index Colors with an unknown/null key.
  const theme = scheme === 'dark' ? 'dark' : 'light';

  return Colors[theme];
}
