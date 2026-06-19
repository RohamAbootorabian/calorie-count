# Handoff → Next Session

_Last updated: 2026-06-19_

## Where we are
**Phase A (the trunk) is 2 of ~4 steps done.** Step 1 (DB schema + RLS, live on
Supabase) and **Step 2 (design system, `src/shared/ui/`)** are complete, committed,
and pushed. **Step 3 (navigation + auth provider) is PLANNED but NOT built** —
[docs/plans/0003-navigation-auth-provider.md](../plans/0003-navigation-auth-provider.md)
is written and ready for review. Tree is clean; `tsc` + `lint` pass.

## What changed this session
- **Shipped Step 2 — design system** ([docs/plans/0002-design-system.md](../plans/0002-design-system.md),
  status Done). Reuse over replace: extended `theme.ts` with semantic tokens
  (green brand `primary`/`primaryText`/`border`/`danger` + a `Radius` scale) and
  built `src/shared/ui/`: **Button, Card, Input, Screen, Text** via one barrel
  `@/shared/ui`. Multi-agent review caught a real blocker first — `useTheme()`
  returned `undefined` colors on a `null`/`'unspecified'` scheme (fixed). `Screen`
  bakes in `KeyboardAvoidingView`; tab inset is opt-in; Button has a double-tap
  guard; Input has secure-field hygiene + React-19 ref-as-prop.
- **Set up `expo lint`** for the first time (`eslint.config.js` + eslint deps); one
  pre-existing template hydration warning is scoped-disabled. tsc + lint clean.
- **Drafted plan 0003** (navigation + auth provider) — grounded in the Expo SDK 56
  `Stack.Protected` auth pattern. Stopped before executing to keep context fresh.

## Next steps (pick up here)
1. **Review plan 0003:** run `/review-plan docs/plans/0003-navigation-auth-provider.md`.
   Resolve every blocker (edit the plan) before any code — non-negotiable workflow.
2. **Execute Step 3** strictly per the approved plan:
   - Build `src/lib/auth/` (`AuthProvider`, `useAuth`, `useUser`, `signOut`) over
     the existing `supabase` singleton in [src/lib/supabase.ts](../../src/lib/supabase.ts).
   - Restructure routes: move `src/app/index.tsx` + `explore.tsx` into
     `src/app/(app)/`, add `src/app/(auth)/`, rewrite `src/app/_layout.tsx` with the
     `Stack.Protected guard={!!session}` gate + brand-synced `ThemeProvider`.
   - Fix the duplicated `null`-scheme bug in `src/components/app-tabs.tsx` +
     `app-tabs.web.tsx` (use `useTheme()`).
   - Ship only a `__DEV__` temp sign-in on the `(auth)` placeholder to test the gate.
3. **Verify:** `npx tsc --noEmit`, `npm run lint`, and run in Expo Go (cold-start
   shows `(auth)`; temp sign-in → tabs; relaunch persists; sign-out → back to auth).
4. **Then Step 4 / S1** — real auth & onboarding screens in `src/features/auth/`
   (brief: [docs/sessions/briefs/S1-auth-onboarding.md](briefs/S1-auth-onboarding.md));
   remove the temp `__DEV__` sign-in.

## Open questions / risks
- **Step 2 visual check still pending** — `src/shared/ui` primitives typecheck/lint
  but have NOT been rendered on a device yet (no gallery shipped). Do a quick visual
  pass when Step 3's gate / S1's first screen consumes them.
- **Full two-user RLS proof** still deferred to S1 (needs real users); anon
  default-deny is verified.
- Plan 0003 open questions (test-user for gate, `useUser` shape, keeping template
  placeholders, splash overlay, `(auth)` anchor route name) — all have low-risk
  leans noted in the plan; settle them in review.
- **Gemini photo→nutrition accuracy** remains the core product risk (build an eval
  at the `analyze-meal` Edge Function stage). Privacy policy needed pre-submission.

## How to resume
Run `/session-start`. Node is via nvm — if `node`/`npm` are missing, `source
~/.zshrc`. Work from `/Users/roham_abt/Desktop/calorie count` (quote the space).
We build **sequentially on `main`** (commit straight, no PRs). Converse in
**Persian**. No DB password needed for Step 3 (pure client code).
