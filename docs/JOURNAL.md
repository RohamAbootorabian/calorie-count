# Development Journal

Append-only log of what we built and **why**. Newest entries at the bottom.
For "where to pick up next", see [sessions/HANDOFF.md](sessions/HANDOFF.md).

---

## 2026-06-14 — Project kickoff & workflow setup

**What we did**
- Installed the toolchain from scratch: Node 24.16 via **nvm** (no Homebrew on the
  machine; nvm is user-space, no sudo, reversible).
- Scaffolded an **Expo SDK 56** app (React Native + TypeScript + expo-router) into
  the project root.
- Connected GitHub via **SSH** (generated an ed25519 key; HTTPS password auth is
  dead). Reconciled with the repo's auto-created initial commit via rebase.
- Added the architecture foundation:
  - `src/types/nutrition.ts` — the `MealAnalysis` domain model (single source of truth).
  - `src/lib/supabase.ts` + `src/lib/env.ts` — backend client + validated public env.
  - `src/services/analyzeMeal.ts` — client seam to the future `analyze-meal` Edge Function.
- Established the **development workflow & docs system** (this journal, plans,
  decisions, session handoffs) and the `/plan`, `/review-plan`, `/session-start`,
  `/session-end` commands.

**Key decisions & why**
- **Expo + Supabase + Claude vision** — fastest path to a cross-platform MVP; the
  one hard part (photo→nutrition) is best served by a multimodal LLM. See
  [decisions/0001-tech-stack.md](decisions/0001-tech-stack.md).
- **Phone never calls the AI directly** — keeps the API key off the device and lets
  us tune prompts without shipping an app update.
- **Plan → multi-agent review → execute** for every task, with documented session
  handoffs to survive limited per-session context. See
  [decisions/0002-development-workflow.md](decisions/0002-development-workflow.md).
- **Commit straight to main** (no PRs) — chosen for zero-friction solo dev; Claude
  owns all git operations.

**Gotchas for future sessions**
- Project path has a space: `/Users/roham_abt/Desktop/calorie count` — always quote it.
- Node is via nvm; if `node` is missing in a fresh shell, `source ~/.zshrc`.
