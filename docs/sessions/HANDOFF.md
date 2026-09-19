<!-- HANDOFF.md is rewritten from this shape at every /session-end. Keep it SHORT:
     it's "where to pick up", not a history (the journal is the history). -->

# Handoff → Next Session

_Last updated: 2026-09-19 (docs-reconciliation session)_

## Where we are
**Plans 0001–0040 are all executed and pushed** (0017 abandoned). Latest shipped feature =
**plan 0040, smart meal reminders** (local notifications). Tree clean, `npx tsc --noEmit` passes.
This session made no code changes: it was a docs cleanup. The previous handoff was stale
(session 18, pointing at plan 0018), so read `docs/JOURNAL.md` for the 0018→0040 history.

## What changed recently
- **Plans 0018–0028** — weekly/monthly trends, goal line, plan-progress rings, device-timezone
  fixes + midnight rollover, Home Daily/Weekly/Monthly switcher, meal text note, manual meal date.
- **Plans 0029–0036** — single-tap "Analyze meal", SF Symbol tab icons, profile allergies +
  conditions (fed to the AI) with a red allergen warning, History search + date filter, health
  step in Onboarding, manual calorie/macro targets, manually add a meal item.
- **Plans 0037–0039** — DRY refactors: `useMealForm`, `useOwnedMealRows`, shared `SelectGroup`.
- **Plan 0040** — opt-in breakfast/lunch/dinner reminders that fire only if that window is
  unlogged (local `expo-notifications`, reconcile on foreground/save/settings; prefs in
  AsyncStorage per user).
- **Docs reconciliation (2026-09-19)** — the Status line had never been flipped to Done for 0001 and
  0029–0038; all fixed. Also fixed 0031's migration filename and the project path in CLAUDE.md.

## Next steps (pick up here)
1. **Two-user RLS isolation proof** (security; deferred since plan 0001, never recorded as done).
   Go through `/plan` first: with two test accounts on prod, prove that A cannot read, update, or
   delete B's rows in every table or B's objects in the `meal-photos` bucket.
2. **Real-iPhone verification pass.** Many plans are "user device-verify pending" (0018–0036, see
   the JOURNAL "Pending" lines) plus 0040 reminders, native `Intl` tz on Hermes (0014/0022),
   `cacheKey` (0013), 0007 camera, 0012 delete confirm.
3. Candidates (user's call): History pagination past `limit(100)` (0033 search already reaches
   older meals); `DailyGoalsCard` extraction (0035 tech debt); per-macro trend.

## Open questions / risks
- **Process gap:** step 5 ("mark the plan Done") was being skipped, and so was `/session-end`
  (this handoff went a month stale). Flip the Status line in the same commit as the JOURNAL entry.
- **Native `Intl` timeZone**: Hermes without full-ICU can *silently* ignore `timeZone`. Only
  the iPhone pass can confirm it.
- **0011 cron** still not observed firing on schedule; spot-check
  `select * from cron.job_run_details order by start_time desc limit 5;`.
- **Tracked obligations:** self-serve account/bulk deletion (still email-routed); CORS prod
  origin + public-URL privacy mirror; custom SMTP; real tab art; OpenAI cap N=50/user/day.
  Legal: COMPANY_NAME "Heart Harmona", CONTACT_EMAIL saba@heartharmona.com.

## How to resume
Run `/session-start`. Node is via nvm; if `node`/`npm` are missing, `source ~/.zshrc`.
Work from `/Users/roham_abt/Desktop/Projects/calorie-count`. Build **sequentially on `main`**
(commit straight, no PRs). **Converse in Persian.** Expo web dev server:
`npx expo start --web --port 8081` (8081 is the only origin `_shared/cors.ts` allows).
Supabase CLI is authed via the macOS keychain; migrations/verification SQL go through the
Management API; project ref `vldpfoczswakghkrkyrm`. Edge functions use **Deno**.
