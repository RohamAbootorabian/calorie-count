---
description: Write a review-ready plan doc for a feature or task
argument-hint: <feature or task description>
---

Create a plan document for this task: **$ARGUMENTS**

Process:
1. **Explore first — don't plan blind.** Read the relevant existing code, types,
   and any related plan/journal entries so the plan fits reality.
2. Copy `docs/plans/TEMPLATE.md` to `docs/plans/NNNN-<kebab-name>.md`, where NNNN
   is the next zero-padded number after the highest existing plan.
3. Fill **every** section concretely: problem/goal, non-goals, proposed approach,
   exact files to change, data-model/schema impact, edge cases & failure modes,
   test/verify plan, rollout, open questions.
4. Optimize for the **smallest change that fully solves the problem**. Call out
   anything uncertain in "Open questions" rather than guessing.
5. Leave the `## Review` and `## Execution log` sections untouched (filled later).
6. Do **NOT** write any feature code in this step.

Output: the plan file path + a 3-line summary, then remind me to run
`/review-plan docs/plans/NNNN-<name>.md`.
