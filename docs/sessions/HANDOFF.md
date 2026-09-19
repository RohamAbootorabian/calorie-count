<!-- HANDOFF.md is rewritten from this shape at every /session-end. Keep it SHORT:
     it's "where to pick up", not a history (the journal is the history). -->

# Handoff → Next Session

_Last updated: 2026-09-19 (docs reconciliation + plan 0041 RLS proof)_

## Where we are
**Plans 0001–0041 are all executed and pushed** (0017 abandoned). Latest app feature = **plan
0040, smart meal reminders**. Latest work = **plan 0041, the two-user RLS proof on prod**. Result:
64 PASS / 3 FAIL. The 3 FAILs are one real hole (B1, below), and **plan 0042 is next to fix it**.
Tree clean; tsc and lint pass.

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
- **Plan 0041 (2026-09-19)** — added `scripts/check-rls.ts`, a re-runnable prod isolation harness
  (67 attacks, `--self-test`, `--sweep`, guarded teardown). Plan 0001's deferred proof is now
  closed. The run command is in the script header.
- **Local move fix (2026-09-19)** — the project moved to `Desktop/Projects/calorie-count`. The
  stale absolute paths in `ios/Pods`, `node_modules/expo-modules-jsi/apple/.DerivedData` and a
  long-running Metro were all rebuilt or restarted. If a native build complains about
  `Desktop/calorie-count`, that's the cause.
- **Docs reconciliation (2026-09-19)** — the Status line had never been flipped to Done for 0001 and
  0029–0038; all fixed. Also fixed 0031's migration filename and the project path in CLAUDE.md.

## Next steps (pick up here)
1. **Plan 0042: close the `image_path` namespace hole (B1).**
   - **The hole:** the `meal_logs` INSERT/UPDATE policies check only `user_id`, so direct table
     writes bypass `create_meal_log`'s `split_part(image_path,'/',1) = auth.uid()` check.
   - **Fix direction:** a migration adding `image_path is null or split_part(image_path,'/',1) =
     auth.uid()::text` to the `meal_logs_insert`/`meal_logs_update` WITH CHECK, or column grants.
     Optionally also revoke EXECUTE on the trigger functions `handle_new_user`/`set_updated_at`
     from anon/authenticated.
   - **Verify:** rerun `scripts/check-rls.ts`; the 3 `meal_logs.B1-*` cases must turn PASS and
     the rest stay PASS.
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
