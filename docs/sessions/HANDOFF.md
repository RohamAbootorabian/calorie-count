# Handoff → Next Session

_Last updated: 2026-06-21 (session 7)_

## Where we are
**S1 (Auth & Onboarding) is COMPLETE.** All three pieces shipped to `main`:
piece 1 (auth screens, 0004), piece 2 (onboarding + TDEE, 0005), and now
**piece 3 — Profile & Settings (plan 0006) — executed, web-verified by hand, and
pushed** (commit `21bbd3f`). Tree clean, `tsc` + `lint` pass. Plans 0001–0006 all Done.

## What changed this session
- **Executed plan 0006 (Profile & Settings)** — a Profile tab → settings screen with three
  independent sections: profile (`display_name`/`units`/`timezone`), an inline daily-goals
  editor (recompute via `computeGoals` + upsert `goals`), and Sign out (moved off Home).
  Client-only — **no migration, no secrets**.
- Imperial display landed (deferred from 0005): **edit-override** state model keeps DB metric
  as the single source of truth, converts back only for edited fields (no drift, B1);
  unit-aware validators with inward-rounded bounds (B2).
- Stripped the interim Sign out from Home; added the Profile tab to both tab bars (native +
  placeholder PNG icon, web `href="/profile"`); extended `scripts/check-tdee.ts` with
  metric⇄imperial round-trip asserts.
- **Verified**: tsc + expo lint + check-tdee + web bundle export all green, **plus live
  hand-verification on web** (edit/persist, unit toggle/convert, recompute, bad-input block,
  sign out, Home clean, B1 no-drift). All passed.

## Next steps (pick up here)
1. **S1 is done — start the next roadmap module.** Likely camera / meal-capture or the
   meal-analysis pipeline (photo → Edge Function → Gemini → `MealAnalysis` → phone) or the
   diary. **Begin with `/plan <task>`** — no feature code before a plan + review (workflow is
   non-negotiable). Pick the module per the product roadmap.
2. Before building meal analysis, remember the **architecture rule**: the phone NEVER calls
   the AI provider directly — photo → Supabase Edge Function → Gemini 2.5 Flash → structured
   `MealAnalysis`. AI keys live ONLY in Edge Function secrets. `src/types/nutrition.ts` is the
   single source of truth for the meal data model.

## Open questions / risks
- **Custom SMTP still needed** before signup-confirm + password-reset *emails* can be tested
  end-to-end (built-in sender caps ~2/hr → `over_email_send_rate_limit`). Code is correct;
  this is infra. Configure in Supabase → Auth → Emails → SMTP.
- A **future deep-link plan** still owes in-app confirm/reset completion (`expo-linking`);
  v1 completes those on Supabase's hosted pages.
- **Placeholder Profile tab icon** (copied from explore) — real art is a later cosmetic task.

## How to resume
Run `/session-start`. Node is via nvm — if `node`/`npm` are missing, `source ~/.zshrc`.
Work from `/Users/roham_abt/Desktop/calorie count` (quote the space). Build **sequentially
on `main`** (commit straight, no PRs). **Converse in Persian.**
