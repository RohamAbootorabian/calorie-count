# Handoff → Next Session

_Last updated: 2026-06-19_

## Where we are
**Step 1 of the build is DONE: the database schema + RLS is live on Supabase.**
Tables `profiles`, `goals`, `meal_logs`, `meal_items` exist on the linked project
`vldpfoczswakghkrkyrm`, RLS is active (anon default-deny verified), the private
`meal-photos` bucket exists, and `src/types/database.ts` is generated. Tree
typechecks clean. We build **sequentially in one session** now (the parallel-session
idea was dropped) — commit straight to `main`.

## What changed this session
- Locked **Gemini 2.5 Flash** as the vision model (cheap + strong); fixed CLAUDE.md.
- Added the **session-health footer** rule and the `MODULES.md` / `ARCHITECTURE.md`
  roadmap docs (kept as the feature map even though parallel sessions were dropped).
- Wrote → multi-agent-reviewed → executed **plan 0001** (schema + RLS). Review caught
  real bugs first (RLS `WITH CHECK`, trigger `search_path`, dropped `quality_factors`,
  NaN guard). Migration pushed and verified live.

## Next steps (pick up here)
We are inside **Phase A (the trunk)**. Remaining trunk pieces, then features:
1. **Step 2 — Design system** (`src/shared/ui/`): theme + base components
   (Button, Card, Input, Screen). Run `/plan design system` → `/review-plan` → build.
2. **Step 3 — Navigation + auth provider** (`src/app/` tabs/stack with an auth gate;
   auth session provider + `useUser` hook in `src/lib/auth`).
3. **Step 4 — Auth & Onboarding feature** (`src/features/auth/`): signup/login +
   goals/TDEE wizard → writes `profiles`/`goals`. (Brief: `docs/sessions/briefs/S1-auth-onboarding.md`.)
Then capture+AI, diary, trends (see `docs/ARCHITECTURE.md`).

## Open questions / risks
- **Full two-user RLS proof is still pending** — only anon default-deny is verified.
  Exercise per-user isolation once signup exists (Step 4).
- **Photo→nutrition accuracy** (Gemini) is the core product risk — build a small eval
  when we do the `analyze-meal` Edge Function.
- Privacy policy needed before any store submission (health data).

## How to resume
Run `/session-start`. Node is via nvm — if `node`/`npm` are missing, `source ~/.zshrc`.
Work from `/Users/roham_abt/Desktop/calorie count` (quote the space).
**DB ops** (`supabase db push` / `gen types`) need the database password via the
`SUPABASE_DB_PASSWORD` env var — ask the user for it (it is NOT stored in the repo,
and may have been rotated since last session). Get it / reset it at Supabase →
Settings → Database.
