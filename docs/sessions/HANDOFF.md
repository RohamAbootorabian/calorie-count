<!-- HANDOFF.md is rewritten from this shape at every /session-end. Keep it SHORT:
     it's "where to pick up", not a history (the journal is the history). -->

# Handoff → Next Session

_Last updated: 2026-06-24 (session 13)_

## Where we are
**Plan 0015 (edit a saved meal) is Approved and waiting to be executed — that's the
first thing to do next session.** This session shipped two full plans end-to-end: **0013**
(History photo **thumbnails** — the app's first `createSignedUrl(s)` integration) and
**0014** (daily totals **dashboard** on the Home tab — the first aggregate read, replacing
the Expo starter screen). Both are built, **user-web-verified**, and pushed. The tree is
clean, `npx tsc --noEmit` passes, `expo lint` is clean.

## What changed this session
- **Plan 0013 DONE** — `useSignedThumbnails` (batch `createSignedUrls`, mint-on-set-change,
  `userId`-keyed, retry-on-Refresh, 404 negative-cache) + a 56×56 `expo-image` thumbnail
  (`cacheKey: image_path`) in each History row; flat placeholder. Centralized
  `MEAL_PHOTOS_BUCKET`; extracted `src/lib/with-timeout.ts`. No migration.
- **Plan 0014 DONE** — `useDailyTotals(tz)` (48 h bounded fetch + `useMemo(rows, tz)`
  bucket via one hardcoded-`en-CA` `Intl` formatter; same-formatter date-string compare =
  DST-safe) + `useDailyGoals` (narrow `Pick<>`, no body PII) + dashboard screen (guarded
  `progressFor`, two-View bars, focus refetch). Home `(app)/index.tsx` → thin re-export.
  No migration.
- **Plan 0015 APPROVED (not executed)** — full plan + 4-lens review done; 2 blockers
  resolved in the doc. Ready to build.

## Next steps (pick up here)
1. **Execute plan 0015** — `docs/plans/0015-edit-meal.md` (status: Approved). Build order:
   - New migration `supabase/migrations/<ts>_update_meal_log.sql` — atomic update RPC,
     modeled on `20260623132156_create_meal_log.sql`. **Body order:** auth guard → item
     count 1..50 → parent UPDATE (allowlisted cols, NO `updated_at`/`image_path`/`eaten_at`/
     `user_id`/`verified`) + `GET DIAGNOSTICS ROW_COUNT` not-found → `raise … errcode
     'P0002'` → delete children → re-insert children `with ordinality`.
   - Client: `src/features/history/lib/use-meal-detail.tsx` (both-or-neither gate),
     `update-meal.ts` (dedicated result type, `P0002`/`23503` → `not_found`),
     `seedFormFromMealLog` in `src/features/capture/lib/meal-form.ts`, extract a shared
     `MealEditorForm` from `meal-review.tsx` (move the assumptions block to read
     `form.assumptions`), `edit-meal-screen.tsx`, root-guarded route `src/app/meal-edit.tsx`
     + `<Stack.Screen name="meal-edit">` in `app/_layout.tsx` (inside the
     `!!session && !needsOnboarding` guard), History Edit affordance + skip-first-focus
     `useFocusEffect`. Optional shared `callMealRpc` primitive.
   - **Deploy the migration** (`supabase db push`) — the one non-client step; verify the
     function + grants like `create_meal_log`. Then `tsc`/`lint`/web-bundle + user verify.
2. Other open candidates (user's call): meal photo **lightbox** (tap a thumbnail — 0013
   left signed URLs ready), **weekly/trend** view (reuses `useDailyTotals` shape),
   History **pagination** past `limit(100)`.

## Open questions / risks
- **0015 is the first DB migration since `create_meal_log`** — needs a `db push` to prod
  (project ref `vldpfoczswakghkrkyrm`). Heavier than the recent pure-client plans; budget
  a fresh session's context for it.
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
