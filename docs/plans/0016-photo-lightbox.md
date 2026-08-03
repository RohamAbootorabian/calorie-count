# Plan: Photo lightbox (full-screen meal photo)

- **Status**: ~~Draft~~ → ~~In Review~~ → ~~Approved~~ → ~~In Progress~~ → **Done**
- **Created**: 2026-06-24
- **Plan #**: 0016

## Problem / Goal
History rows show a 56×56 meal-photo thumbnail (plan 0013), but there's no way to
see the photo larger — the detail is lost at thumbnail size. Tapping a thumbnail
should open a **full-screen view** of that meal's photo, then dismiss back to the
list.

This is a **pure client, no-migration** feature that **reuses the signed URL plan
0013 already minted** for the thumbnail (`useSignedThumbnails.urlFor`) — so it adds
no new storage call in the common case and inherits 0013's privacy posture.

**"Done" =** from History, tapping a thumbnail that has a **minted URL** opens a
full-screen, aspect-correct view of that exact photo; a themed close control AND a
tap on the backdrop AND Android hardware-back all dismiss it; tapping a row with no
photo (placeholder) does nothing; a rare minted-but-404 photo shows the dark scrim
with no image and still dismisses (no crash); `tsc`/`lint`/web-bundle green; user
web-verifies.

## Non-goals
- **No new fetch / no new signed-URL logic.** The lightbox consumes the URL the
  thumbnail already has; it does NOT instantiate its own `useSignedThumbnails` or
  call `createSignedUrl(s)`. (If a path was never minted/loaded, its row simply
  isn't tappable — see edge cases.)
- **No route / deep-link.** A signed URL is an unauthenticated **bearer token** for
  a private health photo; putting it in route params would serialize it into
  navigation state / a shareable URL. The viewer is an **in-screen Modal overlay**
  so the URL never leaves React memory. (Same reason 0013 keeps the URL map
  in-memory only.)
- **No zoom / pan / pinch gestures** — v1 is a fit-to-screen still view. Pinch-zoom
  is a named follow-up.
- **No swipe-between-photos gallery** — v1 opens exactly the tapped photo.
- **No share / save / download** affordance (would re-expose the bearer URL).
- **No lightbox from the edit screen or capture review** — History only (the one
  surface with persisted thumbnails today).
- **No photo editing/replacement** (that's a separate, larger feature).

## Proposed approach
**One new presentational component + a tap handler in History.** The smallest change
that fully solves it: make the existing thumbnail pressable *only when it has a
loaded URL*, lift a tiny `lightbox` state into the History screen, and render a
full-screen `Modal` over the list showing the same `expo-image` source.

### 1. `PhotoLightbox` — `src/features/history/screens/photo-lightbox.tsx` (NEW)
A controlled, presentational full-screen viewer. Props (tightened per review):
`{ url: string; cacheKey: string; onClose: () => void }` — **no** `onError`/spinner/
inline-error in v1 (review B1).
- Renders a React Native **`Modal`** (`transparent`, `animationType="fade"`,
  `onRequestClose={onClose}` for **Android hardware-back**). RN `Modal` works under
  `react-native-web`, so one component covers web + native. Does **NOT** use the
  `<Screen>` primitive (it clamps to `MaxContentWidth` + tab insets) — a bare `Modal` +
  full-bleed `View`.
- **Backdrop:** a full-screen `Pressable` with a fixed dark scrim (`rgba(0,0,0,0.9)` —
  a photo-viewer backdrop is conventionally dark in BOTH themes, so this is an
  intentional fixed color, not a theme token) that calls `onClose` on press. The scrim
  fills the WHOLE screen including unsafe areas (notch/home indicator).
- **Image:** `expo-image` `<Image source={{ uri: url, cacheKey }}>` `contentFit="contain"`,
  `key={cacheKey}` (so swapping to a different photo remounts cleanly rather than
  cross-fading stale bytes). Wrapped in its OWN `Pressable` with a **no-op `onPress`** so
  a tap on the photo is swallowed and does NOT bubble to the backdrop (RN responder
  chain — a bare `View` would NOT stop it); only the backdrop / ✕ dismiss. `cacheKey` =
  the row's `image_path`, so on **native** the lightbox reuses the **bytes already
  cached** by the 56×56 thumbnail (no re-download); web reuses the browser URL cache
  (same signed URL). On a failed decode the viewer shows the dark scrim with no image;
  backdrop/✕ still dismiss (no inline error, no negative-cache in v1 — review B1).
- **Close control:** a themed "✕" `Pressable` pinned top-right inside the top safe-area
  inset (`useSafeAreaInsets`), `accessibilityRole="button"`, `accessibilityLabel="Close"`
  (STATIC — never interpolate dish/path), `hitSlop={Spacing.two}` (reuse the token,
  matches Edit/Delete/Refresh). Uses theme tokens for the icon/touch target.
- **Native polish (deferred iPhone pass):** set a light `<StatusBar>` style while open
  (light icons over the dark scrim) and `accessibilityViewIsModal` on the content so
  VoiceOver doesn't read the list behind the scrim.
- **Privacy:** never logs the `url`/`cacheKey`; the URL exists only as a prop in
  memory (mirrors `useSignedThumbnails`).

### 2. History wiring — `src/features/history/screens/history-screen.tsx`
- New state in `HistoryScreen`:
  `const [lightbox, setLightbox] = useState<{ url: string; cacheKey: string } | null>(null)`.
- `MealRow` gains an `onPressPhoto?: () => void` prop. In `renderItem`, REUSE the single
  already-computed `const thumbUrl = urlFor(meal.image_path)`:
  `onPressPhoto = thumbUrl ? () => setLightbox({ url: thumbUrl, cacheKey: meal.image_path }) : undefined`.
  Reusing the one `thumbUrl` value for BOTH the gate and the URL avoids a second
  `urlFor` call (no mid-render mismatch) and needs no `!` — TS narrows `thumbUrl` to
  `string` and `meal.image_path` is provably non-null inside the truthy branch. A
  placeholder / not-yet-minted / negative-cached path → `thumbUrl` `undefined` →
  `onPressPhoto` `undefined` → not tappable.
- In `MealRow`, wrap the `<Thumbnail>` in a `Pressable` when `onPressPhoto` is
  provided (`accessibilityRole="button"`, `accessibilityLabel="View photo"` — STATIC);
  when not provided, render the bare `Thumbnail` (placeholder stays inert). The fixed
  56×56 footprint and existing layout are unchanged.
- Render `{lightbox && <PhotoLightbox url={lightbox.url} cacheKey={lightbox.cacheKey}
  onClose={() => setLightbox(null)} />}` at the History screen root (outside the
  `FlatList`). No `onError` wiring (review B1).
- **Close on auth change (privacy):** an effect that calls `setLightbox(null)` when
  `userId` becomes null / changes, so a sign-out can't leave user A's in-state signed
  URL viewable while unmount timing settles — don't rely on unmount alone.
- **Dead-URL handling is the thumbnail's job, not the lightbox's:** if an object 404s,
  the thumbnail's OWN existing `onError`→`reportError` (plan 0013, untouched) fires on
  its next decode and drops that row to the placeholder, which also makes it
  un-tappable. The lightbox does not duplicate this (avoids permanently poisoning a
  merely-expired-but-valid path — review B1).

## Files to change
- `src/features/history/screens/photo-lightbox.tsx` — **new.** The full-screen Modal
  viewer (`contentFit="contain"`, dark scrim, ✕ + backdrop dismiss; no spinner/error in v1).
- `src/features/history/screens/history-screen.tsx` — `lightbox` state; make the
  thumbnail pressable when it has a minted URL (reuse the single `thumbUrl`); render
  `<PhotoLightbox>`; close-on-`userId`-change effect.

## Data model / schema impact
**None.** No tables, columns, migrations, RLS, or storage changes. Pure client; reuses
the private `meal-photos` bucket via the already-minted signed URL (no new bucket call
in the common case).

## Edge cases & failure modes
- **Row with no photo** (`image_path` null) → `urlFor` returns `undefined` → no
  `onPressPhoto` → the placeholder tile is inert (nothing opens).
- **URL not yet minted** (mint in flight / offline / timed out) → `urlFor` undefined →
  not tappable yet; becomes tappable once the mint lands and the row re-renders. No
  separate loading affordance needed on the thumbnail.
- **Object 404'd after mint** (deleted on another device / 0011 sweep): the lightbox
  shows the dark scrim with no image; backdrop/✕ still dismiss (no crash, no inline
  error in v1). Separately, the thumbnail's OWN `onError`→`reportError` drops that row
  to the placeholder on its next decode → it stops being tappable. Rare: the lightbox
  only opens for a path whose thumbnail just loaded the same bytes.
- **Android hardware back** while open → `Modal.onRequestClose` → `onClose`.
- **Web Escape key** → RN `Modal` on web does not route Escape to `onRequestClose`; the
  "✕" close button + backdrop tap are the web dismiss paths. **Decided: no `keydown`
  listener in v1** (OQ1).
- **Web browser Back button** → RN `Modal` pushes no history entry, so browser Back
  navigates the router underneath rather than dismissing the Modal. **Accepted for v1**
  (not intercepted) — a router change unmounts History → the Modal with it.
- **Tap on the photo itself** → swallowed by the image's own no-op `Pressable`; does NOT
  dismiss (only the backdrop/✕ do), so a mis-tap while viewing doesn't close it.
- **Sign-out while open** → the close-on-`userId`-change effect drops `lightbox` (belt)
  and History unmounts the Modal (braces); user A's URL is never left viewable.
- **Rapid re-taps / tapping a different row** → `setLightbox` replaces the single state
  object; `key={cacheKey}` on the image remounts it cleanly (no stale-byte flash); only
  one Modal is ever mounted.
- **Delete in flight on the same row** → the thumbnail stays viewable (read-only view
  is harmless); if the delete completes, `refetch` drops the row but an open Modal is
  independent and still dismissible.
- **Very tall/wide photo** → `contentFit="contain"` letterboxes to fit; no overflow.
- **Signed URL expires (1 h TTL) while the Modal sits open a long time** → on a
  re-decode the image fails → blank scrim, still dismissible. NOTE: v1 does NOT
  negative-cache from the lightbox, precisely so a merely-**expired** (still-valid)
  photo isn't permanently poisoned for the session; a Refresh re-mints it normally.

## Test / verify plan
- `npx tsc --noEmit` PASS; `npx expo lint` clean; web bundle HTTP 200 (valid JS, no
  error envelope) including the new component.
- **Manual (web, logged in):**
  1. History → tap a thumbnail that shows a photo → full-screen photo opens, aspect
     preserved, dark backdrop.
  2. Tap the backdrop → dismisses. Reopen → tap the ✕ → dismisses.
  3. Tap the photo itself → stays open (only backdrop/✕ dismiss).
  4. Tap a row with NO photo (placeholder) → nothing opens.
  5. Open a meal, delete its object out-of-band (or use a known-404 row) → lightbox
     shows "couldn't load" and dismisses; that row's thumbnail becomes a placeholder.
  5. Open a meal, sign out (or trigger a user change) while the Modal is open → it
     closes; no photo lingers.
  6. Regression: thumbnails, Edit, Delete, pull-to-refresh, focus-refetch all still
     work; row height/layout unchanged.
- **Deferred iPhone pass:** hardware-back dismisses; light StatusBar over the scrim;
  native byte-cache reuse (the full image appears instantly from the thumbnail's cached
  bytes via `cacheKey`); VoiceOver doesn't read the list behind the scrim.
- **Grep gate:** the lightbox logs no URL/path/dish AND `photo-lightbox.tsx` never
  interpolates `url`/`cacheKey`/`path`/`signedUrl` into any JSX text or `console.*`; the
  signed URL never enters route params or any serialized state; a11y labels are static.

## Rollout
1. Land the two files on `main` (no migration, no env, no deploy step).
2. `tsc`/`lint`/web-bundle; user web-verify.
3. Journal + mark Done + commit & push. Native back/zoom ride the deferred iPhone pass.

## Open questions
_All resolved in review — kept for the record._
1. **Web Escape-to-close** — RESOLVED: **no `keydown` listener in v1**; ✕ + backdrop
   are the web dismiss paths.
2. **Pinch-zoom** — RESOLVED: **out of scope** for v1 (named follow-up).
3. **Component location** — RESOLVED: `history/screens/photo-lightbox.tsx` (one
   consumer); **not** promoted to `shared/ui`.
4. **Backdrop opacity / animation** — RESOLVED: `rgba(0,0,0,0.9)` + `fade`, **kept**.

---

## Review
_Balanced 4-lens review (correctness, architecture, edge cases, data/privacy),
2026-06-24. Findings consolidated + deduped below. The single correctness BLOCKER and
a cluster of edge findings all resolve via ONE decision — **drop the spinner /
inline-error / `onError`→`reportError` machinery for v1** — which is also the
architecture reviewer's "smallest change" recommendation. All resolutions folded into
the plan above._

### BLOCKER (resolved)
- **B1 — `onError` behavior is self-contradictory AND its `reportError` path is wrong.**
  §1 said the lightbox shows an inline "Couldn't load" + keeps dismiss controls live;
  §2 said History's `onError` does `reportError(...)` **then `setLightbox(null)`**
  (auto-dismiss) — so the inline error would never be seen. Worse (edge + data lenses):
  `reportError` mutates a **ref** (`deadRef`, no re-render), so the claimed "thumbnail
  self-heals to placeholder" wouldn't happen until an unrelated re-render; and
  `reportError` **permanently** poisons the path for the session (cleared only on
  `userId` change), so a merely-**expired** (still-valid) photo after a >1 h open would
  be wrongly negative-cached and un-reopenable. **Resolution:** remove the lightbox's
  `onError` prop, spinner, and inline-error entirely for v1. The lightbox renders only
  `contentFit="contain"`; a failed decode shows the dark scrim with no image and
  backdrop/✕ still dismiss (rare — it only opens for an already-loaded thumbnail). The
  thumbnail's OWN existing `onError`→`reportError` (plan 0013, untouched) remains the
  sole negative-cache path. This deletes the defect class, a prop, component state, and
  a History wiring branch.

### SHOULD-FIX (folded in)
- **Backdrop touch-bubbling (correctness):** a bare inner `View` does NOT stop a tap on
  the photo from bubbling to the full-screen backdrop `Pressable` (RN responder chain),
  so tapping the photo would dismiss. **Fix:** wrap the image in its own `Pressable`
  with a no-op `onPress` (swallows the tap); only the backdrop / ✕ dismiss.
- **Reuse the single `thumbUrl` (correctness):** `renderItem` already computes
  `const thumbUrl = urlFor(meal.image_path)` once. Build
  `onPressPhoto = thumbUrl ? () => setLightbox({ url: thumbUrl, cacheKey: meal.image_path }) : undefined`
  — reuse that one value for BOTH the gate and the URL (no second `urlFor` call, no
  `!`); TS narrows `thumbUrl` to `string` and `meal.image_path` is provably non-null in
  that branch.
- **Tighten `cacheKey` to `string` (architecture):** the lightbox only opens for a
  `urlFor`-truthy path → `image_path` is non-null at the call site. Props become
  `{ url: string; cacheKey: string; onClose }` (no `string | null`, no `?? undefined`).
- **Close on auth change (data/privacy):** don't trust unmount timing to drop user A's
  in-state URL on sign-out. Add an effect in `HistoryScreen`: when `userId` becomes
  null/changes → `setLightbox(null)`.
- **Remount on photo swap (edge):** replacing the single `lightbox` state swaps `url`+
  `cacheKey` on the same mounted `<Image>` mid-fade → possible stale-byte flash. **Fix:**
  `key={cacheKey}` on the inner Image so a different photo remounts cleanly.
- **Extend the grep gate (data/privacy):** assert `photo-lightbox.tsx` never interpolates
  `url`/`cacheKey`/`path`/`signedUrl` into any JSX text or `console.*` (guards a future
  debug edit from leaking the bearer URL).
- **"Done" wording (correctness):** a `urlFor`-truthy path means the URL was *minted*,
  not that the image *loaded*. Reword "a thumbnail that has a loaded photo" → "a
  thumbnail that has a minted URL"; the rare minted-but-404 case is handled by graceful
  no-image + dismiss (per B1).
- **Web browser Back (edge):** RN `Modal` pushes no history entry, so browser Back
  navigates the router underneath rather than dismissing. **Accepted for v1** — noted in
  Edge cases; not intercepted.

### NIT (addressed/noted)
- Don't use the `<Screen>` primitive (it clamps to `MaxContentWidth` + tab insets) — a
  bare `Modal` + full-bleed `View`. • Scrim fills the WHOLE screen incl. unsafe areas;
  only the ✕ uses `useSafeAreaInsets`; set a light `<StatusBar>` while open and
  `accessibilityViewIsModal` (iOS) so VoiceOver doesn't read the list behind the scrim.
  • ✕ `hitSlop={Spacing.two}` (reuse the token, matches Edit/Delete/Refresh). • `onRequestClose`
  is Android-only — drop the "web close path" phrasing. • Keep a11y labels STATIC
  ("Close" / "View photo") — never `View photo of ${dish}`. • DevTools Network shows the
  `<img src>` (same as the existing thumbnail) — accepted, unchanged from 0013. •
  Screenshot exposure of a full photo is out of scope (thumbnails already on-screen). •
  Drag-from-photo-to-backdrop registering as a press is acceptable for v1.
- **Open questions resolved:** OQ1 — **no web Escape listener in v1** (✕ + backdrop
  suffice). OQ2 — pinch-zoom **out of scope** (named follow-up). OQ3 — component lives at
  `history/screens/photo-lightbox.tsx` (**not** promoted to `shared/ui`; one consumer).
  OQ4 — backdrop `rgba(0,0,0,0.9)` + `fade` **kept**.
- **Confirmed correct, no change:** Modal-not-route keeps the bearer URL out of
  serialized nav state (the central privacy call); reusing the in-memory `urlFor` URL
  mints nothing and does NOT widen the 1 h TTL; no new RLS/storage/bucket surface;
  sign-out unmount, delete-in-flight, null-path inertness all handled.

### Verdict
**APPROVED** — the lone BLOCKER (B1) is resolved by removing the `onError`/spinner/
inline-error machinery (smaller change, defect class deleted); all should-fixes folded
into §1/§2 and Edge cases; open questions decided. No migration, no new data surface.

## Execution log
Built exactly per plan, no deviations. New `photo-lightbox.tsx` — a bare RN `Modal`
(`transparent`, `animationType="fade"`, `onRequestClose`) with a fixed dark scrim
(`rgba(0,0,0,0.9)`) full-screen `Pressable` backdrop, an `expo-image` `contentFit="contain"`
source keyed on `cacheKey` wrapped in its OWN no-op `Pressable` (swallows the photo tap),
and a themed top-right ✕ inside the safe-area inset. No spinner / `onError` / inline-error
(per review B1). History wiring: single `thumbUrl` reused for both the tappable gate and
the URL, `lightbox` state, close-on-`userId`-change effect, `<PhotoLightbox>` rendered at
the screen root outside the FlatList.

**Verified:** `tsc --noEmit` PASS; `expo lint` clean; web bundle served on :8081; user
web-verified (open/backdrop-dismiss/✕-dismiss/photo-tap-keeps-open/placeholder-inert,
regression on thumbnails+Edit+Delete+refresh). Native back / byte-cache reuse / light
StatusBar ride the deferred iPhone pass. DONE.
