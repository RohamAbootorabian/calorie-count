# Plan: Capture & upload a meal photo (S2 · piece 1)

- **Status**: **Done** (2026-06-22) — built per plan; `tsc`/`lint` clean; **web click-through
  verification PASSED** (user confirmed: pick → preview → upload → object under the user's
  `meal-photos/{uid}/…` folder; cancel/bad-file paths friendly). One mechanism deviation (SF7
  AbortController → timeout race — storage-js `upload` has no `signal`); see Execution log.
  iPhone camera / native byte path (B2/OQ2) + the N4 web "Take photo" relabel are knowingly
  deferred to a later session. _(Approved 2026-06-21 — 3 blockers resolved, 10 should-fixes folded.)_
- **Created**: 2026-06-21
- **Plan #**: 0007

## Problem / Goal
S2 (Capture & AI Analysis) is the product core. Before any AI can run, the
signed-in user needs to **get a meal photo off their device and into our private
storage**. This piece builds exactly that first link: take **or** pick a photo →
preview it → upload it to the existing private `meal-photos` Storage bucket under
the user's own folder → hand back the stored object **path** for later steps.

No AI, no `meal_logs` write — those are pieces 2 and 3. This piece exists to make
the capture→storage path real, permissioned, and verifiable on web.

**Done looks like:**
- A new **Capture** entry in the signed-in app opens a capture screen.
- The user can **Take photo** (camera) or **Choose from library**; on native the
  OS permission prompt appears and a denial is handled gracefully.
- The picked image shows as a **preview**.
- **Upload** sends it to `meal-photos/{uid}/<name>` (RLS-scoped to the user) and
  shows a clear success (the returned storage **path**) or a friendly error.
- Works on **web** (the verification target) and is written to also work on native.
- `tsc` + `expo lint` pass; verified on web (pick → preview → upload → success;
  the object is visible in the Supabase Storage browser under the user's folder).

## Non-goals
- **No AI / `analyze-meal` call** — piece 2. This screen never touches Gemini.
- **No `meal_logs` / `meal_items` write** — piece 3 links a stored path to a row.
  (Piece-1 uploads are therefore "orphan" objects with no DB row — see edge cases.)
- **No editing/cropping pipeline beyond the picker's built-in** `allowsEditing`.
- **No migration / no new bucket / no RLS change** — `meal-photos` (private, 10 MB,
  `image/jpeg`+`image/png`) and its per-user-folder policies already exist (plan 0001).
- **No gallery / list of past uploads**, no delete UI, no offline queue.
- **No changes to shared code** (`src/lib`, `src/shared/ui`, `src/types`) beyond the
  established tab-bar registration pattern (see Open questions OQ1).

## Proposed approach

### Module layout (mirrors the S1 flat-feature pattern, but under `capture/`)
- `src/features/capture/screens/capture-screen.tsx` — the screen (pick/preview/upload).
- `src/features/capture/lib/pick-photo.ts` — thin wrappers over `expo-image-picker`
  (`takePhoto()` / `pickFromLibrary()`) that request permission, launch the picker,
  and normalize the result to `PickedPhoto | null` (`{ uri, mimeType, width, height }`).
  Returns a small typed outcome so the screen can show the right copy on denial/cancel.
- `src/features/capture/lib/upload-meal-photo.ts` — `uploadMealPhoto({ userId, photo })`:
  resolves the file bytes and uploads to Storage; returns `{ path }` on success or a
  typed error. **No logging of the uri or bytes** (PII discipline, mirrors S1 SF4).
- `src/app/(app)/capture.tsx` — thin route → `<CaptureScreen/>`.

### The dependency
`expo-image-picker` is **not yet installed**. Add it with `npx expo install
expo-image-picker` (SDK-56-pinned). It supports **Android, iOS, and web**. Its config
plugin supplies the iOS permission strings — add to `app.json` `plugins`:
```jsonc
["expo-image-picker", {
  "photosPermission": "Calorie Counter needs access to your photos so you can add a meal picture.",
  "cameraPermission": "Calorie Counter needs camera access so you can snap a meal."
}]
```

### Picking (SDK 56 API — verified against docs/v56)
`expo-image-picker` exposes `launchCameraAsync(options)` and
`launchImageLibraryAsync(options)`. SDK 56 uses **`mediaTypes: ['images']`** (string
array — the old `MediaTypeOptions` enum is gone). Options we pass:
- `mediaTypes: ['images']`, `allowsEditing: true`, `quality: 0.7` (compress to keep
  uploads well under the 10 MB cap and re-encode predictably).
- Permissions: `requestCameraPermissionsAsync()` before camera;
  `requestMediaLibraryPermissionsAsync()` before library (web auto-grants; the system
  photo picker on modern iOS often needs no prompt but we request defensively).
- Result: `{ canceled: boolean, assets: [{ uri, mimeType, width, height, fileName, ... }] }`.
  We read `assets[0]`. On `canceled` we no-op (no error copy).

### Uploading (cross-platform, smallest viable)
Path: **`${userId}/${Date.now()}.jpg`** — the first folder segment **must** be the
user id (the RLS policy checks `(storage.foldername(name))[1] = auth.uid()`).
Primary method (no extra dep, reliable on the web target):
```ts
const res = await fetch(photo.uri);
const bytes = await res.arrayBuffer();
const contentType = photo.mimeType ?? 'image/jpeg';
const { data, error } = await supabase
  .storage.from('meal-photos')
  .upload(path, bytes, { contentType, upsert: false });
```
Return `data.path` (or the constructed path) on success. The screen keeps it in local
state for piece 2; piece 1 just proves the round-trip. (Optional verification nicety:
`createSignedUrl(path, 60)` and render it to prove the bytes actually landed — see
Test plan; not required for the feature.)

> **Native byte-loading risk (see OQ2):** `fetch(fileUri).arrayBuffer()` is reliable
> on web and on current RN/Expo for `file://` and `content://` uris, but has a history
> of flakiness on some Android builds. If native upload yields a 0-byte / corrupt
> object during verification, the documented fallback is the Supabase-recommended
> path: pick with `base64: true` and `decode()` via the tiny `base64-arraybuffer`
> dep. We start without it (web is the verify target) and only add it if native fails.

### Entry point — a fourth `(app)` tab "Capture" (OQ1)
Consistent with how the Profile tab was added (plan 0006): add a `Capture` trigger to
**both** tab bars and a thin route.
- `src/components/app-tabs.tsx` (native) — needs a PNG icon at
  `assets/images/tabIcons/capture{,@2x,@3x}.png` (copy an existing set as a
  **placeholder**, real art later — same call as plan 0006 SF7).
- `src/components/app-tabs.web.tsx` — text trigger with `href="/capture"`.

## Files to change
- `src/features/capture/screens/capture-screen.tsx` — NEW: pick/preview/upload UI.
- `src/features/capture/lib/pick-photo.ts` — NEW: permissioned picker wrappers.
- `src/features/capture/lib/upload-meal-photo.ts` — NEW: Storage upload helper.
- `src/app/(app)/capture.tsx` — NEW: thin route → `<CaptureScreen/>`.
- `src/components/app-tabs.tsx` — add the Capture native tab (+ icon `require`).
- `src/components/app-tabs.web.tsx` — add the Capture web tab (`href="/capture"`).
- `assets/images/tabIcons/capture{,@2x,@3x}.png` — NEW: placeholder tab icon.
- `app.json` — add the `expo-image-picker` config plugin (iOS permission strings).
- `package.json` / `package-lock.json` — add `expo-image-picker` via `expo install`.
- `.expo/types/router.d.ts` — regenerates for the new `/capture` route (expected churn,
  not hand-edited; run the dev server once like plan 0006).

## Data model / schema impact
**None.** The `meal-photos` bucket (private; 10 MB; `image/jpeg`,`image/png`) and its
RLS policies (`meal_photos_select/insert/update/delete`, each gated on
`(storage.foldername(name))[1] = auth.uid()::text`) already exist from plan 0001. No
tables, columns, buckets, or policies change. `meal_logs`/`meal_items` are untouched
(piece 3).

## Edge cases & failure modes
- **Permission denied** (camera or library, native) → friendly per-source copy with a
  hint to enable it in Settings; no crash, no upload attempt.
- **User cancels the picker** → silent no-op (not an error state).
- **Signed out / no `user.id`** → block upload with "Please sign in again" (mirrors S1
  N6/N5); never build a path without the real uid (RLS would reject it anyway).
- **Huge image** → `quality: 0.7` shrinks it; if the bucket still rejects >10 MB, the
  upload error surfaces as friendly copy ("That photo is too large — try another").
- **Wrong mime type** — the bucket allows only `image/jpeg`/`image/png`. iOS can hand
  back **HEIC**; `allowsEditing`+`quality` usually re-encodes to JPEG, but this is not
  guaranteed → see OQ3. On a mime rejection, show "Unsupported image format."
- **Offline / upload fails** → friendly error; keep the preview so the user can retry;
  `upsert:false` + a fresh timestamped name means a retry never overwrites or dups
  destructively (a new object each attempt — orphan cleanup is piece 3's concern).
- **Native 0-byte upload** (the `arrayBuffer` risk, OQ2) → caught during verification;
  documented base64 fallback.
- **Orphan objects** — piece-1 uploads have no `meal_logs` row. Acceptable for now;
  note it so piece 3 (which writes the row) owns the path→row link and any later
  cleanup of unreferenced objects. Don't build cleanup here.
- **Double-tap Upload** → the shared `Button` in-flight guard + a local `uploading`
  flag; mounted-ref guards post-`await` setState (sign-out can unmount mid-upload).
- **Web camera** — `launchCameraAsync` on web falls back to a file/capture input; treat
  it the same as library. No native permission prompt on web.

## Test / verify plan
- `npx tsc --noEmit` clean (new `/capture` route regenerates typed routes — expect the
  one-build churn from the piece-1/2 lesson; run the dev server once to regenerate).
- `npx expo lint` clean (watch the project's two rules: no ref read in render, no
  setState synchronously in an effect — same gotchas as plan 0006).
- **Manual on web** (signed-in test user):
  1. Open the **Capture** tab → see Take photo / Choose from library.
  2. Choose an image → it previews.
  3. Upload → success state shows the returned `meal-photos/{uid}/…` path.
  4. In the **Supabase Storage** browser, confirm the object exists **under the
     user's own folder** and nowhere else; confirm another user can't read it (RLS).
  5. Cancel the picker → no error. Pick a non-image / oversized file → friendly error.
  6. (Optional) render a 60 s signed URL of the uploaded path to confirm the bytes.
- **Native smoke (if a device/simulator is handy):** permission prompt appears; deny →
  graceful copy; allow → pick → upload succeeds and the object is non-zero bytes
  (validates the OQ2 byte-loading path; if it fails, apply the base64 fallback).

## Rollout
1. Review this plan (`/review-plan`); resolve blockers before coding.
2. `npx expo install expo-image-picker`; add its config plugin + permission strings to
   `app.json`.
3. Build in order: `pick-photo` → `upload-meal-photo` → `capture-screen` → route → both
   tab bars (+ placeholder icon). Regenerate typed routes (dev server once).
4. Verify per above (web first). Append `docs/JOURNAL.md`; mark Done; **commit straight
   to `main`** and push. Next: piece 2 (`analyze-meal` Edge Function).

## Open questions — all resolved during review (2026-06-21)
1. **Entry point → a 4th "Capture" tab + placeholder icon.** ✅ Consistent with the Profile
   tab (plan 0006) and discoverable; a FAB/center-action is a later UX nicety. (OQ1.)
2. **Native byte-loading → `fetch().arrayBuffer()` + a 0-byte guard now; base64 fallback as a
   named follow-up.** ✅ Web is the Done gate; if a device shows 0-byte/corrupt uploads, switch
   to `base64:true` + `base64-arraybuffer` `decode()` branched by `Platform.OS`. (B2.)
3. **JPEG/PNG guarantee → client-side reject any non-jpeg/png mime before upload; extension
   derived from the resolved mime.** ✅ `expo-image-manipulator` HEIC re-encode is deferred to
   native hardening; the reject is the guard so nothing mislabeled lands. (B1.)
4. **Keep the uploaded `path` durable in piece 1 → no.** ✅ Screen state only; piece 3 persists
   the bucket-relative `data.path` on `meal_logs.image_path` (SF1). Orphans out of scope here.
5. **Replace the template "Explore" tab → no.** ✅ Leave Explore; the app knowingly ships a 4th
   vestigial tab until a trivial later cleanup. (N2.)
6. **Storage lifecycle / privacy (raised by review SF9) → tracked obligations for a later piece,
   not built here.** ✅ (a) a scheduled job deleting `meal-photos` objects with no matching
   `meal_logs.image_path` older than N hours; (b) account/meal deletion must also delete Storage
   objects (the `auth.users` cascade does NOT touch Storage); (c) the privacy policy must mention
   photo storage. Logged so the data accruing from this piece has an owned cleanup story.

---

## Review
_Multi-agent review (4 lenses: correctness, architecture, edge cases, data/privacy),
2026-06-21. Consolidated & deduped._

**Verdict: NEEDS CHANGES → 3 blockers** (architecture & data lenses found none; correctness
found 1, edge-cases found 2). All three are about the upload path's robustness on real
images. Resolutions applied in-approach below + the new **"Review resolutions"** subsection;
all 5 open questions decided. Re-review not required (no scope change, only hardening).

### BLOCKER
- **B1 — Guarantee `image/jpeg`/`image/png` + a correct `contentType`/extension (iOS HEIC).**
  (Correctness #4, Edge #2/#4.) The bucket allowlist is `image/jpeg`,`image/png` only. iOS can
  return HEIC bytes and/or a `mimeType` of `image/heic`/`undefined`; sending `mimeType ??
  'image/jpeg'` either gets rejected at insert (heic) or stores bytes whose declared type lies
  (poisoning piece 2's Gemini call), and the hardcoded `.jpg` extension can mislabel a PNG.
  **Resolution:** the upload helper **rejects client-side** any resolved mime not in
  `{image/jpeg,image/png}` with friendly copy ("Unsupported image format — use JPEG or PNG")
  **before** calling `.upload()`; the stored extension is **derived from the resolved mime**
  (`.jpg`/`.png`), never hardcoded. iOS HEIC normalization (re-encode to JPEG via
  `expo-image-manipulator`) is **deferred to native hardening** (web/Android send JPEG/PNG);
  the client-side reject is the guard so nothing mislabeled ever lands.
- **B2 — Don't ship an unverified, known-fragile native byte path; add a 0-byte guard.**
  (Correctness #1, Edge #6.) `fetch(uri).arrayBuffer()` is reliable on the web target but flaky
  on some Android builds (0-byte/corrupt), and the plan let "Done" be reached with native never
  exercised. **Resolution:** (a) after loading bytes, **assert `byteLength > 0` regardless of
  platform** and fail loudly with friendly copy instead of creating a 0-byte orphan; (b) "Done"
  is gated on **web verification only** (explicitly), and native byte-loading is a **named,
  tracked follow-up** — if a device shows 0-byte/corrupt uploads, adopt the Supabase-recommended
  `base64:true` + `base64-arraybuffer` `decode()` path, branched by `Platform.OS`. We do not
  pre-add the dep (Arch N4) but the byte-guard makes the failure safe even unverified.
- **B3 — Retry semantics: distinguish permanent from transient failures.** (Edge #1/#8.) A
  mime/size/RLS rejection is deterministic; "keep the preview so the user can retry" traps the
  user re-uploading identical bytes that can never succeed. **Resolution:** the helper returns a
  **typed error kind** (`too_large` | `unsupported` | `unauthorized` | `network` | `unknown`);
  the screen offers a **bare retry only for transient kinds** (`network`/`unknown`/5xx) and for
  permanent kinds tells the user what to change ("pick a smaller photo", "use JPEG/PNG", "sign in
  again"). `401/403/PGRST301` map to "session expired" reusing the S1 `saveErrorMessage` shape.

### SHOULD-FIX
- **SF1 — Pin `data.path` (bucket-relative) vs `data.fullPath`.** (Correctness #2.) On success
  `data.path` is the object key *without* the bucket (`{uid}/123.jpg`); `data.fullPath` includes
  it. Persist the **bucket-relative `data.path`** (what `createSignedUrl`/`download` expect);
  use `fullPath` only for display. Piece 3 stores `data.path` on `meal_logs.image_path`.
- **SF2 — Derive the uid from the session inside the helper, don't take it as a param.**
  (Data #1/#2, Correctness affirm.) `uploadMealPhoto({ photo })` reads `supabase.auth.getUser()`
  (or the passed `useUser()` value asserted against the session) and **hard-fails if the uid is
  falsy / not a uuid** before building the path — RLS already blocks a wrong uid, but this kills
  the foot-gun and the silent generic error.
- **SF3 — Collision-proof filename + mime-matched extension.** (Edge #3/#4, Data #4.) Replace
  `${Date.now()}.jpg` with `${crypto.randomUUID()}.<ext>` (or `${Date.now()}-${rand}`) where
  `<ext>` comes from the resolved mime (B1), so two uploads in the same ms can't 409 under
  `upsert:false`.
- **SF4 — Typed, sanitized errors; reuse the S1 error mapping; no PII in logs.** (Arch SF1,
  Edge #8, Data #6.) The helper never logs the uri/path/bytes/signed-URL; it returns the typed
  kind (B3). The `401/403/PGRST301`→"session expired" branch matches `settings-screen.tsx`'s
  `saveErrorMessage` (factor a tiny shared mapper or mirror it) so capture & settings speak with
  one voice.
- **SF5 — Picker returns a discriminated union, and iOS "limited" counts as usable.**
  (Arch SF3, Edge #5.) `pickPhoto` returns `{status:'ok',photo} | {status:'cancelled'} |
  {status:'denied',source}` (not `PickedPhoto|null`) so the screen shows the right copy without
  re-deriving intent. Treat library permission `granted` **and** `limited` as usable; only
  true-denied shows the Settings hint.
- **SF6 — `quality:0.7` is best-effort, not the size guard.** (Correctness #3.) A library pick can
  return original bytes untouched; check `assets[0].fileSize` (when present) and reject early with
  friendly copy, and treat the bucket's server-side 10 MB rejection as the real guard. Downgrade
  the plan's "compress to keep under 10 MB" claim accordingly.
- **SF7 — Upload timeout for slow/stalled networks.** (Edge #7.) Wrap the upload in an
  `AbortController` with a ~30–60 s timeout; a stall surfaces "taking too long" + retry
  (transient, per B3) instead of an infinite spinner.
- **SF8 — The mounted-ref guard lives locally in `capture-screen.tsx`.** (Arch SF2.) There's no
  `use-profile`-style hook in `capture/` to copy it from; the screen owns the 6-line `mounted`
  ref pattern from `settings-screen.tsx` for post-`await` setState (sign-out mid-upload).
- **SF9 — Orphan cleanup + deletion + privacy are TRACKED obligations, not just comments.**
  (Data #3/#8.) Every failed/abandoned upload leaves a real object with no row and no TTL/quota —
  unbounded health-data retention + cost. Flag concretely for a later piece: (a) a scheduled
  delete of `meal-photos` objects with no matching `meal_logs.image_path` older than N hours;
  (b) account/meal deletion must also delete Storage objects (the `auth.users` cascade does NOT
  touch Storage); (c) the privacy policy must mention photo storage. Not built here, but owned.
- **SF10 — If a signed URL is used (preview/verify), keep TTL short; never `getPublicUrl`.**
  (Data #5.) Meal photos are health data; a signed URL is a shareable unauthenticated handle —
  TTL ≤ a few minutes, never logged, never persisted, and never use `getPublicUrl` on this
  private bucket.

### NIT
- **N1 — The local `uploading` flag's only job is to feed `Button loading`/disabled** (the
  in-flight double-tap guard already lives in `Button`); don't build a second guard. (Arch N1.)
- **N2 — Shipping a 4th tab leaves the vestigial template "Explore" tab visible** (Home / Explore
  / Capture / Profile). Deliberate deferral, not an oversight; a later cleanup removes Explore. (Arch N2, OQ5.)
- **N3 — EXIF/orientation:** `allowsEditing` usually bakes orientation into the re-encode; if
  `expo-image-manipulator` is later adopted (B1 native), confirm it normalizes orientation so
  piece 2 / previews aren't sideways. (Edge #10.)
- **N4 — Web "Take photo" on a desktop without a camera** opens a confusing file dialog; consider
  hiding/relabeling it on web, or accept as known. (Edge #11.)
- **N5 — Affirmations (no change):** SDK 56 `mediaTypes:['images']` is correct; the RLS path
  `${uid}/<name>` satisfies `(storage.foldername(name))[1]=auth.uid()`; the two-lib split and the
  Capture-tab entry are the right shape; don't pre-add `base64-arraybuffer`/`expo-image-manipulator`.
  (Correctness #5/#6, Arch N3/N4, Data #4/#7.)

### Review resolutions (folded into the approach)
- **Upload helper contract (resolves B1/B3/SF1/SF2/SF3/SF4/SF6/SF7):** `uploadMealPhoto({ photo
  })` → reads uid from the session (SF2); validates resolved mime ∈ {jpeg,png} and `fileSize`
  (B1/SF6); builds `${uid}/${randomUUID}.<ext>` (SF3); loads bytes and **asserts `byteLength>0`**
  (B2); uploads with `{ contentType, upsert:false }` under an `AbortController` timeout (SF7);
  returns `{ ok:true, path: data.path }` (SF1) or `{ ok:false, kind }` (B3/SF4) — never logging
  any uri/path/bytes/url.
- **Picker contract (resolves SF5):** `pickPhoto(source)` returns the discriminated union; the
  screen maps `cancelled`→no-op, `denied`→Settings hint, `ok`→preview. `limited`==usable.
- **Native byte-loading (B2):** ship `fetch().arrayBuffer()` + 0-byte guard; **named follow-up**
  to verify on a device and switch to base64 decode if it fails. Web is the Done gate.
- **Lifecycle/privacy (SF9):** added as tracked obligations for a later piece (cleanup job,
  delete-cascade-to-Storage, privacy-policy line) — see Open questions OQ6.

## Execution log
_Executed 2026-06-22 (session 8). Built strictly in the planned order; `tsc` + `expo
lint` clean; web bundle compiles with the screen, both helpers, and `expo-image-picker`
all included. **Web click-through verification is pending the user** (signed-in session +
Supabase Storage browser) — same gate-then-confirm flow as plan 0006._

**What was built (all per plan):**
- `npx expo install expo-image-picker` (SDK-56 compatible) + its config plugin with the
  iOS permission strings added to `app.json`.
- `pick-photo.ts` — `takePhoto()`/`pickFromLibrary()` returning the discriminated union
  (`ok`/`cancelled`/`denied`), `mediaTypes:['images']`, `limited` access counts as usable.
- `upload-meal-photo.ts` — `uploadMealPhoto({ photo })`: uid from session + uuid hard-fail
  (SF2); jpeg/png mime allowlist with mime-derived extension (B1); `fileSize` pre-check
  (SF6); `${uid}/${Date.now()}-${rand}.<ext>` path (SF3); `byteLength>0` guard (B2); typed
  error `kind` (B3); no uri/path/bytes logged (SF4).
- `capture-screen.tsx` — pick → preview (`expo-image`) → upload; transient-only Retry (B3);
  local `mounted` ref (SF8); per-source denial hints.
- `(app)/capture.tsx` route + Capture tab in **both** tab bars + placeholder `capture*.png`
  icon (copied from `explore`); typed routes regenerated (dev server once).

**Deviations from the plan (WORKFLOW step 3):**
- **SF7 — AbortController → timeout race.** The plan specified wrapping the upload in an
  `AbortController` with a ~45 s timeout. The installed `@supabase/storage-js` (hoisted under
  `supabase-js ^2.108.1`) exposes `signal` only on `FetchParameters` (download/list), **not on
  the `upload()` `FileOptions`** — so `upload` cannot be aborted via a signal in this version
  (`tsc` rejected `{ signal }`). Implemented SF7's *intent* instead: race the upload against a
  45 s timer (`withTimeout`) so a stall surfaces as a transient `network` error (no infinite
  spinner) and the screen offers Retry. The in-flight request isn't truly cancelled (a timed-out
  upload may still land an object — already covered by the SF9 orphan-cleanup obligation). No
  scope/behaviour change beyond the abort mechanism; no re-review needed.
- **Filename:** used `${Date.now()}-${rand}` (the plan's named SF3 alternative) rather than
  `crypto.randomUUID()`, since no UUID dependency is installed and `crypto.randomUUID` isn't
  available on RN/Hermes — avoids adding a dep, equally collision-proof.

**Verification result:** `npx tsc --noEmit` ✅ · `npx expo lint` ✅ (exit 0) · web bundle builds
✅ · **web click-through PASSED (2026-06-22, user-confirmed)** — pick → preview → upload → the
object landed under the user's own `meal-photos/{uid}/…` folder in the Storage browser; cancel
and bad/oversized paths showed friendly copy. **Plan Done.** Still deferred (not blocking Done):
iPhone real-camera "Take photo" + the native byte path (B2/OQ2), and the N4 web "Take photo"
relabel — tracked in memory `capture-deferred-camera-test`.
