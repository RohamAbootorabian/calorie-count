# Plan: Merge Upload into a single "Analyze meal" button

- **Status**: ~~Draft~~ → ~~In Review~~ → **Approved** → In Progress → Done
- **Created**: 2026-09-13
- **Plan #**: 0029

## Problem / Goal
Today the capture flow is two manual taps: **Upload** (photo → private Storage) then
**Analyze meal** (Edge Function → OpenAI). Users expect one action. Remove the separate
**Upload** button; from the moment a photo is picked, show the note field + a single
**Analyze meal** button that performs the upload **and** the analysis in one tap.

"Done" concretely:
- After picking/taking a photo, the user sees Preview + the optional note + **Analyze meal**
  (no "Upload" / "Uploaded ✓" step).
- Tapping **Analyze meal** uploads the photo (if not already uploaded) and then analyzes it,
  showing a single loading state.
- All existing safety invariants are preserved: no duplicate OpenAI charge, no duplicate
  upload, orphaned-photo abandon-delete still works, the re-pick race guard still holds,
  and upload-vs-analyze errors are still distinguishable with correct retry semantics.

## Non-goals
- No change to `uploadMealPhoto`, `analyzeMeal`, the Edge Function, or storage layout.
- No change to `MealReview`, the note model (plan 0020), or the manual-date field (plan 0028).
- Not auto-starting analysis on pick (the user still taps once, deliberately — it costs money).
- No web-specific work beyond what already compiles (capture screen is shared).

## Proposed approach
Keep the two underlying helpers (`uploadMealPhoto`, `analyzeMeal`) and both typed error
channels. Merge only the **UI + orchestration** in `capture-screen.tsx`:

1. **Show the note + Analyze UI as soon as a photo exists** (not gated on `uploadedPath`).
   Remove the `uploadedPath ?`-vs-`Upload` branch. The note `Input`, analyze error line,
   and the primary button render whenever `photo && !analysis`.

2. **One orchestrator `handleAnalyzeMeal()`** that:
   - Guards: `if (!photo || uploading || analyzing) return;`
   - **Upload step (only if needed):** if `uploadedPath` is null, set `uploading`, call
     `uploadMealPhoto`; on failure show the upload error (retryable per kind) and STOP —
     do not touch analyze state or attempt count. On success set `uploadedPath` +
     `currentPath.current` and clear `uploading`. If `uploadedPath` already exists (a prior
     analyze failed after a successful upload), **skip upload** → no duplicate storage object,
     no duplicate charge risk on that side.
   - **Analyze step:** run the existing analyze logic against the resolved `path`
     (bounded attempts, `currentPath` race guard, note handling, terminal hint) unchanged.

3. **Single button label/loading.** `loading={uploading || analyzing}`. Label:
   - default → `Analyze meal`
   - after an analyze failure that's retryable → `Retry analysis`
   - after an upload failure that's retryable → `Retry`
   Disable "Choose another" while `uploading || analyzing`.

4. **Error display.** Show whichever error is set. Upload errors keep `errorMessage`/`canRetry`;
   analyze errors keep `analyzeError`/`analyzeCanRetry`. Because the note+button now render
   pre-upload, the upload error must render in the SAME block (currently it lives in the old
   `else` branch). Consolidate into one error `<Text>` that prefers `analyzeError ?? errorMessage`.

5. **Note editability during upload too:** `editable={!analyzing && !uploading}`.

### Invariant preservation (explicit)
- **No double charge:** analyze still guarded by `analyzing` + `currentPath` race check.
- **No duplicate upload:** upload runs only when `uploadedPath == null`; a failed-analyze
  retry reuses the existing path.
- **Abandon-delete:** `applyPickOutcome` / `chooseAnother` still call `maybeDeleteAbandoned`
  and reset `uploadedPath` + `currentPath`; unchanged.
- **Re-pick race:** `applyPickOutcome` still nulls `uploadedPath`/`currentPath` and
  `resetAnalyze()`; a late analyze result is dropped by the `currentPath.current !== path` check.
- **Upload-error retry** re-uploads (path still null); **analyze-error retry** does not.

## Files to change
- `src/features/capture/screens/capture-screen.tsx` — merge `handleUpload` + `handleAnalyze`
  into `handleAnalyzeMeal`; collapse the `uploadedPath ? … : …` render branches into one
  note+button block; single loading/label/error. Delete the now-unused `handleUpload` and the
  "Uploaded ✓" text. Header copy: "…then analyze it." stays accurate.

## Data model / schema impact
None.

## Edge cases & failure modes
- **Upload fails (network/too_large/unsupported/unauthorized):** show upload copy; button
  becomes `Retry` for retryable kinds; analyze never runs; attempt count untouched.
- **Upload ok, analyze fails:** `uploadedPath` set; retry re-analyzes only (no re-upload);
  bounded to `MAX_ANALYZE_ATTEMPTS`; terminal hint still points at the note when one was sent.
- **Re-pick mid-flight:** prior in-flight upload/analyze result ignored (mounted + currentPath
  guards); prior uploaded-but-abandoned photo delete-swept.
- **Sign-out mid-call:** `mounted` ref guards every post-await setState (unchanged).
- **Double-tap Analyze:** `uploading || analyzing` guard makes the second tap a no-op.
- **Successful upload then user taps "Choose another":** abandon-delete fires (path ≠ savedPath).

## Test / verify plan
- `npx tsc --noEmit` → 0; `npx expo lint` → 0; `npx expo export --platform web` succeeds.
- Manual (device / Expo):
  1. Pick a photo → note + **Analyze meal** show immediately (no Upload button/"Uploaded ✓").
  2. Tap **Analyze meal** → single spinner → review card appears.
  3. Force an analyze failure (e.g. airplane mode after upload) → **Retry analysis** re-analyzes
     without re-uploading (verify only one object in Storage for that attempt).
  4. Force an upload failure (airplane mode before tapping) → **Retry** re-uploads.
  5. "Choose another" after a successful upload but before save → old photo removed (abandon sweep).

## Rollout
Pure client change. No migration, secret, or deploy. Commit to `main`; user reloads (JS-only).

## Open questions
None — helpers and error taxonomy are unchanged; only the UI/orchestration merges.

---

## Review
Four-agent review (correctness, architecture, edge-cases, data/privacy). Consolidated &
deduped. **Verdict: NEEDS CHANGES → resolved (2 blockers cleared) → APPROVED.**

### BLOCKER (resolved)
- **B1 — Merged upload step must NOT wipe the note.** The note now renders *before* upload,
  so a carried-over `resetAnalyze()` (`setNote('')`) in the upload step would send an empty
  note to OpenAI and seed an empty review (silent data loss). *(correctness + edge-cases)*
  → **Resolved:** `handleAnalyzeMeal` snapshots `trimmedNote` at entry, calls `resetAnalyze()`
  **nowhere**; reset stays only in `applyPickOutcome` (fresh pick) and `chooseAnother`.
- **B2 — Double first-tap → two uploads + two OpenAI charges.** The `status`/state guard is
  async; a re-entry before commit could double-fire the (now upload+analyze) handler. *(edge-cases)*
  → **Resolved:** a synchronous `inFlight` ref gates the top of `handleAnalyzeMeal`, cleared in
  `finally`. Paid-spend invariant holds regardless of render timing.

### SHOULD-FIX (resolved)
- **Analyze must use the local resolved `path` (`result.path`), never the async `uploadedPath`
  state**, in the same tick — else analyze runs with a null path. → resolved (`let path = uploadedPath; … path = result.path`).
- **`mounted` guard after the upload await too** (sign-out between upload & analyze → wasted
  charge). → resolved (guard after both awaits).
- **Analyze-only retry must NOT reset `analyzeAttempts`** or the 3-attempt cap never terminates
  (unbounded spend). → resolved (attempts only zeroed on fresh pick; handler only clears
  `error`). Plus an explicit guard: once `uploadedPath && analyzeAttempts >= MAX`, the handler
  no-ops (re-pick required).
- **Unify state to a single `status` enum (`idle|uploading|analyzing`) + a single `error`
  channel (`{message,canRetry,phase}`)** instead of doubled `uploading/analyzing` +
  `errorMessage/analyzeError`. Kills the `analyzeError ?? errorMessage` precedence hack and every
  stale-error path. *(architecture)* → adopted.
- **Phase-specific labels with explicit precedence:** `error.phase==='upload' && canRetry →
  "Retry upload"`, `error.phase==='analyze' && canRetry → "Retry analysis"`, else `"Analyze
  meal"`; **disable the primary button on a non-retryable error** so a dead-end tap can't loop
  a doomed upload/analyze — steer to "Choose another". → adopted.

### NIT (addressed)
- "Choose another" `disabled={busy}` (combined, not one branch's flag). → done.
- Loading label communicates phase: `Uploading…` / `Analyzing…`. → done.
- Stale comments: header two-step wording → one tap; `Gemini` → `OpenAI` in code comments;
  point-of-processing note reworded. → done.
- Do NOT manually `useCallback`/`useMemo` the handler (React Compiler is ON). → done.
- Upload-success photo-identity: re-pick mid-flight is already impossible (all pick / "Choose
  another" buttons `disabled={busy}` + `inFlight` ref), and analyze keeps its `currentPath`
  stale-result drop — no extra token needed.

## Execution log
Implemented exactly per the resolved plan (single `status` enum + single `error` channel +
`inFlight` ref).

- **`src/features/capture/screens/capture-screen.tsx`** — replaced `uploading`/`analyzing`
  booleans + `errorMessage`/`canRetry`/`analyzeError`/`analyzeCanRetry` with `status` +
  `error`; merged `handleUpload`+`handleAnalyze` into one `handleAnalyzeMeal` (inFlight gate,
  snapshot note, upload-only-if-needed, local `path`, mounted guard after both awaits, attempts
  never reset in-handler, bounded-spend no-op guard); collapsed the two render branches into one
  note+button block; phase-specific labels + phase loading text + non-retryable disable;
  refreshed the header/privacy comments (Gemini→OpenAI, one-tap).
- **Verify:** `npx tsc --noEmit` → 0 · `npx expo lint` → 0 · `npx expo export --platform web` → success.
- No deviation from the resolved plan.
