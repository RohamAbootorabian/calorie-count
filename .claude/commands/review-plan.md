---
description: Multi-agent adversarial review of a plan doc
argument-hint: <path to plan doc>
---

Run a balanced multi-agent review of the plan at: **$ARGUMENTS**

First read the plan yourself. Then launch these **four reviewers IN PARALLEL** as
subagents — all in a single message with multiple Agent tool calls so they run
concurrently. Give each the plan path and tell it to also read the relevant code.
Each reviewer returns a list of findings; every finding has a **severity
(BLOCKER / SHOULD-FIX / NIT)** and a **concrete suggested fix**.

- **Correctness & logic** — Will the approach actually work? Wrong assumptions,
  broken data flow, race conditions, off-by-one, missing error handling, does the
  plan's "done" actually solve the stated problem?
- **Architecture & simplicity** — Is this the simplest design that fits our existing
  patterns? Unnecessary complexity, missed reuse, over-engineering, or fighting the
  Expo/Supabase grain.
- **Edge cases & failure modes** — Empty/huge/malformed input, offline, slow network,
  partial failures, AI returning garbage or low-confidence data, auth missing.
- **Data & privacy** — Schema correctness, RLS/auth gaps, PII/health-data handling,
  secret leakage, runaway cost (API calls, storage).

After they return:
1. Consolidate and **dedupe** findings across reviewers.
2. Write them into the plan's `## Review` section, grouped by severity, each with
   its suggested resolution.
3. Give a verdict: **APPROVED** (no blockers) or **NEEDS CHANGES** (with blocker count).
4. If NEEDS CHANGES, propose the specific plan edits to clear each blocker — but do
   not implement feature code.
