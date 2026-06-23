# Plan: Orphan meal-photo cleanup — client delete-on-abandon + scheduled server sweep

- **Status**: **NEEDS CHANGES** (2026-06-24) — multi-agent review found **4 blockers** (client guard
  fails open on unmount; sweep deletes whole bucket on a degraded read; secret leaks into
  `cron.job`/`pg_net`; Layer-2 infra justify/simplify). Resolutions are specified in `## Review` and
  must be **folded into the approach before execution**; the Layer-2 safety redesign (fail-closed +
  circuit-breaker + dry-run + secret-as-subquery) should be re-confirmed at the start of execution.
  Not yet executed.
- **Created**: 2026-06-24
- **Plan #**: 0011

## Problem / Goal
A meal photo is uploaded to the private `meal-photos/{uid}/…` bucket **before** the user saves
(plan 0007 upload → 0008 analyze → 0009 save). If the user re-picks, taps **Choose another**, force-
closes, or signs out without saving, that Storage object becomes an **orphan**: it is never referenced
by any `meal_logs.image_path` and lingers in Storage forever. This is the tracked **0007 SF9** storage-
lifecycle obligation, and it's now real user health data (food photos) accumulating with no lifecycle.

**Goal (user chose "both"):** stop orphans at the source with a **client-side delete-on-abandon**, and
guarantee eventual cleanup of the cases the client can't catch (force-close / crash / sign-out) with a
**scheduled server-side sweep** that deletes only photos that are (a) not referenced by any `meal_logs`
row and (b) older than a grace period (so in-progress reviews are never nuked).

**Done looks like:**
- When a user abandons an **unsaved** uploaded photo (re-pick, Choose another, or re-upload a
  replacement), the prior object is best-effort deleted from Storage immediately. A **saved** photo is
  **never** deleted by this path.
- A scheduled `cleanup-orphans` Edge Function runs daily, lists `meal-photos` objects, removes those
  with no matching `meal_logs.image_path` AND `created_at` older than `GRACE_PERIOD` (24 h), using the
  service role; it never touches a saved or recent photo.
- Verified: re-pick/Choose-another deletes the orphan (confirmed gone in Storage) while a saved photo
  survives; the sweep, invoked manually with the secret, deletes a planted old orphan and leaves a
  saved photo + a recent orphan untouched.

## Non-goals
- **No user-facing "delete this meal"** or account-deletion flow (separate obligation; the privacy
  policy routes deletion through email until it ships). This plan cleans up **unsaved** orphans only —
  it does **not** delete photos belonging to saved meals.
- **No retroactive UI** showing storage usage, no "trash" / undo, no soft-delete.
- **No change to the upload path/naming, the bucket, or RLS policies** (owner-scoped policies already
  allow a user to delete their own object; the sweep uses the service role).
- **No real-time/serverless trigger on app background** (RN lifecycle hooks for force-close are
  unreliable) — that gap is exactly what the scheduled sweep covers.
- **No deletion of the `storage.objects` row via raw SQL** — that would orphan the S3 blob; deletion
  must go through the Storage API (`.remove()`).

## Proposed approach

### Layer 1 — client delete-on-abandon (best-effort, no infra)
The orphan is born exactly at abandonment, so delete it there using the **existing owner-scoped
DELETE policy** (`storage.objects`: `(storage.foldername(name))[1] = auth.uid()::text`) — no service
role, no migration.

- **New** `src/features/capture/lib/delete-meal-photo.ts` — `deleteMealPhoto(path)`: a fire-and-forget
  `supabase.storage.from('meal-photos').remove([path])` wrapped so it **never throws and never blocks
  UX**; logs only a typed outcome (PII discipline — never the path). Returns `void`/a boolean; callers
  don't await-block the UI.
- **Edit** `src/features/capture/screens/capture-screen.tsx`:
  - **The critical guard (correctness):** `chooseAnother` is ALSO the post-save reset (it's passed as
    `onLogAnother` to `MealReview`). A **saved** photo's path is now in `meal_logs`, so deleting it on
    reset would destroy a real meal's photo. Track a **`savedPath` ref**; `MealReview` reports a
    successful save via a new **`onSaved(path)`** prop → the screen stores it. The abandon-delete helper
    deletes `uploadedPath` **only if** it's non-null AND `uploadedPath !== savedPath.current`.
  - Wire deletion into the three abandon transitions, each gated by the savedPath guard:
    1. **Fresh pick** (`applyPickOutcome`, when a new photo replaces a prior unsaved `uploadedPath`).
    2. **Choose another** (`chooseAnother`, when not a post-save reset).
    3. **Re-upload** (`handleUpload`, if a prior `uploadedPath` exists and is being replaced).
  - After firing a delete, clear `uploadedPath`/`currentPath` as today. Best-effort: if offline, the
    sweep is the backstop.
- **Edit** `src/features/capture/screens/meal-review.tsx`: add an optional `onSaved?: (path: string) =>
  void` prop; call `onSaved(imagePath)` when (and only when) a save resolves as success (including the
  idempotent `conflict`→already-saved case), so the parent records the path as **saved → don't delete**.

### Layer 2 — scheduled server sweep (the backstop)
A daily job that catches what the client misses. Two pieces:

1. **New Edge Function** `supabase/functions/cleanup-orphans/` (`index.ts` + reuse `_shared/cors.ts`):
   - **Not user-invoked:** `verify_jwt = false` in `config.toml`; instead it checks a shared secret
     header (`x-cleanup-secret` === `Deno.env.get('CLEANUP_SECRET')`) and returns 401 otherwise. (Avoids
     spreading the service-role key as the auth token; the function still *uses* the service role
     internally.)
   - Builds a **service-role** client (`SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` from
     `Deno.env`) — bypasses RLS so it can see all users' objects + rows.
   - **Algorithm:** select the set of saved paths `select image_path from meal_logs where image_path is
     not null`; then for each top-level folder (uid) in `meal-photos` (`storage.list('')` → folders),
     `storage.list('{uid}')` the objects; an object is an orphan if its `'{uid}/{name}'` is **not** in
     the saved-paths set AND its `created_at` is older than `GRACE_PERIOD_HOURS` (24). Collect orphan
     paths and `storage.from('meal-photos').remove(orphanPaths)` in batches.
   - **PII/cost discipline:** log only **counts** (scanned / orphaned / deleted), never paths or uids.
     Page the storage `list` (it caps at 100 by default — pass `{ limit, offset }` and loop) so large
     buckets are fully covered; **log if a folder pages out** so silent truncation can't hide work.
   - Returns `{ ok: true, scanned, deleted }` (200) for observability when invoked manually.
2. **New migration** `supabase/migrations/<ts>_schedule_orphan_cleanup.sql`:
   - `create extension if not exists pg_cron;` + `create extension if not exists pg_net;`
   - `cron.schedule('cleanup-orphans-daily', '17 3 * * *', $$ select net.http_post( url :=
     '<FUNCTIONS_URL>/cleanup-orphans', headers := jsonb_build_object('Content-Type','application/json',
     'x-cleanup-secret', <secret>), body := '{}'::jsonb ) $$);` — the function URL + secret are read
     from **Vault** (`select decrypted_secret from vault.decrypted_secrets where name = …`) rather than
     hardcoded (the secret must not sit in plaintext migration SQL). The migration documents the two
     Vault entries it expects (`cleanup_fn_url`, `cleanup_secret`) and is idempotent
     (`cron.unschedule` first if exists).

### Why this shape
- Client layer = zero infra, kills the common-case orphan instantly using the policy that already
  exists. Server layer = the only thing that catches force-close/crash. Cross-referencing
  `meal_logs.image_path` + a grace window makes the sweep **inherently safe** (a saved or in-progress
  photo is never an orphan to it), so the dangerous "delete a real meal's photo" mistake can only come
  from the client path — which the `savedPath` guard closes.

## Files to change
- `src/features/capture/lib/delete-meal-photo.ts` — **NEW**: best-effort `deleteMealPhoto(path)`,
  never throws/blocks, logs only a typed outcome.
- `src/features/capture/screens/capture-screen.tsx` — **EDIT**: `savedPath` ref; gated delete on
  fresh-pick / choose-another / re-upload; pass `onSaved` to `MealReview`.
- `src/features/capture/screens/meal-review.tsx` — **EDIT**: optional `onSaved?(path)` called on save
  success (incl. idempotent conflict).
- `supabase/functions/cleanup-orphans/index.ts` — **NEW**: secret-gated, service-role list+remove sweep,
  paged, count-only logging.
- `supabase/config.toml` — **EDIT**: `[functions.cleanup-orphans] verify_jwt = false`.
- `supabase/migrations/<ts>_schedule_orphan_cleanup.sql` — **NEW**: `pg_cron` + `pg_net` extensions +
  an idempotent daily `cron.schedule` calling the function with the Vault-stored URL + secret.

## Data model / schema impact
- **No table/column/RLS changes.** `meal_logs.image_path` (UNIQUE, already set by `create_meal_log`)
  is the reference set; existing owner-scoped `storage.objects` policies already permit the client
  delete; the sweep uses the service role.
- **New extensions:** `pg_cron`, `pg_net` (both standard on Supabase hosted). **New secrets:**
  `CLEANUP_SECRET` (Edge secret) + Vault entries `cleanup_fn_url`, `cleanup_secret`, and the function's
  `SUPABASE_SERVICE_ROLE_KEY` (auto-present in the Edge runtime). No data migration.

## Edge cases & failure modes
- **Post-save reset must not delete the saved photo** (the headline risk) — closed by the `savedPath`
  guard + `onSaved` callback. Verify explicitly: save a meal → "Log another" → the saved photo still
  exists in Storage and the `meal_logs` row still points to it.
- **Idempotent conflict save** (B3 from 0009: same photo saved twice → returns existing id as success)
  — `onSaved` must fire here too, so a duplicate-but-successful save still marks the path saved.
- **Offline / delete fails on the client** — best-effort: swallow the error; the sweep is the backstop.
  Never surface a cleanup error to the user.
- **Sweep races an in-progress review** — the `GRACE_PERIOD_HOURS = 24` window means a freshly uploaded,
  not-yet-saved photo is never deleted mid-review. (A multi-hour review is implausible; 24 h is safe.)
- **Sign-out mid-flow** — client can't delete after the session is gone; the sweep catches it.
- **Storage `list` pagination** — default page size caps results; the function MUST page every uid
  folder to completion and log if any folder hits the cap, else orphans silently survive.
- **`net.http_post` failure / function down** — the cron row just logs a failed call; next day retries.
  No data risk (deletion is the only side effect; skipping a day only delays cleanup).
- **Secret missing/mismatch** — the function returns 401 and deletes nothing (fail-safe: a misconfigured
  sweep is a no-op, never a destructive one).
- **A user with zero meals** — folder exists with only orphans → all (older than grace) removed; fine.
- **Empty bucket / no orphans** — function returns `{deleted:0}`; cron is a cheap no-op.
- **Cost** — pure Storage list/remove + one Postgres select; no AI. Negligible. Log counts to confirm.

## Test / verify plan
- **Typecheck/lint:** `npx tsc --noEmit` clean; `npx expo lint` clean; `deno check` the new function.
- **Migration + function deploy:** `supabase db push` (extensions + cron); `supabase functions deploy
  cleanup-orphans`; set `CLEANUP_SECRET` + the Vault entries.
- **Client layer (web):**
  1. Pick + upload photo A → **Choose another** → A is gone from Storage (dashboard).
  2. Pick + upload A → re-pick B → upload B → **A gone, B present**.
  3. Pick + upload + analyze + **Save** → "Log another" → **the saved photo SURVIVES** and its
     `meal_logs` row still references it (the `savedPath` guard works).
- **Server sweep:**
  4. Plant an orphan: upload a photo, don't save, and (to bypass the 24 h grace for the test) either
     wait or temporarily set grace = 0 / backdate; invoke the function with the correct `x-cleanup-
     secret` → it deletes the planted orphan, leaves a saved photo and a fresh (<grace) orphan.
  5. Invoke with a wrong/missing secret → 401, nothing deleted.
- **Spot-check logs:** only counts, never paths/uids.

## Rollout
1. `/review-plan docs/plans/0011-orphan-photo-cleanup.md`; resolve blockers before coding.
2. Build the client layer (`delete-meal-photo.ts` + capture/meal-review edits) → typecheck/lint → web-
   verify cases 1–3 (these need no backend changes and de-risk the highest-risk guard early).
3. Build `cleanup-orphans` function + `config.toml`; `deno check`; `supabase functions deploy`; set
   `CLEANUP_SECRET` + `SUPABASE_SERVICE_ROLE_KEY` (already present) + Vault entries.
4. Write + `supabase db push` the `schedule_orphan_cleanup` migration (extensions + cron).
5. Verify cases 4–5 (manual invoke with/without secret); confirm the cron row exists
   (`select * from cron.job`).
6. Append `docs/JOURNAL.md`; mark this plan Done; **commit straight to `main`** and push. 0007 SF9 is
   then resolved (orphan lifecycle closed); the email-based account/meal deletion flow remains a
   separate obligation.

## Open questions
1. **Secret/auth between cron and the function.** Proposed: a dedicated `CLEANUP_SECRET` checked by the
   function (`verify_jwt=false`), with the secret + function URL stored in **Vault** for the cron SQL
   (so no plaintext secret in a migration). Acceptable, or prefer invoking with the service-role key as
   a bearer token directly? (Vault keeps the migration clean and rotation-friendly — recommended.)
2. **Grace period value.** `GRACE_PERIOD_HOURS = 24` proposed (generous; a review is minutes). Lower to
   6 h for faster cleanup, or keep 24 h for safety? (Recommend 24 h.)
3. **Schedule cadence.** Daily (`17 3 * * *` UTC, off-peak) proposed. Hourly is overkill at this volume.
4. **pg_cron / pg_net availability.** Standard on Supabase hosted; confirm they enable on this project's
   plan at `db push` time (if not, fall back to an external scheduler — e.g. a GitHub Action — hitting
   the same function; the function itself is unchanged).
5. **Does the client even need all three abandon hooks,** or is "delete the old path the moment a new
   upload succeeds" + "delete on Choose-another (unsaved)" enough? (Fresh-pick before any new upload
   already leaves the old `uploadedPath` deletable on the next transition — minor; the review can trim.)

---

## Review
_Multi-agent review (4 lenses: correctness, architecture, edge cases, data/privacy),
2026-06-24. Consolidated & deduped._

**Verdict: NEEDS CHANGES → 4 blockers.** The two-layer instinct is right and Layer 1 is well-sized,
but every real destructive path runs through the upload→save timing window (client) or a fail-OPEN
sweep (server), and Layer 2 stacks five first-of-their-kind infra primitives. **Resolutions are
specified below and folded into the approach (see `(resolves Bn)` markers); status is set to Approved
once these are applied — but given the depth, re-confirm the revised Layer-2 safety design at the start
of execution.**

### BLOCKER
- **B1 — The client `savedPath` guard fails open when the save resolves after unmount.** (Correctness +
  Edge.) `onSaved` is gated behind `meal-review.tsx`'s `if (!mounted.current) return;` AND `MealReview`
  is `key`ed by `uploadedPath`, so a sign-out / re-pick that unmounts the child *after the RPC commits
  but before the ack* never sets `savedPath` → a later abandon deletes a **genuinely saved** photo (the
  sweep can't recover it; the `meal_logs` row now points at a dead path). **Resolution:** record the
  path as **do-not-delete at save *initiation*** (the irreversible commit point), not on success. Lift
  the record into the parent: the capture screen marks `savedPath.current = path` the moment Save is
  fired (a new `onSaving(path)`/`onSaveStart` callback, or by lifting the save call up). The only path
  the client ever deletes is one for which **Save was never even started**. (§Layer 1.)
- **B2 — A degraded saved-paths read makes the sweep delete the whole bucket.** (Data.) `select
  image_path from meal_logs` returning `[]`/null/partial (transient error, statement timeout, near-zero
  rows early on) → every object older than grace is classified orphan → the **service role deletes
  every user's saved photos**. RLS is no backstop here. **Resolution (demand all):** (a) **fail-closed**
  — if the saved-paths query errors/returns null, **abort the whole sweep, delete nothing**, return a
  count-only 500; (b) **per-folder containment** — only classify orphans within a uid folder whose
  saved subset read cleanly; (c) **circuit breaker** — refuse to delete in one run if it would remove
  more than an absolute cap or a % of objects scanned (a correct sweep deletes a trickle; a flood is a
  bug signature); (d) **observe-only first rollout** — first deploy logs proposed counts and deletes
  nothing until one real cycle is confirmed sane. (§Layer 2.)
- **B3 — The shared secret leaks in plaintext into `cron.job.command` and `pg_net` tables.** (Data.) If
  the Vault `decrypted_secret` is interpolated at `cron.schedule` time, the literal secret is stored
  forever in `cron.job.command` (which the plan's own verify step `select * from cron.job` reads); and
  `pg_net` retains request headers/response bodies in `net._http_*` tables. **Resolution:** the cron
  command must contain `select decrypted_secret from vault.decrypted_secrets where name='cleanup_secret'`
  as a **live subquery inside the stored `net.http_post` call** (so `cron.job.command` holds only the
  reference); confirm/limit `pg_net` retention (ttl) and that it doesn't echo the header; the function
  logs `401 bad secret` **never the value**; add verify steps asserting no plaintext in `cron.job` /
  `net._http_response`. (§Layer 2.)
- **B4 — Layer 2 introduces 5 first-of-kind primitives (service-role, pg_cron, pg_net, Vault, a bespoke
  secret); justify or simplify.** (Architecture.) The repo's privileged-op precedent is a `SECURITY
  DEFINER` rpc + `revoke/grant` (`bump_analyze_usage`). **Resolution — the Edge Function IS justified
  and is kept, with the reason stated:** deleting a `storage.objects` row via raw SQL does **not**
  reclaim the S3 blob (no DB→backend delete hook; the object becomes an unreclaimable backend orphan),
  so the **Storage API `.remove()` is required**, which needs the function. **Rollout must empirically
  confirm this** (delete a row, check the blob) — if raw-SQL delete *does* reclaim the blob on this
  project, collapse Layer 2 to one `SECURITY DEFINER` function + `pg_cron` (drop the function, pg_net,
  Vault, secret). To cut the remaining surface: **the function URL is not a secret** (don't add a Vault
  entry for it — inline it or use a GUC); only the secret needs Vault. Confirm `pg_cron`/`pg_net` enable
  on this project **before** writing the migration (resolve OQ4 to a fact); document the **dashboard
  Cron UI / GitHub Action fallback** if they don't. (§Layer 2, §Rollout.)

### SHOULD-FIX (fold in)
- **Grace window must dwarf the longest plausible open review, and save must re-validate the blob.**
  (Edge + Correctness.) 24 h from *upload* is not 24 h of safety for a review left open overnight then
  saved >24 h later → sweep deletes the photo, then Save writes a dangling row. **Fix:** raise
  `GRACE_PERIOD_HOURS` to **72 h**, state the hard invariant "max review-open duration < grace," and on
  save have `create_meal_log`/the client tolerate a vanished blob gracefully (don't strand a row). Also
  compute `cutoff = now() - interval` from a **single server clock**, compare `created_at < cutoff`
  strictly, and **fail-safe to KEEP** on any clock-skew/`null`/missing-`created_at` ambiguity.
- **Re-check `meal_logs` immediately before `.remove()` (TOCTOU).** (Correctness + Edge.) The saved-set
  is read once, then list+remove takes time; a photo saved during the run would be deleted. **Fix:**
  per batch, re-query the saved paths for that exact batch and drop any now-referenced path before
  removing; add a single-run advisory lock so two sweeps can't overlap.
- **Page the TOP-LEVEL folder enumeration too, and don't trust folder-row metadata.** (Correctness.)
  `storage.list('')` is itself capped at 100 → with >100 users the sweep silently skips later folders;
  folder rows carry no real `created_at`. **Fix:** page `list('')` to completion (limit/offset loop)
  AND page each `list('{uid}')`; use only per-object `created_at`; log if any folder pages out (no
  silent truncation).
- **`image_path` must be byte-identical to the reconstructed `{uid}/{name}` key.** (Data.) Any leading
  slash / `meal-photos/` prefix / encoding mismatch → a saved photo is misclassified and deleted.
  **Fix:** pin the canonical form (it's `data.path` from `upload-meal-photo.ts`, set verbatim into
  `image_path`), reconstruct `{uid}/{name}` from `list` (never compare bare `name`), and assert a known
  saved path matches in verify.
- **Single `maybeDeleteAbandoned(prior)` helper for the client guard; drop the redundant third hook.**
  (Correctness + Architecture.) Three inlined `!== savedPath` checks invite one site missing it
  (BLOCKER-class). **Fix:** one helper holding the guard, called from all sites; and per OQ5, drop the
  pre-upload fresh-pick hook (no object exists to orphan until an upload succeeds) — keep only
  "delete the prior path when a replacement upload succeeds" + "delete on Choose-another when unsaved."
- **Self rate-limit the `verify_jwt=false` endpoint.** (Data.) It's internet-reachable, service-role-
  backed, full-bucket-scanning; the secret is the only gate. **Fix:** a small `last_run` guard (mirror
  the `analyze_usage` pattern) rejecting invocations more than once per N minutes, count-only logging of
  rejects. Use a ≥256-bit random secret; document rotation (rotate Vault + Edge secret together).
- **`.remove()` partial failure / batch size.** (Correctness + Edge.) Inspect `.remove()`'s per-object
  result, count actual vs attempted, cap batch size (e.g. 100–1000 to match paging), don't fail the
  whole run on one bad batch; document the sweep is **eventually-consistent, not single-pass-complete**.

### NIT (folded or noted)
- `delete-meal-photo.ts` mirrors `upload-meal-photo.ts`: local `const BUCKET = 'meal-photos'`, no-PII
  logging block; settle its return as `Promise<void>` (fire-and-forget, never inspected).
- Don't rely on `_shared/cors.ts` for the cron function (origin-less caller); if kept, it needn't allow
  `x-cleanup-secret` since cron sends no preflight. Log only `err.message`/typed code on Storage errors
  (error objects can carry paths = PII).
- Document the future `delete-meal` flow: deleting a `meal_logs` row makes its photo an orphan the
  sweep reaps within grace+1day; that flow should also best-effort `.remove()` the photo. In scope to
  document, out of scope to build.
- Client double-fire of delete is harmless (`.remove()` idempotent) — no dedup needed.
- "Done" must verify the **real** path: `select * from cron.job` shows the row AND `cron.job_run_details`
  shows a success — a function that passes manual curl but whose cron silently fails is not Done.

### Affirmations (no change)
- Layer 1 (client delete-on-abandon) is the right, on-grain way to kill the common-case orphan with no
  infra, using the existing owner-scoped DELETE policy. The cross-ref-`meal_logs` + grace design for the
  sweep is the correct safety model — it just must **fail closed**, not open. `image_path` is confirmed
  bucket-relative `{uid}/{name}` (matches `create_meal_log`'s namespace check), so set-membership is
  sound once the format invariant (above) is pinned.

<!-- Status flips to Approved once B1–B4 + should-fixes are folded; re-confirm the revised Layer-2
     safety design (fail-closed, circuit-breaker, dry-run, secret-as-subquery) before execution. -->

## Execution log
<!-- Filled during execution: what actually happened, any deviation from the plan
     and why, final verification result. -->
