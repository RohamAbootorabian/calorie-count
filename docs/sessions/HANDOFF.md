<!-- HANDOFF.md is rewritten from this shape at every /session-end. Keep it SHORT:
     it's "where to pick up", not a history (the journal is the history). -->

# Handoff → Next Session

_Last updated: 2026-06-24 (session 11)_

## Where we are
**Plan 0011 (orphan-photo cleanup) is APPROVED and half-shipped.** **Layer 1 (client delete-on-abandon)
is DONE + web-verified + pushed.** **Layer 2 (scheduled server sweep) is CODE-COMPLETE but NOT DEPLOYED**
— the Edge Function + migration + config are written and deno-check/lint clean, committed but **not yet
deployed to production** (no secret set, no `functions deploy`, no `db push`). Tree is clean,
`npx tsc --noEmit` passes, `deno check` passes.

## What changed this session
- **Plan 0011 folded NEEDS CHANGES → APPROVED** — all 4 blockers + should-fixes woven into the plan body.
- **Layer 1 SHIPPED** (commit `aa83c54`, pushed): `delete-meal-photo.ts` + `capture-screen.tsx`
  (`savedPath` ref set at save **initiation** per B1, single `maybeDeleteAbandoned` helper) +
  `meal-review.tsx` (`onSaving` prop). User web-verified cases 1–3. **Deviation logged:** the real
  abandon sites are `applyPickOutcome` (fresh pick) + `chooseAnother`, not the planned `handleUpload`.
- **Fact-checks resolved (empirical, Management API):** pg_cron 1.6.4 + pg_net 0.20.3 AVAILABLE (not
  installed); raw `delete from storage.objects` is BLOCKED by the `protect_objects_delete` trigger →
  Edge Function + `.remove()` is mandatory (B4 confirmed, collapse-alternative ruled out).
- **Layer 2 code-complete** (commit `09b1896`, **unpushed until this session-end pushes it**):
  `cleanup-orphans/index.ts` (fail-closed sweep), `..._schedule_orphan_cleanup.sql` (extensions +
  `claim_cleanup_run` lock/rate-limit + Vault-subquery cron), `config.toml` (`verify_jwt = false`).

## Next steps (pick up here) — deploy + verify Layer 2
Rollout steps 4–6 of [docs/plans/0011-orphan-photo-cleanup.md](../plans/0011-orphan-photo-cleanup.md).
Do this in order; **keep `CLEANUP_DRY_RUN=true` for the first cycle** (observe-only, deletes nothing):
1. **Generate a ≥256-bit secret** and set the prereqs (one shared value in two places + the dry-run flag):
   - Edge secrets: `supabase secrets set CLEANUP_SECRET=<secret> CLEANUP_DRY_RUN=true`
     (`SUPABASE_SERVICE_ROLE_KEY` is already present in the Edge runtime).
   - Vault: `select vault.create_secret('<secret>', 'cleanup_secret');` — **same value** as `CLEANUP_SECRET`.
2. **Deploy the function:** `supabase functions deploy cleanup-orphans` (uses `verify_jwt=false` from config).
3. **Apply the migration:** `supabase db push` (creates extensions + `cleanup_run` + `claim_cleanup_run`
   + the daily cron). NOTE: `db push` may need the DB password; if unavailable non-interactively, the
   Management API SQL endpoint works (token is in macOS keychain: `security find-generic-password -s
   "Supabase CLI" -w`; project ref `vldpfoczswakghkrkyrm`) — but then reconcile migration history.
4. **Observe-only verify:** invoke with the correct `x-cleanup-secret` → expect `{ok:true, dryRun:true,
   scanned, orphaned, deleted:0}`; wrong/missing secret → 401; two rapid invokes → second is 429
   (claim rate-limit). Check the function logs show only COUNTS (no paths/uids).
5. **Go live + verify deletion:** set `CLEANUP_DRY_RUN=false`; plant an old orphan (upload, don't save,
   backdate or temporarily grace=0) → invoke → it deletes the planted orphan, leaves a saved photo + a
   fresh (<grace) orphan. Assert a known saved path is byte-identical to its reconstructed key.
6. **Verify the REAL cron path (required for Done):** `select * from cron.job` shows the row;
   `cron.job_run_details` shows a success; and **no plaintext secret** in `cron.job.command` or
   `net._http_response` (B3). Then append JOURNAL, mark plan 0011 **Done**, commit + push. 0007 SF9 closed.

## Open questions / risks
- **The sweep holds the service-role key and can delete any user's photos** — the fail-closed +
  per-folder-containment + circuit-breaker + DRY_RUN guards are load-bearing; verify them in step 4–5,
  don't skip to live. Keep DRY_RUN on until one real cycle looks sane.
- **Secret hygiene:** the same value must be in BOTH the Edge secret and Vault; rotate them together.
  Never paste the secret into a committed file or the migration (it uses a live Vault subquery).
- **Tracked obligations still open:** CORS prod origin + public-URL privacy-policy mirror (move together
  with a prod web domain); self-serve/account-deletion flow (privacy policy routes deletion via email
  `saba@heartharmona.com`); a future `delete-meal` flow should also best-effort `.remove()` the photo;
  custom SMTP; carry-through drift (0009); real-iPhone camera path (0007). OpenAI cap N=50/user/day.
- Legal placeholders confirmed: COMPANY_NAME "Heart Harmona", CONTACT_EMAIL saba@heartharmona.com.

## How to resume
Run `/session-start`. Node is via nvm — if `node`/`npm` are missing, `source ~/.zshrc`. Edge functions use
**Deno** (`deno check`/`deno lint`; URL imports trip `no-import-prefix` by convention — harmless, matches
`analyze-meal`). Work from `/Users/roham_abt/Desktop/calorie count` (quote the space). Build
**sequentially on `main`** (commit straight, no PRs). **Converse in Persian.** Expo web dev server runs on
`localhost:8081` (the only origin allowed by `_shared/cors.ts`; the cron function is origin-less so it
doesn't use cors.ts). The Supabase CLI is authenticated via the macOS keychain (no `~/.supabase`
access-token file); project ref `vldpfoczswakghkrkyrm`.
