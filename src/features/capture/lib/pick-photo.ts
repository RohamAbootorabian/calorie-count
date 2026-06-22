/**
 * Permissioned wrappers over `expo-image-picker` (plan 0007, SF5).
 *
 * Two sources — camera and library — each request permission, launch the picker,
 * and normalize the result to a small discriminated union so the screen shows the
 * right copy without re-deriving intent:
 *   - `ok`        → a usable photo (uri + resolved mime/size).
 *   - `cancelled` → the user dismissed the picker; a silent no-op (not an error).
 *   - `denied`    → permission refused; the screen shows a per-source Settings hint.
 *
 * iOS `limited` library access counts as usable (the user picked specific photos);
 * only a true denial shows the hint. Web auto-grants and `launchCameraAsync` falls
 * back to a file/capture input — both still flow through these wrappers.
 *
 * SDK 56 API: `mediaTypes: ['images']` (string array — the old `MediaTypeOptions`
 * enum is gone). We never log the picked uri (PII discipline).
 */
import * as ImagePicker from 'expo-image-picker';

export type PhotoSource = 'camera' | 'library';

/** A normalized picked image. `mimeType`/`fileSize` may be absent on some platforms. */
export type PickedPhoto = {
  uri: string;
  mimeType?: string;
  fileSize?: number;
  width: number;
  height: number;
};

export type PickOutcome =
  | { status: 'ok'; photo: PickedPhoto }
  | { status: 'cancelled' }
  | { status: 'denied'; source: PhotoSource };

const PICKER_OPTIONS: ImagePicker.ImagePickerOptions = {
  mediaTypes: ['images'],
  allowsEditing: true,
  // Best-effort compression/re-encode; NOT the size guard (that's the bucket's
  // server-side 10 MB cap + the upload helper's fileSize check, plan SF6).
  quality: 0.7,
};

function toPicked(result: ImagePicker.ImagePickerResult): PickOutcome {
  if (result.canceled) return { status: 'cancelled' };
  const asset = result.assets[0];
  return {
    status: 'ok',
    photo: {
      uri: asset.uri,
      mimeType: asset.mimeType,
      fileSize: asset.fileSize,
      width: asset.width,
      height: asset.height,
    },
  };
}

/** Take a new photo with the camera (web falls back to a file/capture input). */
export async function takePhoto(): Promise<PickOutcome> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) return { status: 'denied', source: 'camera' };
  return toPicked(await ImagePicker.launchCameraAsync(PICKER_OPTIONS));
}

/** Pick an existing photo from the library. iOS `limited` access counts as usable. */
export async function pickFromLibrary(): Promise<PickOutcome> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  // `granted` OR `accessPrivileges === 'limited'` (iOS/Android partial access) → the
  // user can pick; only a true denial shows the Settings hint (SF5).
  if (!permission.granted && permission.accessPrivileges !== 'limited') {
    return { status: 'denied', source: 'library' };
  }
  return toPicked(await ImagePicker.launchImageLibraryAsync(PICKER_OPTIONS));
}
