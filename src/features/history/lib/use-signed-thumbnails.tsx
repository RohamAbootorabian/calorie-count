/**
 * Signed-URL minter for the History thumbnails (plan 0013).
 *
 * The `meal-photos` bucket is PRIVATE, so a row's `image_path` can't be loaded
 * directly — we mint a short-lived signed URL per photo. This hook is DERIVED
 * state over the `MealCard[]` the history screen already fetched (it never
 * queries `meal_logs` itself).
 *
 * DESIGN — mint-on-set-change, no expiry bookkeeping (plan 0013 review):
 *   - Collect the DISTINCT non-null `image_path`s and batch-mint the ones we don't
 *     already have for the current user with ONE `createSignedUrls` round-trip
 *     (never per-row). `expo-image`'s `cacheKey = image_path` makes the BYTES
 *     survive URL rotation on native, so per-URL expiry tracking buys nothing.
 *   - RETRY: the effect keys on the (sorted) path set, which gets a fresh identity
 *     on every `refetch()` from `useMealHistory` (a new `meals` array). So a
 *     Refresh re-fires the effect and re-mints any STILL-missing path (offline /
 *     timeout / partial failure), while a steady-state re-render mints nothing.
 *   - EMPTY GUARD: never call `createSignedUrls([])` (all-null / empty list).
 *   - TIMEOUT: a stalled mint surfaces as a transient failure (no hang), retryable.
 *
 * USER KEYING: the resolved URL map is keyed to the `userId` it was minted for and
 * dropped on user change, so a fast user-switch can never surface user A's signed
 * URLs (mirrors `useMealHistory`'s `(userId, …)` keying). Input invariant: every
 * `image_path` belongs to the current uid (the history query filters
 * `.eq('user_id', userId)`) — never batch-sign across users.
 *
 * 404 NEGATIVE-CACHE: a URL whose GET 404s (object gone) is reported via
 * `reportError`; that path is never re-signed for the session.
 *
 * PRIVACY: a signed URL is an unauthenticated BEARER token for a private health
 * photo. The URL map lives ONLY in memory — never serialized, never persisted,
 * never logged. We log a structural outcome only, never a path or URL. TTL is
 * locked at 1 h (do not raise: the bytes are cached, so a longer-lived token only
 * widens the leak window).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { MEAL_PHOTOS_BUCKET } from '@/features/capture/lib/storage';
import { useUser } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { TIMEOUT, withTimeout } from '@/lib/with-timeout';

import type { MealCard } from './use-meal-history';

const TTL_SECONDS = 3600; // 1 h — locked (signed URL = bearer token; do not raise).
const MINT_TIMEOUT_MS = 30_000;

export type SignedThumbnails = {
  /** The currently-known signed URL for a path, or `undefined` (→ placeholder). */
  urlFor: (path: string | null) => string | undefined;
  /** Negative-cache a path whose image 404'd so it isn't re-signed this session. */
  reportError: (path: string | null) => void;
};

type Resolved = { userId: string; urls: ReadonlyMap<string, string> };

export function useSignedThumbnails(meals: MealCard[]): SignedThumbnails {
  const { user } = useUser();
  const userId = user?.id ?? null;

  // Resolved URLs as STATE (not a bare ref) so a partial/failed mint can be
  // retried on a later render; an `entryRef` lets the mint effect read the latest
  // map WITHOUT taking it as a dep (which would re-fire the effect on every mint).
  const [entry, setEntry] = useState<Resolved | null>(null);
  // Mirror `entry` into a ref so the mint effect can read the latest map WITHOUT
  // taking it as a dep (that would re-fire on every mint). Synced in an effect —
  // declared BEFORE the mint effect so it commits first on a shared render.
  const entryRef = useRef<Resolved | null>(null);
  useEffect(() => {
    entryRef.current = entry;
  }, [entry]);

  // Paths whose GET 404'd this session — never re-sign a genuinely-gone object.
  const deadRef = useRef<Set<string>>(new Set());

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Drop the per-session dead-set when the user changes (the URL map is keyed to
  // userId in `entry` itself, so it's ignored for a different user automatically).
  useEffect(() => {
    deadRef.current = new Set();
  }, [userId]);

  // Distinct, non-null image paths, sorted → a fresh identity per `refetch()`.
  const paths = useMemo(() => {
    const set = new Set<string>();
    for (const m of meals) if (m.image_path) set.add(m.image_path);
    return [...set].sort();
  }, [meals]);

  useEffect(() => {
    if (!userId || paths.length === 0) return; // empty guard — no `createSignedUrls([])`.

    // Reuse URLs already minted for THIS user; otherwise start a fresh map.
    const base = entryRef.current?.userId === userId ? entryRef.current.urls : null;
    const missing = paths.filter((p) => !deadRef.current.has(p) && !base?.has(p));
    if (missing.length === 0) return; // all known/dead — nothing to mint (no storm).

    let active = true;
    void (async () => {
      let result: Awaited<ReturnType<typeof mint>> | typeof TIMEOUT;
      const mint = () =>
        supabase.storage.from(MEAL_PHOTOS_BUCKET).createSignedUrls(missing, TTL_SECONDS);
      try {
        result = await withTimeout(mint(), MINT_TIMEOUT_MS);
      } catch {
        return; // thrown → transport failure; transient, retryable on Refresh.
      }
      if (!active || !mounted.current) return;
      if (result === TIMEOUT) return;

      const { data, error } = result;
      if (error || data == null) {
        console.warn('[useSignedThumbnails] mint failed'); // structural only — no path/url.
        return;
      }

      const next = new Map(base ?? []);
      let added = 0;
      for (const item of data) {
        // Write ONLY a genuinely-signed entry: an item can be `error:null` with a
        // null `signedUrl` — caching that would feed `<Image uri={null}>`.
        if (item.error == null && item.path && item.signedUrl) {
          next.set(item.path, item.signedUrl);
          added += 1;
        }
      }
      if (added === 0) return; // nothing usable — leave state, retryable on Refresh.
      setEntry({ userId, urls: next });
    })();

    return () => {
      active = false;
    };
  }, [userId, paths]);

  const urlFor = useCallback(
    (path: string | null): string | undefined => {
      if (!path || !userId || deadRef.current.has(path)) return undefined;
      return entry?.userId === userId ? entry.urls.get(path) : undefined;
    },
    [entry, userId],
  );

  const reportError = useCallback((path: string | null) => {
    if (path) deadRef.current.add(path);
  }, []);

  return useMemo(() => ({ urlFor, reportError }), [urlFor, reportError]);
}
