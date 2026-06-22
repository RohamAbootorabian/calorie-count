/**
 * Capture screen (plan 0007 piece 1 + plan 0008 piece 2). The product core:
 * take **or** pick a meal photo → preview → upload to the private
 * `meal-photos/{uid}/…` bucket → **Analyze** it through the `analyze-meal` Edge
 * Function (phone NEVER calls Gemini directly) → show a read-only result card
 * (dish, totals, confidence, quality). No DB write yet (piece 3 persists/edits).
 *
 * Retry discipline (B3): both helpers return a typed `kind`; we offer a bare
 * **Retry** only for transient kinds, and analysis retries are **bounded**
 * (a malformed-AI loop is real paid spend) — after MAX attempts the user must
 * re-shoot. Analyze keeps its OWN state (never overloads the upload error) and
 * a `currentPath` ref ignores a late result if the photo was re-picked mid-call.
 * PII discipline: never log the uri/path/analysis. Sign-out can unmount us
 * mid-call, so post-await setState is guarded by a `mounted` ref (SF8).
 */
import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Radius, Spacing } from '@/constants/theme';
import { Button, Card, Screen, Text } from '@/shared/ui';
import type { MealAnalysis } from '@/types/nutrition';

import { analyzeMeal, type AnalyzeErrorKind } from '../lib/analyze-meal';
import {
  pickFromLibrary,
  takePhoto,
  type PhotoSource,
  type PickOutcome,
  type PickedPhoto,
} from '../lib/pick-photo';
import { uploadMealPhoto, type UploadErrorKind } from '../lib/upload-meal-photo';

/** A malformed-AI / transient loop is real paid spend — cap manual retries. */
const MAX_ANALYZE_ATTEMPTS = 3;

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

/** Friendly copy per analyze error kind; `canRetry` gates a bare retry (B3). */
function analyzeErrorCopy(kind: AnalyzeErrorKind): { message: string; canRetry: boolean } {
  switch (kind) {
    case 'unauthorized':
      return { message: 'Your session expired — please sign in again.', canRetry: false };
    case 'not_found':
      return { message: "We couldn't find that photo. Try choosing it again.", canRetry: false };
    case 'no_food':
      return { message: "We couldn't find a meal in that photo — try a clearer food photo.", canRetry: false };
    case 'too_large':
      return { message: 'That photo is too large to analyze (max 10 MB).', canRetry: false };
    case 'rate_limited':
      return { message: "You've hit today's analysis limit, or the service is busy. Try again later.", canRetry: true };
    case 'bad_ai_response':
      return { message: 'The analysis came back garbled. Try again.', canRetry: true };
    case 'timeout':
      return { message: 'Analysis timed out — try again.', canRetry: true };
    case 'network':
      return { message: 'Network problem — check your connection and try again.', canRetry: true };
    case 'unknown':
    default:
      return { message: 'Something went wrong analyzing this meal. Please try again.', canRetry: true };
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

  // Analyze step — its OWN state so a stale upload error never renders here.
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<MealAnalysis | null>(null);
  const [analyzeError, setAnalyzeError] = useState<string>();
  const [analyzeCanRetry, setAnalyzeCanRetry] = useState(false);
  const [analyzeAttempts, setAnalyzeAttempts] = useState(0);

  // Sign-out can unmount us the instant a request resolves; guard post-await setState.
  const mounted = useRef(true);
  // Tracks the path currently in play so a late analyze result for a stale
  // (re-picked / re-uploaded) photo is ignored.
  const currentPath = useRef<string | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /** Clear all analyze-side state (on fresh pick / new upload / choose another). */
  function resetAnalyze() {
    setAnalysis(null);
    setAnalyzeError(undefined);
    setAnalyzeCanRetry(false);
    setAnalyzeAttempts(0);
  }

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
    currentPath.current = null;
    setErrorMessage(undefined);
    setCanRetry(false);
    resetAnalyze();
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
    resetAnalyze();

    const result = await uploadMealPhoto({ photo });

    if (!mounted.current) return;
    if (result.ok) {
      currentPath.current = result.path;
      setUploadedPath(result.path);
      setUploading(false);
      return;
    }
    const { message, canRetry: retryable } = uploadErrorCopy(result.kind);
    setErrorMessage(message);
    setCanRetry(retryable);
    setUploading(false);
  }

  async function handleAnalyze() {
    if (!uploadedPath || analyzing) return; // no double Gemini charge.
    const path = uploadedPath;
    setAnalyzing(true);
    setAnalyzeError(undefined);
    setAnalyzeCanRetry(false);

    const result = await analyzeMeal({ path });

    if (!mounted.current) return;
    if (currentPath.current !== path) return; // re-pick race: ignore stale result.

    if (result.ok) {
      setAnalysis(result.analysis);
      setAnalyzing(false);
      return;
    }
    const { message, canRetry: retryable } = analyzeErrorCopy(result.kind);
    const nextAttempts = analyzeAttempts + 1;
    setAnalyzeAttempts(nextAttempts);
    // Even a transient kind stops being retryable once the bounded budget is spent.
    setAnalyzeCanRetry(retryable && nextAttempts < MAX_ANALYZE_ATTEMPTS);
    setAnalyzeError(
      retryable && nextAttempts >= MAX_ANALYZE_ATTEMPTS
        ? `${message} If it keeps failing, re-take the photo.`
        : message,
    );
    setAnalyzing(false);
  }

  function chooseAnother() {
    setPhoto(null);
    setUploadedPath(null);
    currentPath.current = null;
    setErrorMessage(undefined);
    setCanRetry(false);
    resetAnalyze();
  }

  return (
    <Screen scroll tabBarInset>
      <View style={styles.header}>
        <Text type="title">Capture a meal</Text>
        <Text type="small" themeColor="textSecondary">
          Take a photo or choose one from your library, then analyze it.
        </Text>
      </View>

      {/* Pick source ------------------------------------------------------- */}
      <Card style={styles.section}>
        <Button onPress={handleTake} disabled={uploading || analyzing} fullWidth>
          Take photo
        </Button>
        <Button
          variant="secondary"
          onPress={handleLibrary}
          disabled={uploading || analyzing}
          fullWidth
        >
          Choose from library
        </Button>
      </Card>

      {/* Preview + upload + analyze --------------------------------------- */}
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

              {analysis ? (
                <AnalysisResult analysis={analysis} />
              ) : (
                <>
                  {analyzeError ? (
                    <Text type="small" themeColor="danger">
                      {analyzeError}
                    </Text>
                  ) : null}
                  <Button onPress={handleAnalyze} loading={analyzing} fullWidth>
                    {analyzeCanRetry ? 'Retry analysis' : 'Analyze meal'}
                  </Button>
                </>
              )}

              <Button
                variant="secondary"
                onPress={chooseAnother}
                disabled={analyzing}
                fullWidth
              >
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

/** Read-only summary of an analysis — the piece-2 verify surface (piece 3 edits). */
function AnalysisResult({ analysis }: { analysis: MealAnalysis }) {
  const { dishName, totals, confidence, quality } = analysis;
  return (
    <View style={styles.result}>
      <Text type="subtitle">{dishName}</Text>
      <Text type="small" themeColor="textSecondary">
        Confidence: {confidence}
        {quality ? ` · Quality ${Math.round(quality.score)}/100` : ''}
      </Text>

      <View style={styles.macroRow}>
        <Macro label="Calories" value={`${Math.round(totals.calories)}`} />
        <Macro label="Protein" value={`${Math.round(totals.protein)} g`} />
        <Macro label="Carbs" value={`${Math.round(totals.carbs)} g`} />
        <Macro label="Fat" value={`${Math.round(totals.fat)} g`} />
      </View>

      <Text type="small" themeColor="textSecondary">
        {analysis.items.length} item{analysis.items.length === 1 ? '' : 's'} · review &amp; save
        coming soon
      </Text>
    </View>
  );
}

function Macro({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.macro}>
      <Text type="smallBold">{value}</Text>
      <Text type="small" themeColor="textSecondary">
        {label}
      </Text>
    </View>
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
  result: {
    gap: Spacing.two,
  },
  macroRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  macro: {
    flex: 1,
    alignItems: 'center',
    gap: Spacing.one,
  },
});
