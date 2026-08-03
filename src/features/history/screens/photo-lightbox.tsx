/**
 * Full-screen meal-photo viewer (plan 0016). Opened from a History thumbnail; shows
 * the SAME signed URL plan 0013 already minted for that thumbnail — it mints nothing
 * and makes no storage call. A controlled, presentational `Modal` overlay (NOT a
 * route): a signed URL is an unauthenticated bearer token for a private health photo,
 * so keeping it as an in-memory prop — never serialized into navigation state — is the
 * privacy boundary (mirrors `useSignedThumbnails`).
 *
 * v1 is a fit-to-screen still view: `contentFit="contain"`, no spinner, no inline
 * error, no negative-cache. A failed decode (rare — the lightbox only opens for a path
 * whose thumbnail just loaded the same bytes) shows the dark scrim with no image and
 * still dismisses; the thumbnail's OWN `onError`→`reportError` (0013, untouched) is the
 * sole negative-cache path, so a merely-expired-but-valid photo is never poisoned here.
 *
 * Dismiss: a tap on the dark backdrop OR the ✕ OR Android hardware-back
 * (`onRequestClose`). A tap on the photo itself is swallowed (its own no-op
 * `Pressable`) so a mis-tap doesn't close it. Privacy: never logs the url/cacheKey.
 */
import { Image } from 'expo-image';
import { StatusBar } from 'expo-status-bar';
import { Modal, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Spacing } from '@/constants/theme';
import { Text } from '@/shared/ui';

/** Photo-viewer chrome is theme-independent: a fixed dark scrim + light ✕ for contrast. */
const SCRIM = 'rgba(0,0,0,0.9)';
const CHROME_LIGHT = '#FFFFFF';

export type PhotoLightboxProps = {
  /** The already-minted signed URL for the photo (in-memory only — never serialized). */
  url: string;
  /** The row's `image_path` — keys expo-image's byte cache (native reuses thumbnail bytes). */
  cacheKey: string;
  onClose: () => void;
};

export function PhotoLightbox({ url, cacheKey, onClose }: PhotoLightboxProps) {
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={onClose} // Android hardware-back.
      // VoiceOver should not read the list behind the scrim (native).
      accessibilityViewIsModal
    >
      <StatusBar style="light" />
      {/* Backdrop fills the WHOLE screen (incl. unsafe areas); a tap dismisses. */}
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button">
        {/* The photo: its own no-op Pressable swallows taps so they don't bubble to
            the backdrop (a bare View would NOT stop the responder chain). */}
        <Pressable style={styles.imageWrap} onPress={() => {}}>
          <Image
            // Remount on a different photo so we never cross-fade stale bytes.
            key={cacheKey}
            source={{ uri: url, cacheKey }}
            style={styles.image}
            contentFit="contain"
            transition={120}
          />
        </Pressable>
      </Pressable>

      {/* Close ✕ — pinned top-right inside the safe-area inset, over the scrim. */}
      <Pressable
        style={[styles.close, { top: insets.top + Spacing.two }]}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close"
        hitSlop={Spacing.two}
      >
        <Text type="subtitle" style={styles.closeIcon}>
          ✕
        </Text>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: SCRIM,
    justifyContent: 'center',
    alignItems: 'center',
  },
  imageWrap: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  close: {
    position: 'absolute',
    right: Spacing.four,
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeIcon: {
    color: CHROME_LIGHT,
  },
});
