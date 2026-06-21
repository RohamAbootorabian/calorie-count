# Handoff → Next Session

_Last updated: 2026-06-21 (session 6)_

## Where we are
**S1 (Auth & Onboarding) is 2/3 shipped.** Piece 1 (auth screens, plan 0004) and
**piece 2 (onboarding + TDEE, plan 0005) are both DONE on `main`** (plan 0005 executed,
web-verified, commit `eec70de`). **Piece 3 — Profile & Settings (plan 0006) — is
drafted, reviewed, and Approved but NOT yet executed.** Executing it **closes S1**.
Tree clean, `tsc` passes.

## What changed this session
- **Drafted + multi-agent-reviewed + Approved plan 0006** (Profile & Settings). Did not
  execute. 2 blockers resolved in-plan (imperial state model + unit-aware validation),
  8 should-fixes folded in, all 5 open questions decided.
- (Earlier in this arc: executed plan 0005 — onboarding wizard + TDEE — and shipped it.)

## Next steps (pick up here)
1. **Execute plan 0006** ([docs/plans/0006-profile-settings.md](../plans/0006-profile-settings.md)) — Approved, blockers resolved. **No migration / no secrets** (client-only). Build order per its Rollout:
   - Add reverse converters `cmToInches` / `kgToPounds` to
     [src/features/auth/lib/onboarding-form.ts](../../src/features/auth/lib/onboarding-form.ts)
     (exact inverses; UI rounds at the edge), plus the **unit-aware** height/weight
     validators (B2) shared with the wizard.
   - `src/features/auth/lib/use-profile.tsx` — plain hook `{ loading, profile, error,
     refetch }` with the `useOnboardingStatus` mounted/active guard (SF2).
   - `src/features/auth/lib/profile-form.ts` — `display_name` (≤80, empty→null) +
     timezone helpers only (reuse goals validators from `onboarding-form.ts`, **don't**
     duplicate — SF1).
   - `src/features/auth/screens/settings-screen.tsx` — 3 sections (Profile / Goals inline
     editor / Sign out), **independent** Save buttons (SF3). **Imperial B1 dirty-tracking
     is the subtle part — keep DB metric as source of truth, convert back only for edited
     fields.**
   - `src/app/(app)/profile.tsx` thin route; add Profile tab to **both**
     [app-tabs.tsx](../../src/components/app-tabs.tsx) (native — needs a PNG icon) and
     [app-tabs.web.tsx](../../src/components/app-tabs.web.tsx) (`href="/profile"`).
   - **Placeholder icon:** copy an existing `assets/images/tabIcons/*` set to
     `profile{,@2x,@3x}.png` so a native build doesn't break.
   - Strip the interim Sign out from [src/app/(app)/index.tsx](../../src/app/(app)/index.tsx)
     (remove the button + `useAuth` import; restore the plain template hero).
   - Verify on web (edit name → persists; toggle units → fields relabel/convert, edit
     weight → goals recompute & store metric; bad input blocked; Sign out; Home has no
     Sign out). Then commit straight to `main`.
2. **After 0006, S1 is complete.** Next module is whatever the roadmap puts after S1
   (camera / meal analysis / diary — own plans).

## Open questions / risks
- **Imperial state model (B1)** is the one tricky bit: store canonical metric, dirty-track
  edits, round only for display — otherwise saves drift the stored value. Plan spells it out.
- **Custom SMTP still needed** before signup-confirm + password-reset *emails* can be
  tested end-to-end (built-in sender caps ~2/hr → `over_email_send_rate_limit`). Code is
  correct; this is infra. Configure in Supabase → Auth → Emails → SMTP.
- A **future deep-link plan** still owes in-app confirm/reset completion (`expo-linking`);
  v1 completes those on Supabase's hosted pages.

## How to resume
Run `/session-start`. Node is via nvm — if `node`/`npm` are missing, `source ~/.zshrc`.
Work from `/Users/roham_abt/Desktop/calorie count` (quote the space). Build **sequentially
on `main`** (commit straight, no PRs). **Converse in Persian.**
