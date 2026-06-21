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

---

## 2026-06-19 (session 3) — Step 3 shipped: navigation skeleton + auth provider

**What we did**
- Ran `/review-plan` on plan 0003 (4-lens multi-agent). Fact-checked the findings:
  dismissed 3 false alarms (complementary `Stack.Protected` guards can't both be
  false; `__DEV__` is compiled out by Metro, not shipped; the splash overlay sits
  *above* the native splash so there's no gap), resolved **1 real blocker** (temp
  form must not `signUp` against the single prod Supabase project) + 6 should-fixes,
  all folded back into the plan. Then **executed Step 3** with no deviations.
- Built `src/lib/auth/` (trunk): `AuthProvider` over the existing `supabase`
  singleton, `useAuth`/`useUser`, `signOut`; importable as `@/lib/auth`.
- Restructured routes into `(app)`/`(auth)` groups (`git mv`, history kept),
  rewrote root `_layout.tsx` with the `Stack.Protected` auth gate + brand-synced
  nav `ThemeProvider` + native-splash control. Added an `(auth)/sign-in` placeholder
  with a `__DEV__`-only temp sign-in to make the gate testable.
- Fixed the duplicated `null`-scheme bug in both `app-tabs` files via `useTheme()`.

**Key decisions & why**
- **`getSession()` wrapped in try/catch** so a corrupt AsyncStorage session can't
  hang the splash forever — always resolves `loading=false`. No artificial network
  timeout: `getSession()` is a local read, not a network call.
- **Token hygiene**: the provider never logs the `session` object (holds
  access/refresh tokens) — only `user.id` if needed.
- **`signInWithPassword`-only** in the temp form (no `signUp`) — the client points
  at the prod project, so test users are created manually in the dashboard.
- **`sign-in` pinned as the `(auth)` anchor** so the protected-redirect target is
  deterministic; S1 must keep the route name.

**Gotchas for next session**
- **Device/Expo Go verification is still pending** — tsc + lint are green but the
  gate hasn't been exercised on a device. Needs a test user in the Supabase
  dashboard. This run also carries plan 0002's deferred visual check (the temp
  sign-in screen now consumes `Screen`/`Text`/`Input`/`Button`).
- The temp `__DEV__` sign-in + the Home "Sign out (dev)" button are **throwaway** —
  S1 removes them when the real `src/features/auth/` screens land.
- Route groups regenerate `typedRoutes`; expect brief type churn on first
  `expo start` (tsc already passes against the current generated types).

## 2026-06-19 (session 3 cont.) — Step 3 web verification + SSR fix

**What we did**
- Tested the auth gate on web and **found a real bug**: with Expo's default
  `web.output: "static"` (Node SSR of the route tree), wiring `AuthProvider` into
  the root layout pulls the `supabase` client into SSR; it auto-inits AsyncStorage
  (web → `window.localStorage`) and crashes `ReferenceError: window is not defined`,
  killing the dev server.
- **Fix (deviation from plan):** `app.json` `web.output` `static` → `single` (SPA,
  client-only render). Idiomatic for a mobile-first app behind a login gate; native
  unaffected. Re-verified: clean boot (`Web Bundled` 1357 modules, HTTP 200, no
  runtime errors), and headless-Chrome render confirms the signed-out gate shows
  `(auth)/sign-in` (brand-green primitives) with no Home content. Also cleared
  plan 0002's deferred visual check.

**Blocked / next**
- **Signed-in flip not yet tested** — the Supabase project requires email
  confirmation, so a script-`signUp` user returns `email_not_confirmed` (no
  service-role key/inbox to confirm). Need a dashboard auto-confirmed user (or
  toggle off "Confirm email"), then test sign-in→tabs / persist / sign-out on web
  + Expo Go.
- Cleanup: a throwaway unconfirmed user `calorie.counter.s3test@gmail.com` exists
  in prod — delete or confirm.

## 2026-06-19 (session 3 wrap)
Session ended after shipping Step 3 + the web SSR fix (both pushed). Attempted
live device testing: web signed-out gate verified via headless Chrome; **Expo Go
phone testing deferred** — tunnel mode failed (ngrok "remote gone away" in this
env) and LAN QR wouldn't scan on the iPhone. Signed-in flip still blocked on a
confirmed Supabase user. Dev servers stopped, temp QR files cleaned up. Tree clean,
tsc + lint green. Next session picks up the deferred sign-in/persist/sign-out
verification once a confirmed test user exists.

---

## 2026-06-19 (session 4) — Step 3 closed + S1 piece 1 shipped: auth screens (plan 0004)

**What we did**
- **Closed Step 3:** the signed-in flip (sign-in → tabs → persist → sign-out) was
  verified on web with a confirmed Supabase test user — the last unproven part of
  Phase A. Phase A (the trunk) is now complete.
- Wrote → **multi-agent-reviewed** → executed **plan 0004 — auth screens** (S1
  piece 1). Built real sign-in / sign-up / forgot-password screens in
  `src/features/auth/` on `@/shared/ui`, wired through the existing `src/lib/auth`
  provider; replaced the temp `__DEV__` sign-in and renamed Home's `Sign out (dev)`
  → `Sign out` (interim until piece 3 Settings). One `auth-utils.ts` holds pure
  validators + a privacy-safe error mapper.

**Key decisions & why (review caught real issues before code)**
- **Anti-enumeration (B1):** never inspect the `signUp` response to detect an
  already-registered email (Supabase deliberately obfuscates it). Always show the
  same "check your email" state *with* an "Already have an account? Sign in" link so
  an existing user is never trapped.
- **Deep-link completion deferred (B2):** confirm + reset complete on Supabase's
  hosted pages in v1; the in-app set-new-password/confirm deep-link is **plan 0005**
  (both flows share the same `expo-linking` plumbing — wire once).
- **Email confirmation stays ON** (user decision) — safer for a health-data app.
- **Dismissed a false alarm:** two reviewers flagged `config.toml`
  `enable_confirmations = false` as contradicting the plan; `config.toml` is
  local-only, the client points at prod (confirmation ON), so the plan held.
- Mounted-ref guards on every post-`await` setState (the gate unmounts the screen
  on sign-in success); input errors clear on change; friendly errors have a generic
  fallback and never echo raw messages/tokens.

**Verification**
- `tsc` + `lint` clean; web bundle compiles clean; SPA boots HTTP 200.
- Verified on web: sign-in + persist + sign-out, wrong-password error, and
  email/password/confirm validation.
- **Not yet end-to-end:** signup-confirm + password-reset *emails* — blocked by
  Supabase's default email service (~2/hr cap), which surfaced as a correctly
  handled `over_email_send_rate_limit`. Infra, not code.

**Gotchas for future sessions**
- **Custom SMTP is required** before signup/reset can be tested at any volume (and
  for production) — Supabase's built-in email sender is rate-capped for testing
  only. Configure in Auth → Emails → SMTP, then re-verify the email flows.
- Adding routes regenerates `typedRoutes`; the first `tsc` after a new route file
  fails until `expo start` rebuilds `.expo/types/router.d.ts` (expected churn).
- Home's `Sign out` button is interim — piece 3 (Settings) moves it.

---

## 2026-06-19 (session 4 cont.) — Plan 0005 drafted + reviewed: onboarding + TDEE

**What we did**
- Wrote and **multi-agent-reviewed plan 0005 — onboarding wizard + TDEE** (S1 piece
  2). Status: **Approved, not yet executed.** 5 blockers resolved in-plan, all 5
  open questions decided.
- De-pinned the "plan 0005" forward-references in plan 0004 (the deep-link follow-up
  is now "a future deep-link plan" — 0005 is onboarding).

**Key decisions & why (review caught real issues before any code)**
- **Schema:** the `goals` table only stores *computed* targets — neither it nor
  `profiles` has age/sex/height/weight. **Decided: add the four raw inputs to
  `goals`** (they're the inputs that produced the targets; `goals` is 1-row/user;
  `profiles` stays identity/prefs). Migration uses **NaN-safe bounded `between`
  checks** (the plan-0001 lesson: Postgres `NaN >= 0` is true). No RLS change; no
  `DEFAULT auth.uid()` on `goals.user_id` (client supplies it; WITH CHECK is the
  boundary).
- **Routing gate:** extend the **trunk root gate** with a third `(onboarding)` route
  group + three complementary `Stack.Protected` guards (NOT a `<Redirect>` from
  inside `(app)`, which both crossed the trunk boundary and risked a tabs↔onboarding
  flash/loop). `useOnboardingStatus()` returns `{loading, needsOnboarding, error,
  refetch}`; loading→null, error→Retry, post-save→refetch.
- **TDEE math (pure `tdee.ts`):** Mifflin–St Jeor + activity multiplier; **clamp
  calories to a 1200 floor BEFORE computing macros**; carbs = remainder (floored ≥0)
  so `4P+9F+4C ≈ kcal` survives rounding. Guards throw on NaN/≤0.
- **Metric-only inputs for v1** (storage is always metric anyway; imperial display
  defers to piece 3 with units editing) — shrinks the piece with zero rework.
- **No test runner exists** → verify `tdee.ts` with a one-off `npx tsx` script of
  hand-computed reference cases rather than adding a framework now.

**Gotchas for next session**
- Executing 0005 touches the **prod DB** (migration needs `SUPABASE_DB_PASSWORD`) +
  regenerates `database.ts` — a heavier, multi-part change. Start it fresh.
- We stopped before executing 0005 deliberately (session was ~70% context).

---

## 2026-06-19 (session 5) — Executed plan 0005: onboarding wizard + TDEE (S1 piece 2)

**What we did**
Built and shipped the first-run onboarding wizard end to end. A signed-in user with
no `goals` row is now routed into a 5-step wizard (About → Body → Activity → Goal →
Review), which computes daily calorie + macro targets (Mifflin–St Jeor) and upserts
the `goals` row; afterwards they go straight to the tabs. Migration applied to prod,
types regenerated, verified (tsc/lint/web bundle + tdee reference checks), manual web
walkthrough confirmed by the user. Plan 0005 → Done.

**Key decisions & why**
- **TDEE math is a pure module** (`tdee.ts`) with a strict order — clamp calories to a
  1200 floor *before* macros, carbs absorbs all rounding — so `4P+9F+4C ≈ kcal` and
  nothing goes negative/NaN. Verified with a one-off `npx tsx` reference script (19
  assertions) rather than adding a test framework (OQ5).
- **Raw body inputs live on `goals`** (age/sex/height_cm/weight_kg), nullable, bounded
  `between` checks (NaN-safe, plan-0001 lesson). They're the inputs that produced the
  targets, so piece 3 can recompute without re-asking. No RLS change; client supplies
  `user_id` (no `DEFAULT auth.uid()` on `goals`).
- **Three-state root gate** (B1): a third `(onboarding)` route group with three
  complementary `Stack.Protected` guards in the trunk root layout. Loading → null
  (splash); signed-in + goals-check error → full-screen Retry (never auto-route into
  onboarding → no duplicate-row risk).

**Deviations from the plan (logged in 0005's Execution log)**
- `useOnboardingStatus` became a **context provider + hook** (file is `.tsx`), so the
  wizard and the gate share ONE instance — that's the only way the wizard's `refetch()`
  can flip the gate after Save (a per-component hook couldn't). Same contract.
- The status outcome is **keyed to `(userId, reloadKey)`** instead of loose `useState`s.
  Required to satisfy `react-hooks/set-state-in-effect` (no synchronous setState in an
  effect body); as a bonus it makes user-switch read as loading (never a stale answer)
  and Retry show loading rather than the stale error.

**Gotchas for next session**
- Selection controls (sex/activity/goal) are `Button` rows, not a new primitive (SF3) —
  if piece 3 needs a real radio/segmented control, that's a deliberate later extraction.
- `scripts/check-tdee.ts` is the de-facto test for the formula. Re-run it
  (`npx tsx scripts/check-tdee.ts`) before tuning the macro split / multipliers.
- The wizard is **metric-only** in v1; imperial display + units editing land in piece 3
  (the `inchesToCm`/`poundsToKg` helpers in `onboarding-form.ts` are already there).

---

## 2026-06-21 (session 6) — Plan 0006 drafted + reviewed: Profile & Settings (S1 piece 3)

**What we did**
Wrote and **multi-agent-reviewed plan 0006 — Profile & Settings** (S1 piece 3, the
piece that closes S1). Status: **Approved, not yet executed.** 2 blockers resolved
in-plan, 8 should-fixes folded in, all 5 open questions decided. No code written.

**Scope of 0006:** a Profile tab → settings screen that (1) edits the profile
(`display_name`/`units`/`timezone` on `profiles`), (2) views + inline-edits daily goals
by recomputing TDEE from the stored raw body inputs on `goals` (reusing `tdee.ts` +
`onboarding-form.ts`), and (3) houses Sign out (moved off Home). **No migration** — every
column already exists (plan 0001 + 0005). Imperial *display* (deferred in 0005) lands here.

**Key decisions & why (review caught real issues before any code)**
- **Imperial round-trip safety (B1):** the goals editor keeps the **DB metric values as
  the single source of truth**; fields display converted/rounded values; on Save it
  converts back to metric **only for fields the user actually edited** (dirty-tracking) —
  unedited fields persist the stored metric verbatim. Without this, every save drifted the
  canonical value (`cmToInches(180)→inchesToCm→179.91`). Display rounding happens only at
  the UI edge; `cmToInches`/`kgToPounds` are exact inverses.
- **Unit-aware validation (B2):** validators run in the **active display units** with
  bounds + copy converted from the metric bounds (a metric-only "between 50 and 272 cm"
  message on an inches field is wrong); unit toggle clears field errors so bounds always
  match what's shown.
- **Reuse, don't duplicate (SF1):** goals validators/options come from `onboarding-form.ts`
  (shared with the wizard); `profile-form.ts` holds only profile concerns. **`use-profile`
  stays a plain hook** (rejected the "make it context" note — only one consumer, unlike
  `useOnboardingStatus`), but copies the mounted/active lifecycle guard.
- **Decided open questions:** third Profile tab + **placeholder icon** (native tab needs a
  PNG or the build breaks); imperial = **single inch/lb fields** (no ft+in); **inline**
  goals editor (not a wizard re-run); timezone = **read-only + "use device"**;
  `display_name` **optional** (empty→null).
- **Saves are independent per section** (Save profile / Save goals), not atomic; omit
  `updated_at` (trigger owns it); goals upsert must write a **complete** body-input set.

**Gotchas for next session**
- Executing 0006 is **client-only** (no DB/secret/migration) — lighter than 0005, but the
  imperial state model (B1 dirty-tracking) is the subtle part; get that right first.
- The native **Profile tab icon** must exist before a native build — copy an existing
  `assets/images/tabIcons/*` set to `profile{,@2x,@3x}.png` as a placeholder (web tabs are
  text-only, so web verification won't catch a missing icon).
- We stopped before executing 0006 deliberately (session was ~72% context). Plan 0005
  (onboarding+TDEE) already shipped to `main` earlier this session arc (commit eec70de).
