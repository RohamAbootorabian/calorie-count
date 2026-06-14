# ADR 0002 — Development workflow & session continuity

- **Status**: Accepted
- **Date**: 2026-06-14

## Context
We want a smooth, low-bug development process where the user does as little manual
work as possible, and where the limited per-session context of an AI assistant
doesn't cause lost knowledge or repeated mistakes.

## Decision
1. **Plan → Review → Execute for every task.** Each feature gets a plan doc
   (`docs/plans/`), which passes a **balanced multi-agent review** (correctness,
   architecture, edge cases, data/privacy) before any code is written. Blockers
   must be resolved first.
2. **Documented session lifecycle.** `/session-start` onboards from the handoff +
   journal; `/session-end` writes the journal entry and a clean handoff letter,
   then commits + pushes.
3. **Two records, two jobs.** `docs/JOURNAL.md` is the append-only full history
   (decisions + why). `docs/sessions/HANDOFF.md` is the always-current, short
   "where to pick up" letter.
4. **Claude owns git.** Commit straight to `main` and push; the user shouldn't run
   git. (No PRs — chosen for zero-friction solo development.)

## Why
- Planning + adversarial review catches design bugs before they cost execution time.
- Explicit handoffs make limited context a non-issue: any new session reconstructs
  state from `HANDOFF.md` + `JOURNAL.md` in seconds.
- Separating journal (history) from handoff (current state) keeps onboarding fast.

## Consequences
- Slightly more up-front ceremony per task — justified by fewer execution bugs and
  zero lost context between sessions.
- Discipline required: if execution diverges from the plan, the plan must be updated
  (not silently abandoned).

## Revisit if
- The ceremony slows tiny changes too much (we may add a "trivial change" fast lane).
- We add collaborators (we'd likely switch to feature branches + PRs).
