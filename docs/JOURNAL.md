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

---

## 2026-06-19 — Step 1 done: database schema + RLS (plan 0001)

**What we did**
- Chose **Gemini 2.5 Flash** as the vision model (≈7–35× cheaper than Claude for
  this workload, strong vision, free dev tier). Updated CLAUDE.md's stack line.
- Set up the parallel-work docs (`MODULES.md`, `ARCHITECTURE.md`, an S1 brief) then
  **dropped the parallel-session approach** — we build sequentially in one session,
  back to commit-straight-to-`main`. Those docs remain as the feature roadmap.
- Added the **session-health footer** rule to CLAUDE.md.
- Wrote, **multi-agent-reviewed**, and executed **plan 0001** (schema + RLS):
  - 4 tables (`profiles`, `goals`, `meal_logs`, `meal_items`) mirroring
    `src/types/nutrition.ts`, a private `meal-photos` bucket, triggers, and
    per-verb RLS — pushed to the linked Supabase project and verified live.
  - Generated `src/types/database.ts`.

**Key decisions & why**
- **Review caught real bugs before any SQL:** missing `WITH CHECK` on RLS writes
  (cross-user write hole), unpinned `search_path` on the SECURITY DEFINER trigger,
  a dropped `quality_factors` column, and a storage-path id-ordering problem. All
  fixed in the revised plan.
- **NaN guard:** Postgres `numeric` treats `NaN = NaN` as TRUE and `NaN > all`, so
  `>= 0` alone accepts NaN. Used bounded ranges (`between 0 and MAX`) instead.
- **Bucket via SQL, not config.toml:** `db push` deploys SQL to the remote; a
  config.toml bucket only affects local `supabase start`.

**Gotchas for future sessions**
- `supabase db push` / `gen types` need the **DB password** (Supabase → Settings →
  Database; not displayable, only resettable). Pass via `SUPABASE_DB_PASSWORD` env var.
- The full two-user RLS proof is deferred to the Auth feature (needs real users);
  anon default-deny is already verified.

---

## 2026-06-19 — Step 2 done: design system `src/shared/ui` (plan 0002)

**What we did**
- Wrote → multi-agent-reviewed → executed **plan 0002** (design system). Reuse
  over replace: kept the template's `theme.ts`/`useTheme`/`ThemedText`/`ThemedView`
  as the foundation, **added** semantic tokens (`primary`/`primaryText`/`border`/
  `danger`, green brand confirmed by the user) + a `Radius` scale, and built a thin
  `src/shared/ui/` layer: **Button**, **Card**, **Input**, **Screen**, **Text**,
  exposed via one barrel `@/shared/ui`. No new deps, no schema impact.

**Key decisions & why (review caught real bugs before any code)**
- **`useTheme` was silently broken:** it guarded `'unspecified'` but
  `useColorScheme()` can return `null`/`'unspecified'`; the whole "theme-aware"
  goal rested on it. Fixed to `scheme === 'dark' ? 'dark' : 'light'`.
- **Keyboard avoidance baked into `Screen`:** auth/onboarding (next module) has
  inputs low on the page; `Screen` now wraps `KeyboardAvoidingView` so every form
  inherits it instead of re-solving inconsistently.
- **Tab inset is opt-in (`tabBarInset`, default false):** auth/onboarding live
  *outside* the tab navigator — always applying `BottomTabInset` gave 50–80px of
  phantom dead space.
- **Button trimmed** to 3 variants (deferred destructive/size/leftIcon) + an
  in-flight double-tap guard (prevents double sign-in/save) + fixed spinner slot.
- **Input sensitive-field hygiene:** secure fields default autocorrect/autocaps/
  spellcheck OFF, forward `textContentType`/`autoComplete`, web `-webkit-autofill`
  override; never logs its value; a11y from `label` only. React-19 ref-as-prop.

**Gotchas for future sessions**
- `expo lint` had never run — this session set it up (`eslint.config.js` + eslint
  deps). The one pre-existing template error (`set-state-in-effect` hydration in
  `use-color-scheme.web.ts`) is suppressed with a scoped disable; new code is clean.
- **Visual Expo Go check is still pending** — typecheck + lint are green but no
  primitive has been rendered on a device yet. Do a quick visual pass when S1's
  first auth screen consumes `@/shared/ui` (no throwaway gallery was shipped).
- `components/themed-*` stay the canonical typography impls; `shared/ui` is the
  public surface — don't duplicate them.

---

## 2026-06-19 (session 2 wrap) — Step 3 planned (plan 0003)

**What we did**
- Shipped **Step 2** earlier this session (design system — see the entry above;
  committed + pushed).
- Wrote **plan 0003 — Navigation skeleton + auth provider** (Phase A, Step 3). Not
  yet reviewed or executed. Grounded the auth-gate design in the **Expo SDK 56
  docs**: the idiomatic pattern is `Stack.Protected guard={…}` with a
  `SessionProvider` at the root + `(app)`/`(auth)` route groups.
- **Decided to stop before executing Step 3** to start it with a fresh context —
  the route restructure + provider + multi-agent review is a large chunk and the
  session was past ~60% context.

**Key decisions & why**
- **Auth provider/hook live in the trunk (`src/lib/auth/`), not in a feature.** The
  gate, provider, and `useUser` are shared infrastructure; S1 only builds the auth
  *screens* on top. Keeps the boundary clean (matches ARCHITECTURE.md).
- **`Stack.Protected` over manual redirects.** Declarative guard is the SDK-53+
  recommended pattern and avoids race-y `useRouter().replace` effects.
- **Temp `__DEV__` sign-in only.** To make the gate testable without building S1's
  screens, plan 0003 ships a throwaway `__DEV__`-gated sign-in on the `(auth)`
  placeholder — explicitly removed when S1 lands.
- Plan also folds in the **deferred review item from 0002** (sync expo-router
  ThemeProvider to the green brand) and fixes the **same `null`-scheme color bug**
  still present in both `app-tabs` files.

**Gotchas for next session**
- Plan 0003 is **Draft** — must run `/review-plan` and resolve blockers BEFORE any
  code (non-negotiable workflow).
- Route restructure moves `src/app/index.tsx`/`explore.tsx` into `src/app/(app)/`;
  `typedRoutes` will regenerate — expect a brief type churn on first `expo start`.
