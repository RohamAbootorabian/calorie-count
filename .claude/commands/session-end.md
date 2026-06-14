---
description: Wrap up the session — document, write handoff, commit & push
---

Close out this work session cleanly. The next session may have zero memory of what
happened here, so the documentation must stand on its own. Do ALL of the following:

1. **Journal.** Append a dated entry to `docs/JOURNAL.md`: what we did this session,
   key decisions and the *why* behind them, and any gotchas. Append only — never
   rewrite old entries.
2. **Handoff letter.** Rewrite `docs/sessions/HANDOFF.md` (shape: `docs/sessions/TEMPLATE.md`)
   as a clean letter to the next session: where we are, what changed this session,
   the exact next steps (with file paths + commands), open questions/risks, and how
   to resume. Keep it SHORT — current state only, not history.
3. **Plans.** Update the status/checklist/execution-log of any plan in `docs/plans/`
   we touched.
4. **Verify the tree is healthy.** Run `npx tsc --noEmit` (and `npm run lint` if
   quick). Note any failures in the handoff.
5. **Ship.** Stage everything, commit with a clear message (end with the
   `Co-Authored-By` trailer), and push to `main`.
6. **Summary.** Print what you committed + the handoff's "next steps" so I can eyeball it.

If `node`/`npm` aren't found, `source ~/.zshrc` first (nvm).
