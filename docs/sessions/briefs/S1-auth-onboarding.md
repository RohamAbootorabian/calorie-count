# Session brief — S1 · Auth & Onboarding

Hand this to a fresh Claude session working in this repo. It is the self-contained
kickoff prompt for the S1 module. See [../../ARCHITECTURE.md](../../ARCHITECTURE.md)
and [../../MODULES.md](../../MODULES.md) for the bigger picture.

---

You are taking ownership of the **S1 · Auth & Onboarding** module of the Calorie
Counter app (Expo + TypeScript + Supabase). Converse with the user in **Persian
(Farsi)**. End every reply with the `Session health` footer (see CLAUDE.md).

## Step 0 — Onboard before doing anything
Run `/session-start`, then read: `CLAUDE.md`, `docs/WORKFLOW.md`, `docs/MODULES.md`,
`docs/ARCHITECTURE.md`, `docs/plans/0001-database-schema-rls.md`, and
`src/types/nutrition.ts`.

## Step 1 — Dependency gate (do NOT skip)
S1 depends on the **Phase A trunk**. Before writing any feature code, verify the
trunk is merged on `main`:
- DB migrations exist in `supabase/migrations/` and are applied (schema has
  `profiles` + `goals`).
- An auth **provider + `useUser` hook** exists in `src/lib/` (e.g. `src/lib/auth`).
- A **design system** exists in `src/shared/ui/` (Button/Card/Input/Screen + theme).
- A **navigation skeleton** with an auth gate exists in `src/app/`.

If any of these is missing, **STOP and tell the user "Phase A isn't ready yet"** —
do not build on a missing foundation. List exactly what's missing.

## Your boundary (ownership)
- **Create/edit only inside `src/features/auth/`.**
- **Use but never modify** shared code: `src/lib/` (supabase client + auth
  provider/`useUser`), `src/shared/ui/` (design system), `src/types/`. If you
  genuinely need a change there, STOP and flag it for the trunk owner — don't edit it.
- Tables you own: **`profiles`** and **`goals`** (RLS already restricts to the
  signed-in user — never bypass it).

## Scope — build exactly this
1. **Auth screens** (Supabase Auth, email + password): sign up, log in, log out,
   password reset. Wire session state through the shared auth provider.
2. **Onboarding wizard** (first run after sign up): collect age, sex, height,
   weight, activity level, and goal (`lose`/`maintain`/`gain`); compute daily
   calorie + macro targets via a TDEE formula; write to the `goals` table. Write a
   `profiles` row if the trunk's signup trigger didn't already.
3. **Profile & Settings:** view/edit display name + units, edit goals, sign out.
   (Account deletion is optional — flag it if you add it.)

## Out of scope
Camera, meal analysis, diary, trends, charts — those are other sessions. Don't
touch their folders or build their screens.

## How to work (non-negotiable workflow)
For each piece above: `/plan <piece>` → `/review-plan <doc>` (resolve blockers) →
implement strictly to the approved plan → verify (`npx tsc --noEmit` + run in Expo
Go) → append to `docs/JOURNAL.md`.

## Git
Work on a branch **`feat/auth`** and open a small PR per piece (while modules run
in parallel we do NOT commit straight to `main`). You own all git operations.

## Constraints / gotchas
- **Expo SDK 56** — read https://docs.expo.dev/versions/v56.0.0/ before writing code.
- Secrets: only `EXPO_PUBLIC_*` values in `.env`; never commit real secrets.
- The phone never calls any AI provider directly (not relevant to S1, but the rule stands).
- Node is via nvm — if `node`/`npm` are missing, `source ~/.zshrc`. Run commands
  from the project root `/Users/roham_abt/Desktop/calorie count` (quote the space).

Start with **Step 0**, then the **dependency gate**, then propose your first `/plan`.
