@AGENTS.md

# Calorie Counter — Project Guide

Snap a meal photo → calories, macros (protein/carbs/fat), quality nutrients
(sugar, salt, fiber), and a **food-quality score**. Stack: Expo (React Native) +
TypeScript + Supabase + Gemini 2.5 Flash (vision). See [README.md](README.md) for the
product overview and [docs/WORKFLOW.md](docs/WORKFLOW.md) for how we work.

## Start every session
Run `/session-start` (or read [docs/sessions/HANDOFF.md](docs/sessions/HANDOFF.md))
to load where the last session left off.

## End every session
Run `/session-end` to document the journey, write the handoff letter for the
next session, and push.

## Session health (every message)
End **every** reply with a one-line **Session health** footer so the user knows
when to wrap before context fills:

`Session health: 🟢/🟡/🔴 ~NN% of 1M context · <short note>`

- 🟢 `<50%` — plenty of runway, keep going.
- 🟡 `50–75%` — start wrapping up the current task; finish the thread, don't begin large new work.
- 🔴 `>75%` — recommend the user run `/session-end` now so nothing is lost.

The percentage is an **estimate** (the model can't read its exact token count).
For an exact figure the user can run the built-in `/context` command.

## The development workflow (non-negotiable)
Every feature or task — however small — goes through this pipeline. Never skip to code.
1. **Plan** — `/plan <task>` writes a plan doc in `docs/plans/`. No feature code before a plan exists.
2. **Review** — `/review-plan <doc>` runs a multi-agent review. Resolve every blocker before coding.
3. **Execute** — implement strictly per the approved plan. If reality diverges, STOP, update the plan, note why, then continue.
4. **Verify** — typecheck / lint / run the app before claiming done.
5. **Document & ship** — append to `docs/JOURNAL.md` (what + why), then commit + push.

## Git
- **Commit straight to `main` and push.** No PRs.
- **Claude owns all git operations** — the user should never need to run git themselves.
- End every commit message with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

## Architecture rules
- The phone **NEVER** calls the AI provider directly. Photo → Supabase Edge Function → Gemini 2.5 Flash → structured `MealAnalysis` → phone. AI keys live ONLY in Edge Function secrets.
- [src/types/nutrition.ts](src/types/nutrition.ts) is the single source of truth for the meal data model. Schema and UI derive from it.
- Public env only in `.env` (`EXPO_PUBLIC_*`). Real secrets are never committed.

## Toolchain
- Node is installed via **nvm**. If `node`/`npm` aren't found in a fresh shell, run `source ~/.zshrc` first.
- Run all commands from the project root: `/Users/roham_abt/Desktop/calorie count` (note the space in the path — quote it).
