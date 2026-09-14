/**
 * Capture screen (plan 0007 piece 1 + plan 0008 piece 2; plan 0029 merge). The
 * product core: take **or** pick a meal photo → preview → **Analyze meal** — a
 * SINGLE tap that uploads the photo to the private `meal-photos/{uid}/…` bucket
 * and then analyzes it through the `analyze-meal` Edge Function (phone NEVER calls
 * OpenAI directly) → an editable **review** card (`MealReview`, piece 3) where the
 * user corrects the estimate and **saves** it to `meal_logs`/`meal_items` via the
 * atomic `create_meal_log` RPC.
 *
 * State (plan 0029): a single `status` enum (`idle|uploading|analyzing`) + a
 * single `error` channel (`{message,canRetry,phase}`) — the two phases are mutually
 * exclusive on screen, so one model each avoids stale-error crossfire.
 *
 * Retry discipline (B3): both helpers return a typed `kind`; we offer a phase-
 * specific **Retry** only for transient kinds, and analysis retries are **bounded**
 * (a malformed-AI loop is real paid spend) — after MAX attempts the user must
 * re-shoot. A failed analyze reuses the already-uploaded photo (no re-upload / no
 * duplicate object). A synchronous `inFlight` ref makes the single tap idempotent
 * regardless of render timing (no double upload / double OpenAI charge), and a
 * `currentPath` ref ignores a late analyze result if the photo was re-picked.
 * PII discipline: never log the uri/path/analysis. Sign-out can unmount us
 * mid-call, so post-await setState is guarded by a `mounted` ref (SF8).
 */
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Radius, Spacing } from '@/constants/theme';
import { useUser } from '@/lib/auth';
import { reconcile } from '@/features/notifications/lib/notification-service';
import { Button, Card, Input, Screen, Text } from '@/shared/ui';
import type { MealAnalysis } from '@/types/nutrition';

import { analyzeMeal, type AnalyzeErrorKind } from '../lib/analyze-meal';
import { NOTE_MAX } from '../lib/meal-form';
import { deleteMealPhoto } from '../lib/delete-meal-photo';
import {
  pickFromLibrary,
  takePhoto,
  type PhotoSource,
  type PickOutcome,
  type PickedPhoto,
} from '../lib/pick-photo';
import { uploadMealPhoto, type UploadErrorKind } from '../lib/upload-meal-photo';
import { MealReview } from './meal-review';

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

/** One error, tagged by the phase that raised it (drives the phase-specific label). */
type CaptureError = { message: string; canRetry: boolean; phase: 'upload' | 'analyze' };

export function CaptureScreen() {
  const router = useRouter();
  const { user } = useUser();
  const [photo, setPhoto] = useState<PickedPhoto | null>(null);
  const [uploadedPath, setUploadedPath] = useState<string | null>(null);

  // Single phase enum + single error channel (plan 0029): the upload and analyze
  // phases never co-render, so one model each removes the old stale-error crossfire.
  const [status, setStatus] = useState<'idle' | 'uploading' | 'analyzing'>('idle');
  const [error, setError] = useState<CaptureError | null>(null);
  const busy = status !== 'idle';

  // Optional meal note (plan 0020) — typed before the single Analyze tap; sent WITH
  // the photo and seeded into the review form. Cleared via `resetAnalyze` (every
  // reset path funnels through it, so a re-pick never carries a stale note).
  const [note, setNote] = useState('');

  const [analysis, setAnalysis] = useState<MealAnalysis | null>(null);
  // Bounded paid-spend budget — zeroed ONLY on a fresh pick (never inside the
  // handler), so an analyze-retry can't reset the cap into an unbounded loop.
  const [analyzeAttempts, setAnalyzeAttempts] = useState(0);

  // Sign-out can unmount us the instant a request resolves; guard post-await setState.
  const mounted = useRef(true);
  // Synchronous single-flight latch (plan 0029): the merged tap does upload+analyze,
  // so we gate on a ref — not async `status` — to make it idempotent under any render
  // timing (no double upload / double OpenAI charge).
  const inFlight = useRef(false);
  // Tracks the path currently in play so a late analyze result for a stale
  // (re-picked / re-uploaded) photo is ignored.
  const currentPath = useRef<string | null>(null);
  // Plan 0011 B1: a path a Save was *initiated* for — never delete it on a later
  // abandon. Set at save initiation (via MealReview's onSaving), not on the ack,
  // so an unmount between commit and ack can't lose the mark.
  const savedPath = useRef<string | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /**
   * Plan 0011 (Layer 1): best-effort delete the prior uploaded photo when it's
   * being abandoned. Single guarded helper so no abandon site can forget the
   * guard: no-op unless a prior path exists AND it isn't a path a Save was
   * initiated for (savedPath). Fire-and-forget; the sweep is the backstop.
   */
  function maybeDeleteAbandoned(prior: string | null) {
    if (!prior || prior === savedPath.current) return;
    void deleteMealPhoto(prior);
  }

  /** Clear all analyze-side state (fresh pick / choose another ONLY — never mid-handler). */
  function resetAnalyze() {
    setAnalysis(null);
    setAnalyzeAttempts(0);
    setNote('');
  }

  function applyPickOutcome(outcome: PickOutcome) {
    if (outcome.status === 'cancelled') return; // silent no-op (not an error).
    if (outcome.status === 'denied') {
      setError({ message: deniedCopy(outcome.source), canRetry: false, phase: 'upload' });
      return;
    }
    // Fresh pick → reset any prior result/error and preview the new photo.
    // If a prior unsaved photo was already uploaded, abandon-delete it first.
    maybeDeleteAbandoned(uploadedPath);
    setPhoto(outcome.photo);
    setUploadedPath(null);
    currentPath.current = null;
    setError(null);
    resetAnalyze();
  }

  async function handleTake() {
    applyPickOutcome(await takePhoto());
  }

  async function handleLibrary() {
    applyPickOutcome(await pickFromLibrary());
  }

  /**
   * The single "Analyze meal" action (plan 0029): upload the photo (only if not
   * already uploaded — a failed-analyze retry reuses the object), then analyze it.
   * `inFlight` (a synchronous ref) makes it idempotent under any render timing; the
   * note is snapshotted once so no mid-flight state change can empty it; the analyze
   * step runs against the LOCAL resolved `path`, never the async `uploadedPath` state.
   */
  async function handleAnalyzeMeal() {
    if (!photo || inFlight.current) return;
    // Bounded paid spend: once the analyze budget is spent on the uploaded photo,
    // the only way forward is a re-pick — don't keep charging OpenAI.
    if (uploadedPath && analyzeAttempts >= MAX_ANALYZE_ATTEMPTS) return;

    inFlight.current = true;
    const trimmedNote = note.trim(); // snapshot BEFORE any await (B1: never wiped mid-flight).
    const sentNote = trimmedNote.length > 0;
    try {
      // --- Upload step (skipped when the photo is already uploaded) ---------
      let path = uploadedPath;
      if (!path) {
        setStatus('uploading');
        setError(null);
        const up = await uploadMealPhoto({ photo });
        if (!mounted.current) return;
        if (!up.ok) {
          const { message, canRetry } = uploadErrorCopy(up.kind);
          setError({ message, canRetry, phase: 'upload' });
          setStatus('idle');
          return;
        }
        path = up.path;
        currentPath.current = path;
        setUploadedPath(path);
      }

      // --- Analyze step ----------------------------------------------------
      setStatus('analyzing');
      setError(null);
      const result = await analyzeMeal({ path, note: trimmedNote });

      if (!mounted.current) return;
      if (currentPath.current !== path) return; // re-pick race: ignore stale result.

      if (result.ok) {
        setAnalysis(result.analysis);
        setStatus('idle');
        return;
      }
      const { message, canRetry } = analyzeErrorCopy(result.kind);
      const nextAttempts = analyzeAttempts + 1;
      setAnalyzeAttempts(nextAttempts);
      // Even a transient kind stops being retryable once the bounded budget is spent.
      const retryable = canRetry && nextAttempts < MAX_ANALYZE_ATTEMPTS;
      // SF3: a note can deterministically re-trip a content_filter/refusal on every
      // Retry, so when a note was sent the terminal guidance points at the note (it's
      // on-screen + re-enabled), not only "re-take the photo".
      const terminalHint = sentNote
        ? ' If it keeps failing, try editing or removing your note, or re-take the photo.'
        : ' If it keeps failing, re-take the photo.';
      setError({
        message:
          canRetry && nextAttempts >= MAX_ANALYZE_ATTEMPTS ? `${message}${terminalHint}` : message,
        canRetry: retryable,
        phase: 'analyze',
      });
      setStatus('idle');
    } finally {
      inFlight.current = false;
    }
  }

  // Phase-specific button label (plan 0029): retryable errors name their phase, else
  // the default action. A non-retryable error disables the button (steer to re-pick).
  const primaryLabel =
    error?.canRetry && error.phase === 'upload'
      ? 'Retry upload'
      : error?.canRetry && error.phase === 'analyze'
        ? 'Retry analysis'
        : 'Analyze meal';
  const primaryDisabled = busy || (!!error && !error.canRetry);

  function chooseAnother() {
    // Also the post-save reset (onLogAnother). The savedPath guard makes this a
    // no-op for a just-saved photo; only a genuinely abandoned upload is deleted.
    maybeDeleteAbandoned(uploadedPath);
    setPhoto(null);
    setUploadedPath(null);
    currentPath.current = null;
    setError(null);
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
        <Button onPress={handleTake} disabled={busy} fullWidth>
          Take photo
        </Button>
        <Button variant="secondary" onPress={handleLibrary} disabled={busy} fullWidth>
          Choose from library
        </Button>
      </Card>

      {/* Preview + single "Analyze meal" (upload+analyze in one tap, plan 0029) - */}
      {photo ? (
        <Card style={styles.section}>
          <Text type="subtitle">Preview</Text>
          <Image
            source={{ uri: photo.uri }}
            style={styles.preview}
            contentFit="cover"
            transition={150}
          />

          {/* Point-of-processing notice (plan 0010): a single "Analyze meal" tap sends
              the photo + any note off-device (→ Supabase Storage, then → OpenAI via the
              Edge Function). Shown while a photo is selected and not yet saved. */}
          {!analysis ? (
            <Text type="small" themeColor="textSecondary">
              Your photo and any note you add are sent to OpenAI to estimate nutrition.{' '}
              <Text type="linkPrimary" onPress={() => router.push('/privacy')}>
                Privacy
              </Text>
            </Text>
          ) : null}

          {analysis ? (
            <MealReview
              key={uploadedPath ?? 'none'}
              analysis={analysis}
              imagePath={uploadedPath ?? ''}
              initialNote={note}
              onLogAnother={chooseAnother}
              onSaving={(path) => {
                savedPath.current = path;
              }}
              onSaved={() => {
                // Re-arm reminders now this meal is committed (plan 0040).
                if (user?.id) void reconcile(user.id);
              }}
            />
          ) : (
            <>
              {/* Optional note (plan 0020): influences the estimate and is
                  authoritative on conflict; seeds the editable review form. */}
              <Input
                label="Add a note (optional)"
                value={note}
                onChangeText={setNote}
                placeholder="e.g. fried in butter, 2 cups of rice"
                hint={`${[...note].length}/${NOTE_MAX}`}
                autoCapitalize="sentences"
                multiline
                maxLength={NOTE_MAX}
                editable={!busy}
                style={styles.noteInput}
              />
              {error ? (
                <Text type="small" themeColor="danger">
                  {error.message}
                </Text>
              ) : null}
              <Button
                onPress={handleAnalyzeMeal}
                loading={busy}
                disabled={primaryDisabled}
                fullWidth
              >
                {primaryLabel}
              </Button>
              {/* The single tap can run ~upload then ~analyze; name the current phase
                  so a long wait doesn't read as a hang. */}
              {busy ? (
                <Text type="small" themeColor="textSecondary" style={styles.phase}>
                  {status === 'uploading' ? 'Uploading…' : 'Analyzing…'}
                </Text>
              ) : null}
            </>
          )}

          <Button variant="secondary" onPress={chooseAnother} disabled={busy} fullWidth>
            Choose another
          </Button>
        </Card>
      ) : error ? (
        // A denial (no photo picked) still needs to surface its hint.
        <Card style={styles.section}>
          <Text type="small" themeColor="danger">
            {error.message}
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
  noteInput: {
    minHeight: 88,
    textAlignVertical: 'top',
  },
  phase: {
    textAlign: 'center',
  },
});
