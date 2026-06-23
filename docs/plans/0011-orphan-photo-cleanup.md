# Plan: Orphan meal-photo cleanup — client delete-on-abandon + scheduled server sweep

- **Status**: **APPROVED** (2026-06-24) — the 4 blockers + should-fixes from `## Review` are now
  **folded into the approach / data-model / edge-cases below** (look for `(resolves Bn)` / `(SF)`
  markers). The Layer-2 safety redesign (fail-closed + per-folder containment + circuit-breaker +
  observe-only first run + secret-as-live-subquery) is baked into §Layer 2; **re-confirm it at the
  start of execution** given the depth. Two facts must be checked empirically **before** the migration
  is written (they gate the design, not block approval): (i) `pg_cron`/`pg_net` actually enable on this
  project; (ii) raw `delete from storage.objects` does NOT reclaim the S3 blob (justifies the Edge
  Function). Build order: **Layer 1 (client) first** — safe, small, de-risks the headline guard. Not
  yet executed.
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
  - **The critical guard — record do-not-delete at save *initiation*, not on success (resolves B1).**
    `chooseAnother` is ALSO the post-save reset (passed as `onLogAnother` to `MealReview`). A **saved**
    photo's path is in `meal_logs`, so deleting it on reset destroys a real meal's photo. The earlier
    design recorded the path on the *success ack* — but `MealReview` is `key`ed by `uploadedPath` and
    its `onSaved` is gated behind `if (!mounted.current) return`, so a sign-out / re-pick that unmounts
    the child **after the RPC commits but before the ack** would never record it → a later abandon
    deletes a genuinely saved photo (unrecoverable; the `meal_logs` row points at a dead path).
    **Fix:** mark `savedPath.current = path` the **moment Save is fired** (the irreversible commit
    point), via a new **`onSaving(path)` / `onSaveStart` callback** lifted into the parent. The client
    **only ever deletes a path for which Save was never even started.** Recording at initiation (not
    success) is intentionally conservative: a Save that *fails* leaves its path marked do-not-delete and
    the sweep reaps it later — strictly safer than the inverse.
  - **One guarded helper, not three inlined checks (SF).** Add a single
    `maybeDeleteAbandoned(prior: string | null)` that no-ops unless `prior` is non-null AND
    `prior !== savedPath.current`, then fires `deleteMealPhoto(prior)`. Every abandon site calls it —
    no site can forget the guard (a missed `!== savedPath` check is BLOCKER-class).
  - Wire `maybeDeleteAbandoned` into the abandon transitions (**two sites**). The `prior != null` guard
    in the helper makes the pick-then-pick-without-uploading case a natural no-op (no object exists yet),
    so we don't need a separate "pre-upload" hook. **Execution-time correction to the planned sites:**
    the two top pick buttons stay enabled after a successful upload, so a **fresh pick after upload**
    (`applyPickOutcome`) is itself an abandon of the prior `uploadedPath`; and because `applyPickOutcome`
    always clears `uploadedPath` first, a prior path is never still present by the time `handleUpload`
    runs — making the planned `handleUpload`/"re-upload" hook dead code. The two real sites are therefore:
    1. **Fresh pick** (`applyPickOutcome`, success branch only — delete the prior `uploadedPath` before
       clearing it; no-op when none exists).
    2. **Choose another** (`chooseAnother`, only when NOT a post-save reset — the `savedPath` guard
       makes this safe even when it is).
  - After firing a delete, clear `uploadedPath`/`currentPath` as today. Best-effort: if offline, the
    sweep is the backstop.
- **Edit** `src/features/capture/screens/meal-review.tsx`: add an optional **`onSaving?: (path: string)
  => void`** prop, called synchronously **the instant the save RPC is fired** (before awaiting), so the
  parent records do-not-delete at the commit point regardless of whether the child later unmounts. (The
  idempotent `conflict`→already-saved case is naturally covered — the path was marked the moment that
  save was initiated.) No reliance on a post-success `onSaved`/`mounted.current`.

### Layer 2 — scheduled server sweep (the backstop)
A daily job that catches what the client misses. **Why an Edge Function at all (resolves B4):** raw
`delete from storage.objects` does **not** reclaim the S3 blob — there is no DB→backend delete hook, so
the row vanishes while the blob becomes an unreclaimable backend orphan. The **Storage API `.remove()`
is required**, which needs a function holding the service role. Rollout **must confirm this
empirically** (delete one `storage.objects` row, check the blob); *if* raw-SQL delete does reclaim the
blob on this project, collapse Layer 2 to a single `SECURITY DEFINER` function + `pg_cron` and drop the
Edge Function / `pg_net` / Vault / secret entirely. This matches the repo's privileged-op precedent
(`bump_analyze_usage`: `SECURITY DEFINER` + `revoke/grant`). Two pieces:

1. **New Edge Function** `supabase/functions/cleanup-orphans/` (`index.ts`; do **not** depend on
   `_shared/cors.ts` — the cron caller is origin-less and sends no preflight):
   - **Not user-invoked:** `verify_jwt = false` in `config.toml`; it checks a shared secret header
     (`x-cleanup-secret` === `Deno.env.get('CLEANUP_SECRET')`) and returns 401 otherwise — logging
     `401 bad secret`, **never the value** (avoids spreading the service-role key as the auth token; the
     function still *uses* the service role internally). Use a **≥256-bit random secret**; document
     rotation (rotate the Edge secret + the Vault entry together).
   - **Self rate-limit (SF):** the endpoint is internet-reachable, service-role-backed, and full-bucket-
     scanning, with the secret as the only gate. A small `last_run` guard (mirror the `analyze_usage`
     pattern — a tiny row/table or an advisory check) rejects invocations more than once per N minutes;
     count-only logging of rejects. The same single-run **advisory lock** prevents two sweeps overlapping.
   - Builds a **service-role** client (`SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` from `Deno.env`) —
     bypasses RLS so it sees all users' objects + rows.
   - **Algorithm — fail-closed by construction (resolves B2):**
     1. Read saved paths `select image_path from meal_logs where image_path is not null`. **If this
        query errors OR returns null → ABORT the whole run, delete nothing, return a count-only 500.**
        An empty/degraded read must never be treated as "everything is an orphan."
     2. Compute `cutoff = now() - GRACE_PERIOD_HOURS` from a **single server clock**; an object is a
        deletion candidate only if its per-object `created_at < cutoff` **strictly**. On any clock-skew
        / `null` / missing-`created_at` ambiguity, **fail-safe to KEEP** (SF).
     3. **Per-folder containment (resolves B2):** enumerate top-level folders (uids) via `storage.list('')`
        and, for each uid, `storage.list('{uid}')`. **Page BOTH levels to completion** (`{ limit, offset }`
        loop — the default cap is 100; SF) — `list('')` itself caps at 100, so >100 users would silently
        skip later folders. Use only per-object `created_at` (folder rows carry no real timestamp).
        Only classify orphans within a uid folder whose object list (and the saved-subset for it) read
        cleanly; **log if any folder pages out** so silent truncation can't hide work.
     4. **Byte-identical key match (SF):** an orphan is an object whose reconstructed `'{uid}/{name}'`
        key is **not** in the saved-paths set. Pin the canonical form to `data.path` from
        `upload-meal-photo.ts` (set verbatim into `image_path` by `create_meal_log`); reconstruct
        `{uid}/{name}` from `list` and **never compare a bare `name`** (a leading slash / `meal-photos/`
        prefix / encoding mismatch would misclassify and delete a saved photo).
     5. **TOCTOU re-check before delete (SF):** the saved-set is read once but list+remove takes time; a
        photo saved *during* the run must not be deleted. Per batch, **re-query the saved paths for that
        exact batch** and drop any now-referenced path before removing.
     6. **Circuit breaker (resolves B2):** refuse to delete in one run if it would remove more than an
        absolute cap OR a % of objects scanned — a correct sweep deletes a trickle; a flood is a bug
        signature. Abort with a count-only error instead.
     7. **Observe-only first rollout (resolves B2):** a `DRY_RUN` flag (default ON for the first
        deploy) logs proposed counts and deletes **nothing** until one real cycle is confirmed sane;
        flip to live only after.
     8. `storage.from('meal-photos').remove(orphanPaths)` in **capped batches** (100–1000, matching
        paging). **Inspect `.remove()`'s per-object result** (SF): count actual-vs-attempted, don't fail
        the whole run on one bad batch; the sweep is **eventually-consistent, not single-pass-complete**.
   - **PII/cost discipline:** log only **counts** (scanned / orphaned / deleted / dry-run-would-delete),
     never paths or uids; on Storage errors log only `err.message` / a typed code (error objects can
     carry paths = PII).
   - Returns `{ ok: true, scanned, orphaned, deleted, dryRun }` (200) for observability when invoked
     manually.
2. **New migration** `supabase/migrations/<ts>_schedule_orphan_cleanup.sql`:
   - `create extension if not exists pg_cron;` + `create extension if not exists pg_net;` — **only after
     confirming both enable on this project** (see Status / OQ4); otherwise use the dashboard Cron UI or
     a GitHub Action hitting the same function (the function is unchanged).
   - `cron.schedule('cleanup-orphans-daily', '17 3 * * *', …)` whose command does a **live Vault
     subquery for the secret, never a baked literal (resolves B3):**
     `select net.http_post( url := '<FUNCTIONS_URL>/cleanup-orphans', headers :=
     jsonb_build_object('Content-Type','application/json', 'x-cleanup-secret',
     (select decrypted_secret from vault.decrypted_secrets where name='cleanup_secret')), body :=
     '{}'::jsonb )`. So `cron.job.command` stores only the **reference**, not the secret. **The function
     URL is NOT a secret (resolves B4)** — inline it (or a GUC), do **not** add a Vault entry for it;
     **only `cleanup_secret`** lives in Vault. Confirm/limit `pg_net` retention (a short `ttl`) so
     `net._http_*` doesn't hoard request headers/response bodies, and verify it doesn't echo the secret
     header. Idempotent (`cron.unschedule('cleanup-orphans-daily')` first if it exists).

### Why this shape
- Client layer = zero infra, kills the common-case orphan instantly using the policy that already
  exists. Server layer = the only thing that catches force-close/crash. Cross-referencing
  `meal_logs.image_path` + a grace window makes the sweep **safe — but only when it fails *closed***: a
  degraded saved-paths read aborts the run (B2), the secret never lands in `cron.job`/`pg_net` (B3), and
  the dangerous "delete a real meal's photo" client mistake is closed by recording do-not-delete at save
  *initiation* (B1). The Edge Function is the minimum that can actually reclaim the S3 blob (B4).

## Files to change
- `src/features/capture/lib/delete-meal-photo.ts` — **NEW**: best-effort `deleteMealPhoto(path)`,
  never throws/blocks, `Promise<void>` (fire-and-forget), local `const BUCKET = 'meal-photos'`, logs
  only a typed outcome / `err.message` (never the path).
- `src/features/capture/screens/capture-screen.tsx` — **EDIT**: `savedPath` ref set at save
  **initiation** (B1); single `maybeDeleteAbandoned(prior)` helper (SF) wired into **two** abandon
  sites — replacement-upload + choose-another (the pre-upload fresh-pick hook is dropped); pass
  `onSaving` to `MealReview`.
- `src/features/capture/screens/meal-review.tsx` — **EDIT**: optional `onSaving?(path)` fired the
  instant the save RPC is initiated (B1), not on the post-success ack.
- `supabase/functions/cleanup-orphans/index.ts` — **NEW**: secret-gated (≥256-bit), self-rate-limited,
  service-role sweep that **fails closed** (abort on degraded read), per-folder containment, paged at
  both list levels, byte-identical key match, TOCTOU re-check, circuit-breaker, `DRY_RUN`-first,
  per-object `.remove()` inspection, count-only logging.
- `supabase/config.toml` — **EDIT**: `[functions.cleanup-orphans] verify_jwt = false`.
- `supabase/migrations/<ts>_schedule_orphan_cleanup.sql` — **NEW** (only after pg_cron/pg_net confirmed):
  extensions + an idempotent daily `cron.schedule` whose command does a **live Vault subquery** for the
  secret (B3), with the function URL inlined (not Vaulted — B4).

## Data model / schema impact
- **No table/column/RLS changes.** `meal_logs.image_path` (UNIQUE, already set by `create_meal_log`)
  is the reference set; existing owner-scoped `storage.objects` policies already permit the client
  delete; the sweep uses the service role. `image_path` is confirmed bucket-relative `{uid}/{name}`
  (matches `create_meal_log`'s namespace check), so set-membership is sound once the byte-identical key
  invariant is honored.
- **New extensions:** `pg_cron`, `pg_net` — standard on Supabase hosted, but **verify they enable on
  THIS project before writing the migration** (B4/OQ4); fallback = dashboard Cron UI or a GitHub Action
  hitting the same function.
- **New secrets:** `CLEANUP_SECRET` (Edge secret, ≥256-bit random) **plus exactly one Vault entry
  `cleanup_secret`** for the cron subquery (B3). The function URL is **not** a secret — inlined in the
  migration, **no `cleanup_fn_url` Vault entry** (B4). `SUPABASE_SERVICE_ROLE_KEY` is auto-present in the
  Edge runtime. Rotate the Edge secret + the Vault entry together. No data migration. (If a tiny
  `last_run`/lock table is used for rate-limit + single-run, that is the only new table — otherwise an
  advisory lock.)

## Edge cases & failure modes
- **Post-save reset must not delete the saved photo** (the headline risk) — closed by recording
  `savedPath` at save **initiation** (B1), so even if `MealReview` unmounts before the ack the path is
  already marked do-not-delete. Verify explicitly: save a meal → "Log another" → the saved photo still
  exists in Storage and the `meal_logs` row still points to it; and sign-out *during* a save still
  leaves the photo intact.
- **Idempotent conflict save** (B3 from 0009: same photo saved twice → returns existing id as success)
  — naturally covered: the path was marked the moment that save was initiated, regardless of outcome.
- **Save fails after initiation** — the path stays marked do-not-delete (conservative); the sweep reaps
  the genuinely-abandoned blob after grace. Strictly safer than deleting a path a Save touched.
- **Offline / delete fails on the client** — best-effort: swallow the error; the sweep is the backstop.
  Never surface a cleanup error to the user.
- **Degraded saved-paths read on the sweep (the server headline risk)** — query error/null/empty →
  **abort the whole run, delete nothing**, 500 count-only (B2). An empty read is never "all orphans."
- **Circuit-breaker trips** — if a run would delete more than the cap/% of scanned, **abort without
  deleting** and surface a count-only error; a flood is treated as a bug, not executed (B2).
- **First production run** — `DRY_RUN` ON: logs would-delete counts, deletes nothing, until one cycle is
  confirmed sane (B2).
- **Sweep races an in-progress review** — `GRACE_PERIOD_HOURS = 72` (raised from 24; SF). Hard invariant:
  **max review-open duration < grace.** A review left open overnight and saved the next day is safe; if a
  blob were ever swept before a late save, `create_meal_log` / the client must **tolerate a vanished
  blob** (don't strand a dangling row).
- **Sweep races a save mid-run (TOCTOU)** — the saved-set is re-queried per batch immediately before
  `.remove()`; a path saved during the run is dropped from deletion (SF).
- **Sign-out mid-flow** — client can't delete after the session is gone; the sweep catches it.
- **Storage `list` pagination at BOTH levels** — `list('')` AND each `list('{uid}')` cap at 100; the
  function MUST page both to completion and log if any folder/the top level pages out, else orphans (or
  whole users past #100) silently survive (SF).
- **Key-format mismatch** — reconstruct `{uid}/{name}` from `list`, compare byte-identical to
  `image_path`; never compare bare `name` (SF).
- **`net.http_post` failure / function down** — the cron row just logs a failed call; next day retries.
  No data risk (deletion is the only side effect; skipping a day only delays cleanup).
- **Secret missing/mismatch** — the function returns 401 and deletes nothing (fail-safe). Rate-limit
  rejects (too-frequent invoke) likewise delete nothing.
- **A user with zero meals** — folder exists with only orphans → all (older than grace) removed; fine.
- **Empty bucket / no orphans** — function returns `{deleted:0}`; cron is a cheap no-op.
- **`.remove()` partial failure** — inspect per-object results, count actual-vs-attempted, don't fail the
  whole run on one bad batch; the sweep is eventually-consistent, not single-pass-complete (SF).
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
  4. **Empirically confirm the blob-reclaim premise first (B4):** delete one `storage.objects` row via
     raw SQL, check whether the S3 blob is reclaimed. If NOT (expected) → keep the Edge Function. If it
     IS → collapse Layer 2 to a `SECURITY DEFINER` fn + pg_cron and re-plan that piece.
  5. **Observe-only run:** with `DRY_RUN` ON, invoke with the correct secret → confirm would-delete
     counts look sane (matches a known planted orphan), **nothing deleted**.
  6. **Live run:** flip `DRY_RUN` off. Plant an orphan: upload a photo, don't save, and (to bypass the
     72 h grace for the test) temporarily set grace = 0 / backdate; invoke with the correct
     `x-cleanup-secret` → it deletes the planted orphan, leaves a saved photo and a fresh (<grace)
     orphan untouched. Assert a known saved path is byte-identical to its reconstructed key.
  7. Invoke with a wrong/missing secret → 401, nothing deleted. Invoke twice rapidly → rate-limit
     rejects the second, nothing deleted.
  8. **Confirm the REAL cron path**, not just manual curl: `select * from cron.job` shows the row AND
     `cron.job_run_details` shows a success; and **no plaintext secret** appears in `cron.job.command`
     or `net._http_response` (B3).
- **Spot-check logs:** only counts, never paths/uids.

## Rollout
1. ✅ Reviewed + blockers folded (this plan is APPROVED). **Re-confirm the Layer-2 safety design**
   (fail-closed, per-folder containment, circuit-breaker, observe-only, secret-as-subquery) before
   touching Layer 2 code.
2. **Layer 1 first.** Build the client layer (`delete-meal-photo.ts` + capture/meal-review edits with
   the save-**initiation** guard + single helper) → typecheck/lint → web-verify cases 1–3 (no backend
   changes; de-risks the highest-risk guard early).
3. **Confirm two facts before any Layer-2 infra:** (i) `pg_cron`/`pg_net` enable on this project; (ii)
   raw `delete from storage.objects` does NOT reclaim the blob (verify case 4). If (ii) is false,
   collapse Layer 2 per B4. If (i) is false, use the dashboard-Cron / GitHub-Action fallback.
4. Build `cleanup-orphans` function + `config.toml` (fail-closed sweep, `DRY_RUN` default ON);
   `deno check`; `supabase functions deploy`; set `CLEANUP_SECRET` (≥256-bit) — `SUPABASE_SERVICE_ROLE_KEY`
   already present. Add the single `cleanup_secret` Vault entry.
5. **Observe-only:** verify case 5 (dry-run counts sane). Then flip `DRY_RUN` off and verify cases 6–7.
6. Write + `supabase db push` the `schedule_orphan_cleanup` migration (extensions + cron with the Vault
   subquery, function URL inlined). Verify case 8 (real cron path + no plaintext secret).
7. Append `docs/JOURNAL.md`; mark this plan Done; **commit straight to `main`** and push. 0007 SF9 is
   then resolved (orphan lifecycle closed); the email-based account/meal deletion flow remains a
   separate obligation, and a future `delete-meal` flow should also best-effort `.remove()` the photo.

## Open questions
_All resolved by the review — kept here as the decision record._
1. **Secret/auth between cron and the function.** **RESOLVED:** dedicated `CLEANUP_SECRET`
   (`verify_jwt=false`), with **only the secret** in Vault, read as a **live subquery inside the cron
   command** (B3) so it never lands in `cron.job.command`. The function URL is inlined (not a secret, B4).
2. **Grace period value.** **RESOLVED → 72 h** (raised from 24; SF) with the hard invariant "max
   review-open duration < grace" and save tolerating a vanished blob.
3. **Schedule cadence.** **RESOLVED → daily** (`17 3 * * *` UTC, off-peak). Hourly is overkill at this
   volume.
4. **pg_cron / pg_net availability.** **RESOLVED 2026-06-24 (empirical, Management API
   `pg_available_extensions`):** both available on this project, **not yet installed** — `pg_cron` 1.6.4,
   `pg_net` 0.20.3. `create extension if not exists` in the migration will enable them; no fallback
   needed.
5. **How many client abandon hooks.** **RESOLVED → two** (fresh-pick + choose-another); the helper's
   `prior != null` guard no-ops the pick-then-pick-without-upload case (SF/OQ5; sites corrected at
   execution — see Execution log).
6. **Does raw `delete from storage.objects` reclaim the S3 blob?** **RESOLVED 2026-06-24 (empirical) →
   NO, and it's actively BLOCKED.** This project's `storage.objects` has a `BEFORE DELETE` trigger
   `protect_objects_delete` → `storage.protect_delete()` that **RAISES** `42501 'Direct deletion from
   storage tables is not allowed. Use the Storage API instead.'` unless the GUC
   `storage.allow_delete_query='true'` is set — its own hint: *"This prevents accidental data loss from
   orphaned objects."* So raw SQL delete cannot reclaim the blob (it errors), and even forcing it would
   orphan the backend object. **The Edge Function + Storage API `.remove()` is REQUIRED; the
   "collapse to a `SECURITY DEFINER` fn + pg_cron" alternative is ruled out.**

---

## Review
_Multi-agent review (4 lenses: correctness, architecture, edge cases, data/privacy),
2026-06-24. Consolidated & deduped._

**Verdict: NEEDS CHANGES → 4 blockers. → RESOLVED 2026-06-24: all 4 blockers + should-fixes folded into
the body above (`(resolves Bn)` / `(SF)` markers); status is now APPROVED.** The two-layer instinct is
right and Layer 1 is well-sized, but every real destructive path ran through the upload→save timing
window (client) or a fail-OPEN sweep (server), and Layer 2 stacked five first-of-their-kind infra
primitives. The folded design records do-not-delete at save *initiation* (B1), makes the sweep
fail-*closed* with containment + circuit-breaker + observe-only (B2), keeps the secret out of
`cron.job`/`pg_net` via a live subquery (B3), and justifies/simplifies Layer 2 to the minimum that can
reclaim the S3 blob (B4). **Given the depth, re-confirm the revised Layer-2 safety design at the start
of execution.** Two items remain facts-to-verify-at-execution, not design gaps: pg_cron/pg_net enable
(OQ4) and the blob-reclaim premise (B4/OQ6).

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

<!-- Status: APPROVED 2026-06-24 (B1–B4 + should-fixes folded into the body). Re-confirm the revised
     Layer-2 safety design (fail-closed, containment, circuit-breaker, dry-run, secret-as-subquery)
     before executing Layer 2. Build Layer 1 (client) first. -->

## Execution log
### 2026-06-24 — Layer 1 (client delete-on-abandon)
- **Deviation from the planned hook sites (documented per WORKFLOW step 3).** The plan named the two
  client hooks as `handleUpload` (re-upload) + `chooseAnother`. Reading the real `capture-screen.tsx`:
  (a) the two pick buttons stay enabled after a successful upload, so a **fresh pick** while an
  uploaded-but-unsaved path exists is a real abandon — and `applyPickOutcome` clears `uploadedPath`
  without deleting; (b) because `applyPickOutcome` always nulls `uploadedPath` first, `handleUpload`
  never sees a prior path → the planned re-upload hook is unreachable dead code. **Corrected sites:
  `applyPickOutcome` (fresh-pick success branch) + `chooseAnother`**, both via the single
  `maybeDeleteAbandoned(prior)` helper whose `prior != null && prior !== savedPath.current` guard also
  makes pick-then-pick-without-upload a no-op. Plan body §Layer 1 updated to match.
- **B1 honored:** `savedPath.current` is set at save **initiation** via a new `onSaving(path)` prop on
  `MealReview`, fired the instant the save RPC is dispatched (before the await), so an unmount between
  commit and ack can't lose the do-not-delete mark.
- **Files:** NEW `delete-meal-photo.ts` (fire-and-forget `Promise<void>`, never throws, message-only
  logging); EDIT `meal-review.tsx` (`onSaving` prop fired pre-await); EDIT `capture-screen.tsx`
  (`savedPath` ref + `maybeDeleteAbandoned` helper wired into `applyPickOutcome` + `chooseAnother`,
  `onSaving` passed through).
- **Verified:** `npx tsc --noEmit` PASS; `npx expo lint` clean (exit 0); web bundle builds (HTTP 200,
  module compiled). **Web-verified by the user** — case 1 (Choose another deletes the orphan), case 2
  (re-pick deletes A, keeps B), case 3 (Save → Log another: the saved photo SURVIVES and `meal_logs`
  still points at it). **Layer 1 DONE.** Layer 2 (server sweep) is the remaining piece.
### 2026-06-24 — Layer 2 pre-flight fact-checks (B4/OQ4/OQ6, empirical)
Ran two non-destructive Management-API queries against the live project before writing any infra:
- **OQ4 — extensions available:** `pg_cron` 1.6.4 + `pg_net` 0.20.3 are available (installed_version
  null). The migration's `create extension if not exists` will enable them; no external-scheduler
  fallback needed.
- **B4/OQ6 — raw delete cannot reclaim the blob, AND is blocked.** `storage.objects` carries a
  `BEFORE DELETE FOR EACH STATEMENT` trigger `protect_objects_delete` → `storage.protect_delete()`
  which raises `42501 'Direct deletion from storage tables is not allowed. Use the Storage API
  instead.'` unless `current_setting('storage.allow_delete_query')='true'`. Hint: "This prevents
  accidental data loss from orphaned objects." → **Edge Function + `.remove()` is mandatory;** the
  SECURITY-DEFINER-collapse alternative is ruled out. No test object created (structural proof from the
  trigger is conclusive).
<!-- (Layer 2 build continues during execution) -->
