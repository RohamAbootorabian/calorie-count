# Development Workflow

This is how we build Calorie Counter. The goal: **nothing gets coded before it's
planned and reviewed**, and **every session is fully documented** so the next one
(human or AI, with limited context) can pick up instantly.

## The per-task pipeline

Every feature or task — however small — follows these five steps:

```
  1. PLAN  →  2. REVIEW  →  3. EXECUTE  →  4. VERIFY  →  5. DOCUMENT & SHIP
```

### 1. Plan — `/plan <task>`
Explore the relevant code, then write a plan doc in `docs/plans/NNNN-<name>.md`
from [the template](plans/TEMPLATE.md). It must state the problem, the approach,
files to change, schema impact, edge cases, and how we'll verify. **No feature
code is written in this step.**

### 2. Review — `/review-plan <doc>`
A **balanced multi-agent review** (run in parallel) tears the plan apart from
four lenses:
- **Correctness & logic** — will it actually work? wrong assumptions, bad data flow.
- **Architecture & simplicity** — is this the simplest design that fits our patterns?
- **Edge cases & failure modes** — bad input, offline, slow network, AI returns garbage.
- **Data & privacy** — schema/RLS/auth correctness, health-data handling, secret/cost leaks.

Findings land in the plan's `## Review` section, graded **blocker / should-fix /
nit**. **Every blocker must be resolved** (plan edited) before execution. Re-run
review if the plan changed materially.

### 3. Execute
Implement **strictly per the approved plan**. If reality diverges (a wrong
assumption, a missing case), **stop**, update the plan and its `## Execution log`
with what changed and why, then continue. The plan is a living record, not a
throwaway.

### 4. Verify
`npx tsc --noEmit`, lint, and — for anything user-facing — actually run the app
(Expo Go) and confirm the behavior. Don't claim done on green types alone.

### 5. Document & ship
Append a `docs/JOURNAL.md` entry (what changed + the *why* behind decisions),
mark the plan `Done`, then **commit straight to `main` and push**. Claude owns
all git — the user never has to.

## Session lifecycle

Context is limited per session, so we treat start/end as first-class rituals.

### `/session-start`
Loads the project state: `CLAUDE.md`, `docs/sessions/HANDOFF.md`, the tail of
`docs/JOURNAL.md`, `git log`/`status`, and any open plans. Produces an onboarding
briefing + proposes the next action. **It does not start coding** until you confirm.

### `/session-end`
Updates `docs/JOURNAL.md`, rewrites `docs/sessions/HANDOFF.md` as a clean **letter
to the next session** (where we are, what changed, exact next steps, risks, how to
resume), updates active plans, verifies the tree, then commits + pushes.

## The docs map

| File | Purpose | Updated |
|---|---|---|
| `CLAUDE.md` | The constitution — always loaded into context | rarely |
| `docs/WORKFLOW.md` | This process | rarely |
| `docs/JOURNAL.md` | Chronological log of what we did + **why** | every task/session |
| `docs/decisions/` | ADRs for significant, lasting choices | per big decision |
| `docs/plans/` | Per-task plan + review + execution record | per task |
| `docs/sessions/HANDOFF.md` | The latest "where to pick up" letter | every session end |

**Journal vs. Handoff:** the journal is the *full history* (append-only, never
rewritten). The handoff is *only the latest state* (rewritten each session) — kept
short so the next session reads it in seconds.
