<!-- HANDOFF.md is rewritten from this shape at every /session-end. Keep it SHORT:
     it's "where to pick up", not a history (the journal is the history). -->

# Handoff → Next Session

_Last updated: 2026-08-04 (session 18)_

## Where we are
**Plans 0015 (edit a saved meal) and 0016 (photo lightbox) are both DONE, built,
user-web-verified, and pushed.** The tree is clean, `npx tsc --noEmit` passes, `expo lint`
is clean. Latest shipped feature = the full-screen photo lightbox. The next mobile feature
chosen is **plan 0018 (weekly calorie trend)** — its plan doc is written and **Approved**
(4-lens review done, 1 blocker resolved) but **not yet executed**.

## What changed recently
- **Plan 0015 DONE** — edit a previously-saved meal (first UPDATE surface): `update_meal_log`
  RPC migration (deployed), `useMealDetail` + `seedFormFromMealLog`, shared `MealEditorForm`
  extracted from `meal-review`, `edit-meal-screen` + guarded `meal-edit` route, History Edit
  affordance.
- **Plan 0016 DONE** — full-screen photo lightbox: tap a History thumbnail (with a minted
  signed URL) → aspect-correct full-screen view; ✕ / backdrop / Android-back dismiss. Pure
  client, no migration; reuses the in-memory `useSignedThumbnails` URL.
- **Plan 0017 ABANDONED** — a brief spike to build a separate Next.js **web** repo on the
  shared backend was explored, then dropped by product decision to refocus on mobile; the
  standalone `calorie-count-web` folder was deleted. Plan kept for the record only.
- **Plan 0018 APPROVED (not executed)** — weekly calorie trend (7-day bar chart + weekly
  averages), a pure-client widening of `useDailyTotals`. Plan + review done; ready to build.
- **Docs reconciliation (2026-08-04)** — aligned all living docs with the code's real AI
  model (**OpenAI `gpt-4o-mini`**, not Claude/Gemini); added ADR-0003; see the latest
  JOURNAL entry.

## Next steps (pick up here)
1. **Execute plan 0018** — `docs/plans/0018-weekly-trend.md` (status: Approved). A
   pure-client 7-day calorie trend: a co-located `useWeeklyTotals` (widened clone of
   `useDailyTotals` — same `.eq('user_id')` + `Pick<>` allowlist; 8-day window; day-keys +
   weekday labels from a noon-UTC seed via UTC accessors only, per review B1) + a
   `trend-screen` (7 local bars + plain-Text weekly averages) + a `trends` route registered
   next to `meal-edit` + a "Weekly trend" button on the dashboard. No migration. Extract the
   shared `makeDayFormatter` from `use-daily-totals.tsx`.
2. Other open candidates (user's call): History **pagination** past `limit(100)`; the
   deferred **real-iPhone pass** (native `Intl` tz + `cacheKey` + 0007 camera + 0012 delete
   confirm); per-macro trend / goal-overlay follow-ups named in plan 0018.

## Open questions / risks
- **0015's `update_meal_log` migration is already deployed** to prod (project ref
  `vldpfoczswakghkrkyrm`). The next planned work (0018 weekly trend) is pure-client — no
  new migration.
- **Native `Intl` timeZone (0014)** — Hermes without full-ICU can *silently* ignore the
  `timeZone` option (no throw → device-local bucket). Web is fine; the deferred iPhone
  pass MUST confirm tz is honored on-device.
- **Native `cacheKey` (0013)** — web ignores `expo-image` `cacheKey`; the real
  byte-survival-across-rotation only matters on native — verify in the iPhone pass.
- **0011 cron** still not observed firing on schedule (path proven manually); optional
  spot-check `select * from cron.job_run_details order by start_time desc limit 5;`.
- **Tracked obligations unchanged:** account/bulk self-serve deletion (still email-routed);
  CORS prod origin + public-URL privacy mirror; custom SMTP; carry-through drift (0009);
  real-iPhone pass (now also covers native Intl tz + cacheKey + the 0007 camera + 0012
  delete confirm); real tab art; OpenAI cap N=50/user/day. Legal: COMPANY_NAME "Heart
  Harmona", CONTACT_EMAIL saba@heartharmona.com.

## How to resume
Run `/session-start`. Node is via nvm — if `node`/`npm` are missing, `source ~/.zshrc`.
Work from `/Users/roham_abt/Desktop/calorie count` (quote the space). Build **sequentially
on `main`** (commit straight, no PRs). **Converse in Persian.** Expo web dev server:
`npx expo start --web --port 8081` (8081 is the only origin `_shared/cors.ts` allows);
web-verify compiles via `expo-router/entry.bundle?platform=web` (HTTP 200, zero `*Error`).
Supabase CLI authed via the macOS keychain; migrations/verification SQL go through the
Management API; project ref `vldpfoczswakghkrkyrm`. Edge functions use **Deno**.
