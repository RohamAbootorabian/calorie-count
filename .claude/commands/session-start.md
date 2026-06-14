---
description: Onboard into the project at the start of a session
---

You are starting a fresh work session on Calorie Counter. Load the project state
before doing anything else. Read, in order:

1. `CLAUDE.md` and `docs/WORKFLOW.md` — the rules and process.
2. `docs/sessions/HANDOFF.md` — where the last session left off.
3. The last ~40 lines of `docs/JOURNAL.md` — recent decisions and why.
4. Run `git log --oneline -10` and `git status -sb` — the actual repo state.
5. List `docs/plans/` and read any plan whose status is not `Done`.

Then give me a tight onboarding briefing:
- **Where we are** — 2–3 sentences on current state.
- **Last handoff's next steps** — the concrete actions queued from HANDOFF.md.
- **Open plans** — any in-progress plans + status, or "none".
- **Health check** — is the tree clean? does `npx tsc --noEmit` pass? (run it).
- **Proposed next action** — what you'd do next and why.

Do **not** start writing code until I confirm the direction.
