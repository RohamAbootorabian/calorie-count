# Plan: Meal photo thumbnails in History

- **Status**: ~~Draft~~ → ~~In Review~~ → ~~Approved~~ → ~~In Progress~~ → **Done** (user web-verified 2026-06-24)
- **Created**: 2026-06-24
- **Plan #**: 0013

## Problem / Goal
The History list (plan 0012) shows each saved meal's text (dish name, time,
macros, quality) but **no photo** — so meals are visually indistinguishable and
the uploaded image is dead weight in storage. The `meal-photos` bucket is
**private**, so a row's `image_path` is NOT directly loadable: a phone can't just
point `<Image source={{ uri }}>` at a bucket path.

**Goal:** render a small thumbnail of each meal's photo in its History row by
minting short-lived **signed URLs** for the listed `image_path`s, with sane
caching (don't re-mint on every render; let the image bytes survive URL
rotation). "Done" = each meal row in History shows its photo (left of the text);
rows with no photo or a transiently un-mintable URL show a neutral placeholder;
nothing crashes offline or when a path 404s; `tsc` + `lint` green; user
web-verifies the thumbnails render.

This is also the project's **first `createSignedUrl(s)` integration** — the
pattern established here (batch-mint + expiry cache + expo-image cacheKey) is
what Daily-totals/Meal-edit will reuse.

## Non-goals
- **No full-size / lightbox view** — tapping a thumbnail does nothing new this
  plan (a follow-up can open a detail/zoom screen).
- **No pagination change** — still the 0012 `limit(100)` window.
- **No new column / migration / bucket policy** — `image_path` already exists and
  the owner-scoped Storage SELECT policy (`(storage.foldername(name))[1] =
  auth.uid()`, used by 0011's delete) already authorizes signing.
- **No native-device verification this plan** — web-verify like 0012; bundle the
  real-iPhone pass with the other deferred device tests (0007/0012).
- **No backfill** — meals whose `image_path` is null (older/failed-upload rows)
  simply render the placeholder; we do not try to reconstruct them.

## Proposed approach
**One batch-mint hook + a thumbnail in the row. No backend work.**

### 1. `useSignedThumbnails(meals)` — `src/features/history/lib/use-signed-thumbnails.tsx`
A plain hook (same shape discipline as `useMealHistory`/`useProfile`) that turns
the list's `image_path`s into a `Map<path, url>` of signed URLs. **Simplified vs.
the first draft** (review SF — drop the expiry/margin bookkeeping):
`createSignedUrls` is one cheap batch call and `expo-image`'s `cacheKey` makes the
**bytes** survive URL rotation, so per-entry expiry tracking buys nothing. We
**mint the full distinct path set whenever that set (or the user) changes** — no
`expiresAt`, no `REFRESH_MARGIN_MS`.

- Input: the `MealCard[]` from `useMealHistory` (it owns the source of truth;
  this hook is derived state — **never fetches meals itself**).
- **Input invariant:** every `image_path` is namespaced to the current uid
  (guaranteed by the history query's `.eq('user_id', userId)`); we never batch-sign
  across users. (Note this so the Daily-totals/Meal-edit reuse keeps the invariant.)
- Collect the **distinct non-null** `image_path`s, sorted, joined into a **stable
  dep string**. The mint `useEffect` depends on `(userId, depString, reloadKey)`
  — see "retry" below.
- Batch-mint with **one round-trip, never per-row**:
  `supabase.storage.from(MEAL_PHOTOS_BUCKET).createSignedUrls(paths, TTL_SECONDS)`.
  - **Empty guard (BLOCKER):** if `paths.length === 0`, do **not** call
    `createSignedUrls` (all-null / empty list) — early-return.
  - **Timeout (BLOCKER):** wrap the call in the shared `withTimeout` race
    (same 15–45 s pattern as `upload-meal-photo.ts`); a stall → transient failure,
    no cache write, retryable via Refresh. Without this a hung mint = permanent
    placeholders with no recovery.
  - **Exact result shape (BLOCKER):** `createSignedUrls` resolves
    `{ data, error }` where on success `data` is
    `{ error: string | null; path: string | null; signedUrl: string | null }[]`
    (lowercase `signedUrl`). Top-level `error` (or `data == null`) → whole batch
    failed, write nothing. Per entry, write to the map **only when
    `entry.error == null && entry.signedUrl` is a non-empty string**, keyed by
    `entry.path` (guard `path != null`). An `error:null / signedUrl:null` entry
    must NOT be cached (would feed `<Image source={{ uri: null }}>`).
- **State, not a bare ref (SF — fixes the retry wedge):** keep the resolved URLs
  in a `useState`-backed `Map<path, url>` (plus a `userId` guard), so a partial /
  timed-out / offline mint can be **retried**: the user's Refresh bumps
  `reloadKey`, the effect re-fires (its deps include `reloadKey`) even when the
  path set is byte-identical, and re-mints the still-missing paths. A pure ref
  keyed only to the missing-set dep would never re-fire on an identical refetch.
- **Negative-cache a 404'd path** for the session so a genuinely-gone object
  (signing succeeds, GET 404s) is not re-signed on every refetch (data NIT) —
  `onError` from the row invalidates that path into a "dead" set the mint skips.
- Expose a stable `urlFor(path): string | undefined` (memoized `useCallback`).
  Missing / not-yet-minted / mint-failed / dead → `undefined` → placeholder.
- **Lifecycle + user keying (copy `useMealHistory`):** `mounted` ref + per-attempt
  `active` flag; never `setState` after unmount; **key the URL map to `userId`**
  and clear it on user change so a fast user-switch can't surface user A's signed
  URLs (mirrors `useMealHistory`'s `(userId, reloadKey)` keying).
- **PII discipline (enforceable invariant):** the URL map lives **only in memory**
  — never serialized, never written to a persisted store, never logged. Never log
  a path or URL — only a structural outcome/count on failure. (Verify by grep; see
  Test plan.)

### 2. Thumbnail in `MealRow` — `history-screen.tsx`
- `MealRow` gains a `thumbUrl?: string` prop. Render an `expo-image` `<Image>`
  (already the project's image component) **left of** the existing text block, a
  fixed square (`56×56`, `Radius.md`), `contentFit="cover"`.
- **expo-image `cacheKey` (NATIVE only — corrected):** set
  `source={{ uri: thumbUrl, cacheKey: meal.image_path }}`. On **native** iOS/Android
  (the real shipping target) expo-image keys its disk/memory cache to the stable
  `image_path`, so the immutable object's bytes are fetched **once** and survive
  URL rotation, refetch, and app restart — the crux of "sane caching." On **web**,
  expo-image renders a plain `<img src=uri>` and **ignores `cacheKey`** (caching is
  the browser HTTP cache keyed by the full URL). So on web the "no re-fetch on
  refetch" property comes from the **mint-on-set-change cache keeping the URL
  stable within a session**, NOT from `cacheKey`. We keep `cacheKey` (load-bearing
  on native, harmless on web); the true cacheKey-survival test rides the deferred
  native pass — see Test plan. Disk-cache-across-restart is a native expo-image
  default (memory-disk), confirm rather than assert.
- **Placeholder:** committing to the lowest-risk default (closes OQ2) — a **flat
  themed tile** (`backgroundElement`/`border`, no icon) at the SAME fixed 56×56
  footprint, always mounted, so the row height never jumps and there's no
  mount/unmount flash. Use expo-image's **`placeholder` prop** for the load state
  and **`onError`** for a 404 (→ show the flat tile AND invalidate that path into
  the hook's dead-set). The `errored` flag must **reset when `meal.image_path`
  changes** so a once-404'd row recovers if a good URL later arrives.
- When `thumbUrl` is `undefined`, render the flat placeholder **element** — do
  NOT pass `{ uri: undefined, cacheKey }` to `<Image>`.
- Re-layout `rowTop`: `[thumb] [info…] [Delete]` — thumb `flex: 0` fixed 56×56,
  info keeps `flex: 1`. Macros stay below. Sanity-check vertical alignment: the
  56 px thumb is taller than the ~2-line text column under `alignItems:
  'flex-start'` — align the thumb to the top and confirm the row doesn't look
  lopsided (adjust to `center` if needed).
- **`MealRow` is `React.memo`'d** on `meal.id` + `thumbUrl` so a URL resolving for
  one row doesn't re-render all 100 (the `urlFor` callback is stable).

### 3. Wire it in `HistoryScreen`
- Call `useSignedThumbnails(meals)` after `useMealHistory()`.
- In `renderItem`, pass `thumbUrl={urlFor(meal.image_path)}` to `MealRow`.
- No change to the delete flow, loading/error gates, or list plumbing.

## Files to change
- `src/features/capture/lib/storage.ts` — **new (tiny).** Export
  `MEAL_PHOTOS_BUCKET = 'meal-photos'`. The literal is currently triplicated
  (`upload-meal-photo.ts`, `delete-meal-photo.ts`, and this plan would add a
  third); centralize it now since we're adding the third site. Update the two
  existing files to import it (the new hook imports it too). (Pure refactor, no
  behavior change — keep it minimal; if the team prefers, fold the constant into
  an existing capture/lib file instead of a new one.)
- `src/features/history/lib/use-signed-thumbnails.tsx` — **new.** Mint-on-set-change
  signed URLs for the visible meals' `image_path`s (batch, timeout-guarded, empty-
  guarded, user-keyed, retry-on-Refresh, 404 negative-cache); returns a stable
  `urlFor(path)` lookup. ~90 lines, mirrors `use-meal-history.tsx` lifecycle.
- `src/features/history/screens/history-screen.tsx` — call the hook; add a
  `thumbUrl` prop to a now-`React.memo`'d `MealRow`; render the `expo-image`
  thumbnail with `placeholder`/`onError` + the flat placeholder tile; adjust
  `rowTop` styles + alignment for the leading image.
- `src/features/capture/lib/upload-meal-photo.ts` / `delete-meal-photo.ts` —
  import `MEAL_PHOTOS_BUCKET` instead of the local `BUCKET` literal. (Optional:
  extract the `withTimeout` helper here into a shared util the new hook reuses,
  rather than duplicating the race a third time.)
- (No change to `use-meal-history.tsx` — `image_path` is already in the `MealCard`
  allowlist, so the data is already fetched.)

## Data model / schema impact
**None.** `meal_logs.image_path` already exists and is already selected by
`useMealHistory`. Signing a URL authorizes against the **SELECT** policy on
`storage.objects`, which is **verified present**: `meal_photos_select`
(`for select using (bucket_id = 'meal-photos' and (storage.foldername(name))[1] =
auth.uid()::text)`) in `supabase/migrations/20260619102510_initial_schema.sql:222`.
(This is a *distinct* policy from the DELETE policy 0011 uses — don't conflate
them.) `createSignedUrl(s)` POSTs to the storage `/object/sign` endpoint, which the
server gates on this SELECT policy. No migration, no bucket/policy change, no Edge
Function. **Cost:** signing is a metadata-only HMAC round-trip (no egress); photo
egress happens once per distinct object (cacheKey), bounded by distinct photos, not
renders — no runaway risk.

## Edge cases & failure modes
- **Null `image_path`** (older meals, failed uploads): no mint, render placeholder.
  Filtered out of the batch so it never pollutes `createSignedUrls`.
- **`createSignedUrls` partial failure:** the batch result is a per-item array
  with a possible `error` per entry — map only the successful ones into the cache;
  a failed entry → no cache write → placeholder (and a later refetch retries it).
- **Object 404 (path in row but blob gone):** signing may still succeed (signing
  doesn't check existence) but the GET 404s → `expo-image` `onError` → placeholder.
  Shouldn't normally happen (delete removes row+photo together; the 0011 sweep
  only reaps *orphans* — photos with no row), but handle it defensively.
- **Offline:** mint request fails/throws → caught, no URLs, placeholders shown;
  the list text still renders. expo-image serves any disk-cached bytes for paths
  it has seen before (the cacheKey makes this work).
- **Signed URL expiry mid-session:** URLs are valid 1 h from mint. Known
  limitation: on a screen left open >1 h, a row scrolled into view for the FIRST
  time (never fetched) with an expired URL → 404 → placeholder; a **Refresh**
  (bumps `reloadKey`) re-mints it. Already-fetched rows keep their bytes (cacheKey
  on native / browser cache on web). Documented, not blocking.
- **Sign-out mid-mint / unmount:** `mounted`+`active` guards drop the late
  `setState` (verbatim from `useMealHistory`).
- **Large list (100 rows):** one `createSignedUrls` call, not 100; expo-image
  lazy-loads only on-screen rows via `FlatList` virtualization.
- **Re-mint storms:** the sorted-path-set dep + expiry cache ensure a refetch that
  returns the same paths does not re-sign; only new/expired paths are minted.
- **PII:** never log paths/URLs; signed URLs are short-lived owner-scoped tokens —
  never persisted to disk by us or logged.

## Test / verify plan
- `npx tsc --noEmit` — PASS (new hook + prop types).
- `npx expo lint` — clean.
- Web bundle compiles (HTTP 200) on `npx expo start --web --port 8081`.
- **Grep gate (PII):** `grep -nE "console\.(log|warn|error).*(path|url|signedUrl)"`
  in the new hook returns nothing; the URL map is never passed to a persisted store.
- **Manual (web, logged in):**
  1. History list shows a photo thumbnail on each meal that has one. (This *is* the
     `meal_photos_select` policy proof — a thumbnail loading = SELECT authorized.)
  2. A meal with no `image_path` shows the flat placeholder, **no layout jump**.
  3. Refresh button: the **same** signed URL is reused within the session (DevTools
     Network shows no new `createSignedUrls` and no new image GET for unchanged
     paths). NOTE: on web this proves the **mint-on-set-change cache** kept the URL
     stable — NOT `cacheKey` byte-survival (web ignores `cacheKey`). The true
     cacheKey-across-rotation test is the deferred native pass.
  4. Delete a meal: row leaves; remaining thumbnails unaffected.
  5. DevTools Network: exactly **one** `createSignedUrls` call per distinct path
     set (not one per row); no repeat on a same-path refetch.
  6. Offline (DevTools offline) after first load: previously-fetched thumbnails
     still render (browser HTTP cache on web / disk cache on native); never-fetched
     → placeholder; no crash. A forced mint failure → placeholders, then a Refresh
     after going back online **recovers** them (retry path).

## Rollout
Pure client change. No migration, no secret, no Edge deploy. Order:
1. Land the hook + screen change on `main`.
2. `tsc` + `lint` + web-bundle check.
3. User web-verifies the thumbnails.
4. Journal + mark plan Done + commit & push. (Real-device thumbnail check rides
   with the deferred 0007/0012 iPhone pass.)

## Open questions
1. **Thumbnail size/shape** — proposing `56×56` rounded square (`Radius.md`),
   `contentFit="cover"`. OK, or larger (e.g. 64) / circle? (cosmetic, easy to tune)
2. ~~**Placeholder visual**~~ — **CLOSED** (review): ship a flat themed tile
   (`backgroundElement`/`border`, no icon) at 56×56; an icon/art is a cosmetic
   follow-up that rides the tracked tab-art TODO.
3. ~~**TTL**~~ — **CLOSED** (data review): lock at **1 h, do not raise.** A signed
   URL is an unauthenticated **bearer token** for a private health photo; with the
   bytes cached (cacheKey) there is no UX benefit to a longer token, only a longer
   leak window. Reject the 24 h idea.
4. **Tap-to-enlarge** is a non-goal here — confirm we're fine shipping thumbnails-only
   first and doing the lightbox as a separate plan.

---

## Review
_Balanced 4-lens review (correctness, architecture, edge cases, data/privacy),
2026-06-24. Findings consolidated + deduped; the plan body above has been edited to
resolve every blocker. Verdict below._

### BLOCKER (all resolved in the plan above)
- **B1 — Exact `createSignedUrls` result shape + null handling.** (correctness)
  `{ data, error }` where `data` is `{ error, path, signedUrl }[]` (lowercase
  `signedUrl`). An entry can be `error:null / signedUrl:null` — caching that would
  feed `<Image source={{ uri: null }}>`. **Resolution:** approach §1 now specifies
  writing the map only when `entry.error == null && entry.signedUrl` is a non-empty
  string, keyed by `entry.path`; top-level error → write nothing.
- **B2 — No timeout on `createSignedUrls`.** (edge) Every sibling helper uses a
  15–45 s `withTimeout` race; a hung mint = permanent placeholders, no recovery.
  **Resolution:** §1 now wraps the call in the shared `withTimeout`; stall →
  transient failure, retryable via Refresh.
- **B3 — Empty-array call.** (edge) All-null / empty list ⇒ `paths = []`; calling
  `createSignedUrls` with `[]` is a wasted/loop-risk round-trip. **Resolution:**
  §1 early-returns when `paths.length === 0`.
- **B4 — Verify plan over-claimed `cacheKey` on web (the platform we verify on).**
  (correctness + edge) expo-image **ignores `cacheKey` on web** (`<img src=uri>`);
  the web "no re-fetch" win comes from URL stability, not byte-survival. As written,
  test 3 would "prove" the wrong mechanism and could mask a failure. **Resolution:**
  the `cacheKey` rationale (approach §2) and Test steps 3/6 are corrected to
  attribute web caching to the mint-on-set-change cache and defer the true
  cacheKey-survival test to the native pass.
- **B5 (raised, then RESOLVED by verification, not an edit) — SELECT storage
  policy assumed.** (correctness + data) Signing needs a `storage.objects` **SELECT**
  policy, which is a *separate* policy from 0011's DELETE. The data reviewer
  **verified it exists**: `meal_photos_select` in
  `20260619102510_initial_schema.sql:222`. The plan's data-model section now cites
  it by name/file instead of conflating it with the DELETE policy. No migration
  needed; the non-goal holds.

### SHOULD-FIX (folded into the plan)
- **Simplify the cache (architecture).** The ref-backed expiry cache +
  `REFRESH_MARGIN_MS` + inverted expiry math (correctness SF1) is over-engineered
  for a 100-item bound where `cacheKey` already absorbs URL churn. **Resolution:**
  redesigned to **mint-on-set-change, no expiry tracking** — removes the margin,
  the unit-mixing (s vs ms) bug surface, and the expiry math entirely.
- **Retry wedge (correctness + edge).** A dep keyed to the mutable "missing-set"
  from a bare ref never re-fires after a partial/timeout/offline failure.
  **Resolution:** URLs in `useState` keyed to `userId`; effect deps include
  `reloadKey` so Refresh retries an identical path set.
- **Centralize `BUCKET = 'meal-photos'`** (architecture) — now triplicated.
  **Resolution:** added `MEAL_PHOTOS_BUCKET` shared constant to Files-to-change;
  the two existing files import it.
- **Sign-out / user-switch mid-mint (edge).** **Resolution:** URL map keyed to
  `userId`, cleared on user change (mirrors `useMealHistory`).
- **`onError` per-uri reset + 404 negative-cache (correctness + data).**
  **Resolution:** `errored` resets on `image_path` change; a 404'd path is negative-
  cached for the session so it isn't re-signed every refetch.
- **Render churn (edge).** **Resolution:** `MealRow` is `React.memo`'d on
  `meal.id`+`thumbUrl`; `urlFor` is a stable `useCallback`.
- **TTL as a bearer token (data).** **Resolution:** OQ3 closed — 1 h, do not raise;
  documented threat-model rationale.
- **PII no-persist/no-log enforceable (data).** **Resolution:** in-memory-only
  invariant stated + a grep gate added to the Test plan.
- **Placeholder footprint / load state (edge).** **Resolution:** flat tile always
  mounted at fixed 56×56; expo-image `placeholder` prop for load (no mount/unmount
  flash); alignment sanity-check noted.

### NIT (addressed or noted)
- `urlFor → undefined` renders the placeholder **element**, never `{ uri: undefined }`
  (approach §2). • Paths go in the POST **body**, so 100 paths is fine. • Duplicate
  `image_path`s: lookup is **path-keyed**, one mint serves N rows. • "survive app
  restart" softened to "native expo-image disk-cache default — confirm, don't
  assert." • Cross-user input invariant documented for future reuse. • Cost note
  (signing is metadata-only) added.

### Verdict
**APPROVED** — the 5 blockers are resolved in the plan body (B5 by verifying the
SELECT policy exists; the other four by concrete plan edits). Remaining items were
should-fix/nit and are folded in. Ready to execute. OQ1 (thumb size) and OQ4
(thumbnails-only first) are cosmetic/scope confirmations, not blockers.

## Execution log
**2026-06-24 — code-complete (pre user-verify).** Built strictly to the approved
plan; no design deviations.

**Added:**
- `src/features/capture/lib/storage.ts` — `MEAL_PHOTOS_BUCKET` shared constant.
- `src/lib/with-timeout.ts` — extracted the `withTimeout`/`TIMEOUT` race so the new
  minter reuses it (the upload helper keeps its own copy; not refactored to limit
  blast radius — noted as optional in the plan).
- `src/features/history/lib/use-signed-thumbnails.tsx` — the minter, exactly per
  approach §1: mint-on-set-change (no expiry bookkeeping), one batch
  `createSignedUrls(paths, 3600)`, empty guard, 30 s `withTimeout`, exact result
  handling (`item.error == null && item.path && item.signedUrl`), URL map in
  `useState` keyed to `userId`, retry-on-Refresh (effect deps `[userId, paths]`;
  `paths` gets a fresh identity per refetch), 404 negative-cache via `reportError`,
  in-memory-only + no-path/url logging.
- `src/features/history/screens/history-screen.tsx` — `useSignedThumbnails(meals)`;
  `MealRow` now `React.memo`'d with a 56×56 leading `Thumbnail` (expo-image,
  `cacheKey: image_path`, `placeholder`/transition, `onError` → flat themed tile +
  `reportError`); flat placeholder when no URL; `thumb` styles.

**Updated:** `delete-meal-photo.ts` + `upload-meal-photo.ts` import
`MEAL_PHOTOS_BUCKET`.

**Two small implementation choices (within plan intent, worth recording):**
1. **`errored` reset via `key`, not a `useEffect`.** The plan said "reset the
   `errored` flag when `image_path` changes." Implementing that with
   `useEffect(() => setErrored(false), [cacheKey])` tripped the
   `react-hooks/set-state-in-effect` lint. Resolved the idiomatic way: the parent
   keys `<Thumbnail key={image_path}>`, so a changed photo remounts and the flag
   resets for free. Same behavior, no setState-in-effect.
2. **`entryRef` synced in an effect, not during render** (`react-hooks/refs`
   forbids ref writes in render) — declared before the mint effect so it commits
   first on a shared render.

**Verified:** `npx tsc --noEmit` PASS; `npx expo lint` clean (0 problems); web
bundle compiles — `expo-router/entry.bundle?platform=web` returns HTTP 200, ~8 MB,
zero `*Error` objects. **User web-verified 2026-06-24** in a logged-in browser
(thumbnails render; placeholder for no-photo; one `createSignedUrls` per path set;
Refresh reuses URLs; delete unaffected). **Plan 0013 DONE.** Native
cacheKey-survival test rides the deferred 0007/0012 iPhone pass.
