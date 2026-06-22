/**
 * Capture screen (plan 0007 — S2 piece 1). The first link of the product core:
 * take **or** pick a meal photo → preview it → upload it to the private
 * `meal-photos/{uid}/…` bucket → show the returned storage path. No AI, no DB
 * write (pieces 2 and 3); this screen just proves the capture→storage round-trip.
 *
 * Retry discipline (B3): the upload helper returns a typed `kind`; we offer a bare
 * **Retry** only for transient kinds (`network`/`unknown`). Permanent kinds
 * (`too_large`/`unsupported`/`unauthorized`) tell the user what to change instead of
 * trapping them re-uploading identical bytes. PII discipline (SF4): we never log the
 * uri/path. Sign-out can unmount us mid-upload, so post-await setState is guarded by
 * a local `mounted` ref (SF8).
 */
import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Radius, Spacing } from '@/constants/theme';
import { Button, Card, Screen, Text } from '@/shared/ui';

import {
  pickFromLibrary,
  takePhoto,
  type PhotoSource,
  type PickOutcome,
  type PickedPhoto,
} from '../lib/pick-photo';
import { uploadMealPhoto, type UploadErrorKind } from '../lib/upload-meal-photo';

/** Friendly copy + whether a bare retry can ever succeed, per typed error kind (B3). */
function uploadErrorCopy(kind: UploadErrorKind): { message: string; canRetry: boolean } {
  switch (kind) {
    case 'too_large':
      return { message: 'That photo is too large — pick a smaller one (max 10 MB).', canRetry: false };
    case 'unsupported':
      return { message: 'Unsupported image format — use a JPEG or PNG photo.', canRetry: false };
    case 'unauthorized':
      return { message: 'Your session expired — please sign in again.', canRetry: false };
    case 'network':
      return { message: 'Upload failed — check your connection and try again.', canRetry: true };
    case 'unknown':
    default:
      return { message: 'Something went wrong. Please try again.', canRetry: true };
  }
}

/** Per-source hint shown when the OS permission is denied (native). */
function deniedCopy(source: PhotoSource): string {
  return source === 'camera'
    ? 'Camera access is off. Enable it in Settings to take a meal photo.'
    : 'Photo access is off. Enable it in Settings to choose a meal photo.';
}

export function CaptureScreen() {
  const [photo, setPhoto] = useState<PickedPhoto | null>(null);
  const [uploading, setUploading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>();
  const [canRetry, setCanRetry] = useState(false);
  const [uploadedPath, setUploadedPath] = useState<string | null>(null);

  // Sign-out can unmount us the instant the upload resolves; guard post-await setState.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  function applyPickOutcome(outcome: PickOutcome) {
    if (outcome.status === 'cancelled') return; // silent no-op (not an error).
    if (outcome.status === 'denied') {
      setErrorMessage(deniedCopy(outcome.source));
      setCanRetry(false);
      return;
    }
    // Fresh pick → reset any prior result/error and preview the new photo.
    setPhoto(outcome.photo);
    setUploadedPath(null);
    setErrorMessage(undefined);
    setCanRetry(false);
  }

  async function handleTake() {
    applyPickOutcome(await takePhoto());
  }

  async function handleLibrary() {
    applyPickOutcome(await pickFromLibrary());
  }

  async function handleUpload() {
    if (!photo || uploading) return;
    setUploading(true);
    setErrorMessage(undefined);
    setCanRetry(false);

    const result = await uploadMealPhoto({ photo });

    if (!mounted.current) return;
    if (result.ok) {
      setUploadedPath(result.path);
      setUploading(false);
      return;
    }
    const { message, canRetry: retryable } = uploadErrorCopy(result.kind);
    setErrorMessage(message);
    setCanRetry(retryable);
    setUploading(false);
  }

  function chooseAnother() {
    setPhoto(null);
    setUploadedPath(null);
    setErrorMessage(undefined);
    setCanRetry(false);
  }

  return (
    <Screen scroll tabBarInset>
      <View style={styles.header}>
        <Text type="title">Capture a meal</Text>
        <Text type="small" themeColor="textSecondary">
          Take a photo or choose one from your library, then upload it.
        </Text>
      </View>

      {/* Pick source ------------------------------------------------------- */}
      <Card style={styles.section}>
        <Button onPress={handleTake} disabled={uploading} fullWidth>
          Take photo
        </Button>
        <Button variant="secondary" onPress={handleLibrary} disabled={uploading} fullWidth>
          Choose from library
        </Button>
      </Card>

      {/* Preview + upload -------------------------------------------------- */}
      {photo ? (
        <Card style={styles.section}>
          <Text type="subtitle">Preview</Text>
          <Image
            source={{ uri: photo.uri }}
            style={styles.preview}
            contentFit="cover"
            transition={150}
          />

          {uploadedPath ? (
            <>
              <Text type="small" themeColor="textSecondary">
                Uploaded ✓
              </Text>
              <Text type="small" themeColor="textSecondary">
                {uploadedPath}
              </Text>
              <Button variant="secondary" onPress={chooseAnother} fullWidth>
                Choose another
              </Button>
            </>
          ) : (
            <>
              {errorMessage ? (
                <Text type="small" themeColor="danger">
                  {errorMessage}
                </Text>
              ) : null}
              <Button onPress={handleUpload} loading={uploading} fullWidth>
                {canRetry ? 'Retry upload' : 'Upload'}
              </Button>
              <Button variant="secondary" onPress={chooseAnother} disabled={uploading} fullWidth>
                Choose another
              </Button>
            </>
          )}
        </Card>
      ) : errorMessage ? (
        // A denial (no photo picked) still needs to surface its hint.
        <Card style={styles.section}>
          <Text type="small" themeColor="danger">
            {errorMessage}
          </Text>
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    marginBottom: Spacing.four,
    gap: Spacing.two,
  },
  section: {
    gap: Spacing.three,
    marginBottom: Spacing.four,
  },
  preview: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: Radius.md,
  },
});
