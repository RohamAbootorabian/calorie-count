# Handoff → Next Session

_Last updated: 2026-06-19 (session 4)_

## Where we are
**Phase A (the trunk) is complete.** S1 (Auth & Onboarding) is in progress: **piece
1 — auth screens — is shipped** (plan 0004, on `main`, web-verified). **Piece 2 —
onboarding + TDEE — is planned, reviewed, and Approved but NOT yet executed** (plan
0005). Tree clean, `tsc` passes.

## What changed this session
- **Closed Step 3:** the signed-in flip (sign-in → tabs → persist → sign-out)
  verified on web → Phase A done.
- **Shipped S1 piece 1 (plan 0004):** real sign-in / sign-up / forgot-password in
  `src/features/auth/` on `@/shared/ui`; removed the temp `__DEV__` form; renamed
  Home's button to `Sign out`. Web-verified (sign-in, wrong-password, validation).
- **Drafted + reviewed + Approved plan 0005** (onboarding + TDEE) — did not execute.

## Next steps (pick up here)
1. **Execute plan 0005** ([docs/plans/0005-onboarding-tdee.md](../plans/0005-onboarding-tdee.md)) — it's Approved, blockers resolved. Order per its Rollout:
   - **Migration first:** add age/sex/height_cm/weight_kg to `goals` (SQL is in the
     plan). Needs the DB password:
     `SUPABASE_DB_PASSWORD=… npx supabase db push`, then
     `SUPABASE_DB_PASSWORD=… npx supabase gen types typescript --linked > src/types/database.ts`.
   - Build pure `src/features/auth/lib/tdee.ts` + an `npx tsx` reference-check script.
   - `use-onboarding-status.ts` hook → extend the **root** `src/app/_layout.tsx` gate
     with the `(onboarding)` group (three complementary guards).
   - `onboarding-form.ts` + `screens/onboarding-wizard.tsx` (step machine, metric-only).
   - Verify on web with the existing confirmed test user (has **no** goals row →
     should route into onboarding), then commit straight to `main`.
2. **Then S1 piece 3** — Profile & Settings (moves the Home `Sign out` there).

## Open questions / risks
- **Custom SMTP still needed** before signup-confirm + password-reset *emails* can
  be tested end-to-end (Supabase's built-in sender caps ~2/hr → we hit
  `over_email_send_rate_limit`). Configure in Supabase → Auth → Emails → SMTP, then
  re-verify plan 0004's email flows. Code is correct; this is infra.
- A **future deep-link plan** still owes the in-app confirm/reset completion
  (`expo-linking`); v1 completes those on Supabase's hosted pages.
- Executing 0005 mutates the **prod DB** — double-check the migration before `db push`.

## How to resume
Run `/session-start`. Node is via nvm — if `node`/`npm` are missing, `source
~/.zshrc`. Work from `/Users/roham_abt/Desktop/calorie count` (quote the space).
Build **sequentially on `main`** (commit straight, no PRs). **Converse in Persian.**
