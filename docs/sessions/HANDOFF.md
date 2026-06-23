<!-- HANDOFF.md is rewritten from this shape at every /session-end. Keep it SHORT:
     it's "where to pick up", not a history (the journal is the history). -->

# Handoff → Next Session

_Last updated: 2026-06-24 (session 10)_

## Where we are
**S2 (Capture & AI Analysis) is COMPLETE and live** — a user can shoot/pick a meal photo → upload →
analyze (OpenAI GPT-4o-mini vision) → **review/edit** the estimate → **Save** it as `meal_logs` +
`meal_items` rows. An **in-app privacy policy** ships at `/privacy`. The next feature in flight is
**plan 0011 (orphan-photo cleanup)** — drafted + reviewed, but **NEEDS CHANGES (4 blockers), not yet
executed.** Tree is clean, `npx tsc --noEmit` passes.

## What changed this session
- **Plan 0009 DONE** — meal review/edit + atomic save via the new `create_meal_log(jsonb,jsonb)` RPC
  (SECURITY INVOKER, allowlisted/server-set columns, idempotent on `image_path`). Web-verified. S2 done.
- **Plan 0010 DONE** — in-app privacy policy disclosing OpenAI + Supabase. New unguarded `/privacy`
  route + 3 entry points (sign-up agreement, Settings "Legal", Capture point-of-processing notice).
  Review caught 2 copy-accuracy blockers (collection list; honest email-only deletion). Web-verified.
- **Plan 0011 drafted + reviewed → NEEDS CHANGES** — orphan-photo cleanup (client delete-on-abandon +
  scheduled server sweep). 4 blockers recorded with resolutions; **not folded into the body yet.**

## Next steps (pick up here)
1. **Resume plan 0011** ([docs/plans/0011-orphan-photo-cleanup.md](../plans/0011-orphan-photo-cleanup.md)).
   First **fold the 4 blockers + should-fixes from its `## Review` into the approach/data-model**, then
   re-confirm the Layer-2 safety design, then execute. Concretely:
   - **B1:** record "do-not-delete" at **save initiation** (lift to the capture screen via an
     `onSaving(path)`-style signal), so a path Save was started for is never deleted on a later abandon.
   - **B2:** sweep must **fail-closed** if `select image_path from meal_logs` errors/empties; per-folder
     containment; a delete **circuit-breaker** (abort if > cap/% scanned); **observe-only first deploy**.
   - **B3:** secret as a **live Vault subquery inside the cron command** (never baked); verify no
     plaintext in `cron.job` / `net._http_response`.
   - **B4:** keep the Edge Function (raw `delete from storage.objects` does NOT reclaim the S3 blob —
     confirm empirically at rollout); **verify `pg_cron`/`pg_net` enable on this project before writing
     the migration**; drop the Vault entry for the non-secret function URL; document the dashboard-Cron /
     GitHub-Action fallback.
   - **Should-fixes:** grace → **72 h** + save tolerates a vanished blob; **re-check `meal_logs` right
     before `.remove()`** + single-run lock; **page the top-level folder list** too; pin
     `image_path` ↔ `{uid}/{name}` byte-identical; one `maybeDeleteAbandoned()` helper, drop the
     fresh-pick hook; rate-limit the endpoint; inspect `.remove()` partial results; count-only logging.
   - **Build order:** Layer 1 (client) first — it's safe, small, and de-risks the headline guard — then
     the Edge Function + cron migration. Verify the **real cron path** (`select * from cron.job` +
     `cron.job_run_details` success), not just a manual curl.
2. Or pick another tracked obligation (see below) if you'd rather not carry 0011.

## Open questions / risks
- **0011 is the active risk:** the sweep holds the **service-role key** and can delete any user's
  photos — the fail-closed + circuit-breaker + dry-run guards (B2) are load-bearing; do not skip them.
- **Tracked obligations still open:** CORS prod origin + a **public-URL mirror** of the privacy policy
  (both move together when a prod web domain exists); **self-serve/account deletion** flow (the privacy
  policy currently routes deletion through email `saba@heartharmona.com`); custom SMTP; carry-through
  drift (0009 — edited macros vs carried sugar/fiber); real-iPhone camera path (0007). OpenAI spend:
  `analyze_usage` cap N=50/user/day.
- Legal placeholders confirmed: COMPANY_NAME "Heart Harmona", CONTACT_EMAIL saba@heartharmona.com.

## How to resume
Run `/session-start`. Node is via nvm — if `node`/`npm` are missing, `source ~/.zshrc`. Work from
`/Users/roham_abt/Desktop/calorie count` (quote the space). Build **sequentially on `main`** (commit
straight, no PRs). **Converse in Persian.** The Expo web dev server runs on `localhost:8081` (its origin
is the only one allowed by `_shared/cors.ts`).
