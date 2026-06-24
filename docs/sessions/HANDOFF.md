<!-- HANDOFF.md is rewritten from this shape at every /session-end. Keep it SHORT:
     it's "where to pick up", not a history (the journal is the history). -->

# Handoff → Next Session

_Last updated: 2026-06-24 (session 12)_

## Where we are
**No open plans — the tree is clean and all work is pushed.** Session 12 shipped two full plans end-to-end:
**0011 Layer 2** (orphan-photo server sweep) is **deployed + verified in production**, and **0012**
(meal History list + delete-meal flow) is **built + user-web-verified**. The app can now read back saved
meals (the first DB-read surface) and a user can delete one (row + `meal_items` cascade + best-effort
photo removal). `npx tsc --noEmit` passes; `expo lint` clean.

## What changed this session
- **Plan 0011 DONE** — deployed the `cleanup-orphans` sweep: generated a 256-bit secret (Edge
  `CLEANUP_SECRET` + Vault `cleanup_secret`, same value), `db push` (pg_cron 1.6.4 + pg_net 0.20.3 +
  `cleanup_run`/`claim_cleanup_run` + daily cron `17 3 * * *`), `functions deploy`. Verified dry-run
  (200/429/401), live planted-orphan deletion (deleted synthetic orphan, saved photo survives), and the
  real cron command path (Vault subquery → `net.http_post` → 200, **no plaintext secret** in
  `cron.job`/`net._http_*`). **DRY_RUN is now live (false); cron armed.** 0007 SF9 closed.
- **Plan 0012 DONE** — new `history` feature: `useMealHistory` hook + `deleteMeal` primitive + History
  screen; repurposed the starter Explore tab → History (renamed route + **both** tab files); updated
  `privacy-content.ts` to disclose in-app per-meal deletion. **Zero backend work** (RLS delete policy +
  `meal_items` cascade already existed). Review caught 2 blockers (missed `app-tabs.web.tsx`; privacy
  policy contradiction) + dropped optimistic rollback for await-then-refetch.

## Next steps (pick up here)
**No queued task — start a fresh `/plan` for the next obligation.** Candidates (user's call):
1. **Meal photo thumbnails** in the History list — needs the first `createSignedUrl(s)` integration
   (private bucket) + TTL/caching. Natural fast-follow to 0012 (`src/features/history/screens/history-screen.tsx`).
2. **Daily totals / dashboard** — make the Home tab (`src/app/(app)/index.tsx`, still Expo starter) show
   today's calories/macros by aggregating `meal_logs`.
3. **Meal edit** — edit a saved meal (review/edit-before-save already exists in `meal-review.tsx`).
4. **Pagination** past `limit(100)` in `use-meal-history.tsx` (only when a user nears it).
5. **Real-device pass** — test `Alert.alert` delete confirm + the 0007 real-camera path on the user's
   iPhone 16 Pro Max (deferred, bundle them).

## Open questions / risks
- **0011 cron not yet observed firing on schedule.** The path is proven (manual `net.http_post` → 200),
  but `cron.job_run_details` only populates on the real 03:17 UTC tick. Optionally spot-check it next
  session: `select * from cron.job_run_details order by start_time desc limit 5;` (Management API SQL,
  project ref `vldpfoczswakghkrkyrm`). Not blocking.
- **Secret hygiene (0011):** `CLEANUP_SECRET` (Edge) and Vault `cleanup_secret` must hold the SAME value —
  rotate together; never paste into a committed file (the cron uses a live Vault subquery).
- **Tracked obligations still open:** account/bulk self-serve deletion (privacy policy still routes it via
  email `saba@heartharmona.com`); CORS prod origin + public-URL privacy mirror (move with a prod web
  domain); custom SMTP; carry-through drift (0009); real-iPhone camera (0007); real tab art; OpenAI cap
  N=50/user/day. Legal placeholders confirmed: COMPANY_NAME "Heart Harmona", CONTACT_EMAIL saba@heartharmona.com.

## How to resume
Run `/session-start`. Node is via nvm — if `node`/`npm` are missing, `source ~/.zshrc`. Work from
`/Users/roham_abt/Desktop/calorie count` (quote the space). Build **sequentially on `main`** (commit
straight, no PRs). **Converse in Persian.** Expo web dev server: `npx expo start --web --port 8081`
(8081 is the only origin `_shared/cors.ts` allows). Edge functions use **Deno** (`deno check`/`deno lint`;
URL-import `no-import-prefix` warning is a harmless convention). Supabase CLI is authed via the macOS
keychain (`security find-generic-password -s "Supabase CLI" -w`), not a token file; Vault/verification SQL
goes through the Management API `database/query` endpoint; project ref `vldpfoczswakghkrkyrm`.
