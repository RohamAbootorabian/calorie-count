/**
 * Upload a picked meal photo to the private `meal-photos` Storage bucket
 * (plan 0007 — the capture→storage round-trip; no AI, no DB write).
 *
 * Contract (folds in the review's B1/B2/B3 + SF1/SF2/SF3/SF4/SF6/SF7):
 *   - **uid from the session** (SF2) — never a caller-supplied param. Hard-fail if
 *     the uid is missing / not a uuid before building any path; RLS would reject a
 *     wrong uid anyway, but this kills the foot-gun and the silent generic error.
 *   - **mime allowlist** (B1) — reject anything not `image/jpeg`/`image/png` BEFORE
 *     uploading; the bucket allows only those, and a mislabeled/HEIC object would
 *     either be rejected at insert or poison piece 2's Gemini call. The stored
 *     extension is DERIVED from the resolved mime, never hardcoded.
 *   - **size pre-check** (SF6) — reject when the known `fileSize` exceeds the cap;
 *     `quality:0.7` is best-effort, the bucket's server-side 10 MB is the real guard.
 *   - **path** (SF3) — `${uid}/${Date.now()}-${rand}.<ext>`: the first folder segment
 *     MUST be the uid (RLS checks `(storage.foldername(name))[1] = auth.uid()`); the
 *     random suffix makes two uploads in the same ms collision-proof under upsert:false.
 *   - **byte guard** (B2) — assert `byteLength > 0` regardless of platform so a bad
 *     native read fails loudly instead of creating a 0-byte orphan.
 *   - **timeout** (SF7) — an AbortController aborts a stalled upload as `network`.
 *   - **typed error kind** (B3/SF4) so the screen can offer a bare retry only for
 *     transient kinds; never logs the uri / path / bytes (PII discipline).
 */
import { supabase } from '@/lib/supabase';

import type { PickedPhoto } from './pick-photo';
import { MEAL_PHOTOS_BUCKET } from './storage';

const BUCKET = MEAL_PHOTOS_BUCKET;
const MAX_BYTES = 10 * 1024 * 1024; // matches the bucket's 10 MB cap.
const UPLOAD_TIMEOUT_MS = 45_000;

/** Resolved mime → stored file extension. Drives both the allowlist and the path. */
const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

/**
 * Permanent kinds tell the user what to change; transient kinds (`network`,
 * `unknown`) are the only ones the screen offers a bare retry for (B3).
 */
export type UploadErrorKind =
  | 'too_large'
  | 'unsupported'
  | 'unauthorized'
  | 'network'
  | 'unknown';

export type UploadResult =
  | { ok: true; path: string }
  | { ok: false; kind: UploadErrorKind };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Collision-proof, no extra dep: timestamp + short random suffix (plan SF3). */
function randomName(ext: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${Date.now()}-${rand}.${ext}`;
}

export async function uploadMealPhoto({ photo }: { photo: PickedPhoto }): Promise<UploadResult> {
  // 1. uid from the session, not the caller (SF2). A missing/!uuid uid is a hard fail.
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid || !UUID_RE.test(uid)) return { ok: false, kind: 'unauthorized' };

  // 2. mime allowlist (B1) — reject before touching the network.
  const mime = photo.mimeType?.toLowerCase();
  const ext = mime ? EXT_BY_MIME[mime] : undefined;
  if (!mime || !ext) return { ok: false, kind: 'unsupported' };

  // 3. size pre-check when known (SF6) — the server-side cap is still the real guard.
  if (photo.fileSize != null && photo.fileSize > MAX_BYTES) {
    return { ok: false, kind: 'too_large' };
  }

  // 4. load bytes + 0-byte guard (B2). `fetch().arrayBuffer()` is the web target's
  //    reliable path; native byte-loading is a tracked follow-up (plan OQ2).
  let bytes: ArrayBuffer;
  try {
    const res = await fetch(photo.uri);
    bytes = await res.arrayBuffer();
  } catch {
    return { ok: false, kind: 'network' };
  }
  if (bytes.byteLength === 0) return { ok: false, kind: 'unknown' };
  if (bytes.byteLength > MAX_BYTES) return { ok: false, kind: 'too_large' };

  // 5. upload with a timeout guard (SF7). storage-js `upload()` exposes no abort
  //    signal in this version, so we race the request against a timer: a stall
  //    surfaces as a transient `network` error (no infinite spinner) rather than
  //    truly aborting the in-flight request. Path's first segment is the uid (RLS).
  const path = `${uid}/${randomName(ext)}`;
  try {
    const result = await withTimeout(
      supabase.storage.from(BUCKET).upload(path, bytes, { contentType: mime, upsert: false }),
      UPLOAD_TIMEOUT_MS,
    );
    if (result === TIMEOUT) return { ok: false, kind: 'network' };

    const { data, error } = result;
    if (error) return { ok: false, kind: classifyStorageError(error) };
    // Persist the bucket-relative `data.path` (SF1) — what signed-url/download expect.
    return { ok: true, path: data.path };
  } catch {
    // Thrown (vs. returned) errors are network failures → transient.
    return { ok: false, kind: 'network' };
  }
}

const TIMEOUT = Symbol('timeout');

/** Resolve to the promise's value, or the `TIMEOUT` sentinel if it stalls past `ms`. */
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | typeof TIMEOUT> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<typeof TIMEOUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMEOUT), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

/**
 * Map a Storage error to a typed kind (B3/SF4). We read only the message/status —
 * never log the uri/path/bytes. 401/403 → session expired (mirrors S1's mapping).
 */
function classifyStorageError(error: unknown): UploadErrorKind {
  const status = (error as { statusCode?: string | number })?.statusCode;
  const code = status != null ? String(status) : '';
  const message = ((error as { message?: string })?.message ?? '').toLowerCase();

  if (code === '401' || code === '403') return 'unauthorized';
  if (code === '413' || message.includes('exceeded the maximum') || message.includes('too large')) {
    return 'too_large';
  }
  if (message.includes('mime') || message.includes('not supported') || message.includes('invalid')) {
    return 'unsupported';
  }
  if (code.startsWith('5') || message.includes('network') || message.includes('timeout')) {
    return 'network';
  }
  return 'unknown';
}
