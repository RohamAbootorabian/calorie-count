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

---

## 2026-06-21 (session 7) — Executed plan 0006: Profile & Settings (S1 piece 3 → **S1 complete**)

**What we did**
Executed the approved plan 0006. New **Profile** tab → settings screen with three
independent sections: (1) **Profile** — `display_name` / `units` (metric⇄imperial) /
`timezone` (read-only + "use device"); (2) **Daily goals** — inline editor that recomputes
calories + macros via the existing `computeGoals` and upserts `goals`; (3) **Sign out**
(moved off Home). Client-only: **no migration, no secrets** — every column already existed.
This **closes S1 (Auth & Onboarding)**.

**Files**: NEW `src/features/auth/screens/settings-screen.tsx`, `lib/use-profile.tsx`,
`lib/profile-form.ts`, `src/app/(app)/profile.tsx`, placeholder `assets/images/tabIcons/
profile{,@2x,@3x}.png` (copied from explore). EDITED `lib/onboarding-form.ts` (+reverse
converters `cmToInches`/`kgToPounds`, `Units`, unit-aware `validateHeight`/`validateWeight`,
display/metric helpers, exported `parseNumber`), both `app-tabs{,.web}.tsx` (+Profile tab),
`app/(app)/index.tsx` (stripped interim Sign out), `scripts/check-tdee.ts` (+round-trip asserts).

**Key decisions & why**
- **Imperial round-trip safety (B1) via an "edit override" model.** `canonicalBody` (the DB
  metric) is the single source of truth. `heightEdit`/`weightEdit` are null until the user
  types — null ⇒ the field DISPLAYS `canonical→active-units` derived **in render** (not via a
  setState-in-effect, which the lint rules forbid). On save we convert back to metric ONLY
  for edited fields; unedited fields persist canonical verbatim, so a save never drifts the
  stored value. A unit toggle / save resets the overrides → display re-derives. Same B1
  guarantee as the plan, lint-clean. Round-trip asserts now pin the exact-inverse converters.
- **Unit-aware validation (B2):** validators run in the shown units with bounds rounded
  INWARD (min up / max down) so a value within the quoted range always passes and a rejected
  value is always truly out of range; a unit toggle clears height/weight errors.
- **Reuse over duplication (SF1):** goal validators/options/`computeGoals` come from the
  shared onboarding modules; `profile-form.ts` holds only `display_name`/timezone concerns.
- **Independent per-section saves (SF3)**; profile save is an `upsert` (self-heals a missing
  row); neither write sends `updated_at` (trigger owns it, SF5); goals upsert writes a
  COMPLETE body-input set (SF6). `user.id` always from `useUser()` (N5).

**Deviations (same contract — see plan execution log)**
- Added a local `useGoalsRow` hook in the screen (plan only specced `use-profile`); goals
  still need loading, kept local to the single consumer with the same guard pattern.
- B1 via edit-override (above) instead of the plan's setState-in-effect deriver.
- Profile `upsert` instead of `update`; extended check-tdee; regenerated typed routes for
  the new `/profile` route (expected piece-1/2 churn).

**Verification**: `tsc` clean · `expo lint` clean · `check-tdee.ts` all-pass (incl. new
round-trip cases) · `expo export --platform web` bundled with no errors. **Live web
behavioral verification PASSED** (login → edit name persists across reload → toggle units
relabel/convert → edit weight + save goals recompute, DB stores metric → toggle back → bad
input blocked → sign out → Home clean → B1 no-drift on toggle-without-edit). Confirmed by hand.

**S1 is now complete.** Next module is whatever the roadmap puts after S1 (camera / meal
analysis / diary), each with its own plan.

---

## 2026-06-21 (session 7, cont.) — Drafted + reviewed plan 0007: Capture & upload (S2 piece 1)

**What we did**
With S1 closed, opened **S2 (Capture & AI Analysis)** — the product core. Sliced S2 into
three pieces (1: capture+upload · 2: `analyze-meal` Edge Function + Gemini · 3: editable
results + save to `meal_logs`/`meal_items`) and **wrote + multi-agent-reviewed plan 0007**
for piece 1. Status: **Approved, not yet executed.** No feature code written.

**Scope of 0007:** signed-in user takes/picks a meal photo (`expo-image-picker`, SDK 56),
previews it, uploads to the existing private `meal-photos/{uid}/…` Storage bucket, returns
the path. **No AI, no DB write, no migration** — the bucket + per-user-folder RLS already
exist from plan 0001 (verified). New `src/features/capture/` module + a 4th Capture tab.

**Key decisions & why (review caught real robustness gaps before any code)**
- **Architecture & Data lenses found zero blockers** — bucket is genuinely private, and the
  path `${uid}/${name}` correctly satisfies the RLS `(storage.foldername(name))[1] =
  auth.uid()` (RLS enforced server-side against the JWT, so a spoofed uid fails WITH CHECK).
- **3 blockers, all about uploading real images, resolved in-plan:**
  - **B1 — jpeg/png + correct contentType (iOS HEIC):** reject any non-jpeg/png mime
    client-side *before* upload; derive the extension from the resolved mime (never hardcode
    `.jpg`). Bucket allows only jpeg/png; HEIC bytes or a mislabeled contentType would either
    be rejected at insert or poison piece 2's Gemini call. `expo-image-manipulator` re-encode
    deferred to native hardening — the client reject is the guard.
  - **B2 — native byte path + 0-byte guard:** `fetch(uri).arrayBuffer()` is reliable on web
    but flaky on some Android builds; assert `byteLength > 0` regardless of platform so a bad
    read fails loudly instead of creating a 0-byte orphan. "Done" gated on **web** only;
    base64 (`base64-arraybuffer` `decode()`) is a named native follow-up.
  - **B3 — retry semantics:** helper returns a typed error `kind`
    (`too_large`/`unsupported`/`unauthorized`/`network`/`unknown`); the screen offers a bare
    retry only for transient kinds, and for permanent kinds tells the user what to change. A
    deterministic mime/size rejection must not trap the user re-uploading identical bytes.
- **10 should-fixes folded in:** persist bucket-relative `data.path` (not `fullPath`, SF1);
  read uid from the session inside the helper, hard-fail if not a uuid (SF2); collision-proof
  `randomUUID` filename (SF3); typed/sanitized errors reusing S1's `saveErrorMessage` 401/403
  mapping, no PII logged (SF4); picker returns a discriminated union, iOS `limited` counts as
  usable (SF5); `quality:0.7` is best-effort not the size guard — check `fileSize` (SF6);
  `AbortController` upload timeout (SF7); mounted-ref lives locally in the screen (SF8); orphan
  cleanup + delete-cascade-to-Storage + privacy-policy line are tracked obligations for a later
  piece (SF9); short signed-URL TTL, never `getPublicUrl` (SF10).

**Gotchas for next session**
- **`expo-image-picker` is NOT installed** — first execute step is `npx expo install
  expo-image-picker` + add its config plugin (iOS permission strings) to `app.json`.
- New `/capture` route will need typed-routes regeneration (run the dev server once — the
  piece-1/2 lesson, same as plan 0006's `/profile`).
- Watch the project's two lint rules during execution: no ref read in render, no setState
  synchronously in an effect (both bit us in plan 0006).
- The data starts accruing real health-data photos here — SF9's cleanup/deletion/privacy
  obligations are logged in 0007 OQ6 so they're owned, not forgotten.

---

## Session 8 — 2026-06-22 · Execute plan 0007 (Capture & upload, S2 piece 1)

**What:** Built the first link of the product core — a signed-in user can take **or** pick a
meal photo, preview it, and upload it to the private `meal-photos/{uid}/…` Storage bucket,
getting back the stored object **path**. No AI, no DB write (pieces 2 and 3). New
`src/features/capture/` module + a 4th **Capture** tab.

**How (per the approved plan):**
- `expo-image-picker` installed via `expo install` (SDK 56) + config plugin with iOS
  permission strings in `app.json`.
- `pick-photo.ts` — permissioned `takePhoto()`/`pickFromLibrary()` returning a discriminated
  union (`ok`/`cancelled`/`denied`); `mediaTypes:['images']`; iOS/Android `limited` access
  counts as usable.
- `upload-meal-photo.ts` — `uploadMealPhoto({ photo })`: uid read from the session + uuid
  hard-fail (SF2); jpeg/png **mime allowlist** with the extension derived from the resolved
  mime (B1); `fileSize` pre-check (SF6); collision-proof `${uid}/${Date.now()}-${rand}.<ext>`
  path (SF3); **0-byte guard** after `fetch().arrayBuffer()` (B2); typed error `kind`
  (`too_large`/`unsupported`/`unauthorized`/`network`/`unknown`, B3); never logs uri/path/bytes
  (SF4).
- `capture-screen.tsx` — pick → preview (`expo-image`) → upload; **Retry only for transient
  kinds** (B3); per-source denial hints; local `mounted` ref for post-await setState (SF8).
- `(app)/capture.tsx` thin route; Capture tab added to **both** `app-tabs.tsx` (native, with a
  placeholder `capture*.png` icon copied from explore) and `app-tabs.web.tsx`
  (`href="/capture"`). Typed routes regenerated by running the dev server once (the 0006
  `/profile` lesson).

**Why the two deviations (WORKFLOW step 3):**
- **SF7 AbortController → timeout race.** The installed `@supabase/storage-js` exposes `signal`
  only on `FetchParameters`, **not** on `upload()`'s `FileOptions` — so the upload can't be
  aborted by a signal in this version. Kept SF7's intent (no infinite spinner) by racing the
  upload against a 45 s timer → a stall surfaces as a transient `network` error with Retry. The
  in-flight request isn't truly cancelled; a timed-out upload may leave an orphan object, already
  owned by the SF9 cleanup obligation.
- **Filename** uses `${Date.now()}-${rand}` (the plan's named SF3 alternative) instead of
  `crypto.randomUUID()` — no UUID dep installed and `crypto.randomUUID` isn't on RN/Hermes.

**Verify:** `npx tsc --noEmit` ✅ · `npx expo lint` ✅ (exit 0) · web bundle compiles ✅ with the
screen, both helpers, and `expo-image-picker` all included. **Web click-through verification is
pending the user** (signed-in session + Supabase Storage browser), then it gets marked PASSED in a
follow-up commit — same gate-then-confirm flow as plan 0006. Next: piece 2 (`analyze-meal` Edge
Function, Gemini 2.5 Flash).

---

## Session 8 (cont.) — 2026-06-22 · Plan 0008 drafted + reviewed (analyze-meal, S2 piece 2)

**What:** After executing/pushing plan 0007 and handing its web verification to the user (web
smoke-tested; on-device camera + native byte path deferred to a later session, saved to
memory), we **planned S2 piece 2** — the `analyze-meal` Edge Function — and ran a 4-lens
multi-agent review. **Status: Approved, NOT executed.** No feature code written.

**Scope of 0008:** a Supabase Edge Function (Deno) that authenticates the caller, confirms they
own the stored photo path **via RLS** (download with the user-scoped client, never service-
role), downloads the bytes, calls **Gemini 2.5 Flash** (vision, structured `responseSchema`),
validates/coerces the JSON into a `MealAnalysis` (per `src/types/nutrition.ts`), and returns it.
The phone NEVER calls Gemini; the key is an Edge Function secret. No `meal_logs` write (piece 3);
a minimal read-only result card on the Capture screen is the verify surface.

**Review — 6 blockers, all resolved in-plan (why they mattered):**
- **B1 — error contract:** `supabase.functions.invoke` wraps any non-2xx in `FunctionsHttpError`
  with `data=null`, hiding our typed `kind`. Resolution: the function **always returns HTTP 200**
  with `{ ok, kind }` so the client reads `data` directly and the retry logic works.
- **B2 — `expo lint` fails on Deno code:** ESLint flat config doesn't read `tsconfig.exclude`;
  must add `supabase/**` to `eslint.config.js` `ignores` (the plan had only guarded `tsc`).
- **B3 — Gemini robustness:** `finishReason: MAX_TOKENS` gives truncated JSON; empty/SAFETY
  candidates throw `TypeError`. Resolution: check `finishReason !== STOP` + null-guard the whole
  chain → `bad_ai_response`; raise `maxOutputTokens`.
- **B4 — timeouts:** three layers were unreconciled and the client had none. Resolution: dual
  server AbortControllers (download ~15s / Gemini ~30s) + client `withTimeout` ~35s.
- **B5 — privacy:** the free Gemini tier may retain/train on images (health data). Resolution:
  pin the **paid/Vertex tier** + a tracked privacy-policy obligation.
- **B6 — cost:** `verify_jwt` stops anon abuse, not an authenticated loop against a paid API.
  Resolution: a crude **per-user/day cap** (`analyze_usage` table + `rate_limited`) — adds the
  one small migration in this piece.
- **Should-fixes folded:** `coerceNum` + re-clamp recomputed totals to the totals' DB ranges
  (item caps don't bound the sum), default `dishName`, collapse not-owned/missing → `not_found`,
  distinct `429`/`rate_limited` + bounded `bad_ai_response` retry, isolated analyze screen state,
  explicit log allow/deny list, CORS pinned to known origins, Deno 2 idioms. All 7 open questions
  decided.

**Gotchas for next session (execution of 0008):**
- The `tsconfig exclude:["supabase"]` AND `eslint ignores:["supabase/**"]` must land **first**,
  before any Deno file, or `tsc`/`expo lint` break on Deno globals/imports.
- Gemini `responseSchema` is a JSON-Schema **subset** (no `$ref`, keep flat) — confirm the
  nested `items[].nutrients` shape is accepted or flatten it.
- Confirm the **paid Gemini tier** before sending real photos; set `GEMINI_API_KEY` via
  `supabase secrets set` (server-only, NOT in `.env.example`).
- Postgres accepts `NaN` under `>= 0` checks — coercion MUST strip NaN before piece 3's insert.
- **Plan 0007 web verification is still open** (user to click through pick→upload→Storage), and
  the iPhone camera/native-byte test is deferred (see memory `capture-deferred-camera-test`).

### Session 8 close — 2026-06-22 · Plan 0007 web-verified → Done
User ran the web click-through for plan 0007 (Capture & upload) and confirmed it: pick →
preview → upload → the object landed under the user's own `meal-photos/{uid}/…` folder in the
Supabase Storage browser; cancel and bad/oversized paths showed friendly copy. **Plan 0007 →
Done** (commit `ea85ca0`). The iPhone real-camera "Take photo" + native byte path (B2/OQ2) and
the N4 web "Take photo" relabel remain knowingly deferred (memory `capture-deferred-camera-test`).
**S2 status:** piece 1 Done & web-verified; piece 2 (`analyze-meal`, plan 0008) Approved, not
executed — next session executes it.

### Session 9 — 2026-06-22 · Execute plan 0008 (analyze-meal Edge Function, S2 piece 2) — code complete, deploy deferred on B5
Executed plan 0008 strictly per the approved doc. All code for piece 2 is written and passes
every local gate — `npx tsc --noEmit`, `npx expo lint`, and `deno check` are green — and the
`analyze_usage` daily-cap migration is **pushed to the remote DB**. The phone→Edge→Gemini
round-trip is fully wired but **not deployed and not web-verified**: the user confirmed only a
**free Gemini tier**, and B5 forbids sending real (health-adjacent) meal photos to the free tier
(retention/training risk). Code is committed so nothing is lost; the plan is **not marked Done**
until billing is enabled and the web round-trip is verified.

**Landed:** tooling guards (`tsconfig exclude:["supabase"]`, eslint `ignores:["supabase/**"]`);
`_shared/cors.ts` (origins pinned, not `*`); migration `20260622120000_analyze_usage.sql` (table
+ owner-only RLS + tamper-proof `bump_analyze_usage` rpc, cap **N=50**, **db push** applied);
the function `meal-analysis.ts`/`gemini.ts`/`index.ts` (always-200 typed contract, `getUser()`
anon gate, RLS download as authorization, dual download/Gemini timeouts, `coerceNum`+clamps
pinned to DB literals, recomputed+re-clamped totals, `finishReason`/null guards, `no_food`,
bounded retry, logging allow/deny list); `config.toml` `verify_jwt = true`; client helper
`analyze-meal.ts`; and the Capture **Analyze** step + read-only result card (own state, re-pick
race guard, bounded MAX-3 retry).

**Why (key decisions):** *why not deploy* — B5: free tier may retain/train on health photos, so
no real-photo path until paid billing. *why esm.sh for supabase-js* — `jsr:` pulls an npm
sub-dep `deno check` can't resolve without `node_modules`; esm.sh bundles the graph as ESM so
both the typecheck and the edge runtime are happy. *why cap charged just before the Gemini call*
(not at raw entry) — a foreign-path probe fails the RLS download (no Gemini spend) and shouldn't
burn the user's daily quota; the cost gate still bounds every paid call. *why Deno installed* —
the Supabase CLI ships no standalone `deno`/`check`, so Deno 2.8.3 was installed (official script;
backs up `.zshrc`) purely to typecheck the function. **N=50/day** and **CORS = Expo web dev
origins** chosen at execution (prod origin left as a TODO in `cors.ts`).

**Next session:** enable paid Gemini billing → `supabase secrets set GEMINI_API_KEY=…` (+
`supabase/.env.local`) → `supabase functions serve` negative/positive matrix → `supabase
functions deploy analyze-meal --project-ref vldpfoczswakghkrkyrm` → web end-to-end verify (the
Done gate) → mark plan 0008 Done. Then piece 3 (editable results + save to `meal_logs`/`meal_items`).

### Session 9 (cont.) — 2026-06-23 · Provider switch: Gemini → OpenAI (GPT-4o vision)
Mid-execution of plan 0008 the user chose to switch the AI provider from Gemini to **OpenAI**,
because they already hold an OpenAI account **with billing/credit**. This is a clean win, not just
convenience: OpenAI's **API doesn't train on submitted data by default**, which resolves B5 (the
free-Gemini-tier privacy risk) without any "which tier?" footgun; and OpenAI **Structured Outputs**
use a strict standard JSON Schema that supports nesting, retiring the open `responseSchema`-
flattening question. Blast radius was contained because the Edge boundary was already provider-
agnostic: only `gemini.ts → openai.ts`, the response-schema *format* (`GEMINI_RESPONSE_SCHEMA →
OPENAI_RESPONSE_SCHEMA`, strict: every prop required + `additionalProperties:false`, `quality`
nullable), the secret name (`GEMINI_API_KEY → OPENAI_API_KEY`), and the CLAUDE.md stack line
changed. `index.ts` (auth/RLS/timeouts/always-200), `meal-analysis.ts` coercion/clamps, the
migration, the client helper, and the Capture screen are unchanged. Model: `gpt-4o-mini` (cheap;
bump to `gpt-4o` if quality is weak). Plan 0008 Execution log updated with the divergence + why.
All gates green (tsc, expo lint, deno check). **Deploy + web verify are now un-blocked** — next:
set `OPENAI_API_KEY` secret → deploy → verify on web → mark plan Done.

### Session 9 close — 2026-06-23 · Plan 0008 DEPLOYED + web-verified → DONE
Set the `OPENAI_API_KEY` secret, deployed `analyze-meal`, and **verified the full round-trip on
web**: a real meal photo returned "Grilled Fish with Rice and Soda" (medium confidence, quality
70/100, 1000 kcal / 65 P / 91 C / 35 F, 3 items) in the read-only card. **Plan 0008 → Done.**
The core architecture rule is now live end-to-end: phone → Edge Function → OpenAI vision →
structured `MealAnalysis` → phone; the AI key is an Edge secret, never on the device.

**One real bug found & fixed during verification — CORS allow-headers.** The first web attempt
failed with a fast `network` error. `supabase.functions.invoke` sends `x-client-info` (+
`x-supabase-api-version`) from the browser, and a preflight blocks unless `Access-Control-Allow-
Headers` lists every requested header; `_shared/cors.ts` had only `authorization/apikey/content-
type`. Diagnosed by probing the deployed function directly (healthy preflight + healthy anon-JWT
POST ruled out a crash/origin issue), then added the two headers and redeployed. **Lesson for
future browser-facing functions:** allow the supabase-js client headers, not just the obvious three.

**S2 status:** piece 1 (capture+upload) Done; **piece 2 (analyze-meal) Done & web-verified**.
Next session: **piece 3** — editable results UI + persist to `meal_logs`/`meal_items` (the insert
relies on this piece's coercion/clamps + NaN-stripping). Tracked obligations still open: privacy
policy must disclose meal photos + nutrition go to **OpenAI**; 0007 SF9 storage-lifecycle/orphan
cleanup. CORS prod origin is still a TODO in `cors.ts` (only Expo web dev origins allowed today).

### Session 9 (cont.) — 2026-06-23 · Plan 0009 (meal review & save, S2 piece 3) drafted + reviewed + Approved
With plan 0008 Done and verified, drafted **plan 0009** (review/edit the AI analysis → atomically save
one `meal_logs` + N `meal_items` rows) and ran the 4-lens multi-agent review. **3 blockers, all
resolved in-plan; Approved, not executed.**

- **B1 — RPC SQL wouldn't run:** jsonb needs `->>` + explicit casts, and `with ordinality` needs an
  alias. Folded the spelled-out parent/child inserts into the plan.
- **B2 — the RPC is the security boundary, not the client.** It's `SECURITY INVOKER` and directly
  callable with crafted jsonb, so it now reads an explicit **column allowlist**, sets
  `user_id:=auth.uid()` / `verified:=true` / `meal_log_id` / `position` as **server literals** (never
  from the payload), validates `image_path`'s first segment `= auth.uid()`, and guards item count `1..50`.
- **B3 — `image_path` UNIQUE conflict broke the lost-ack retry** (a committed-but-unacked save would
  show an error on retry). Made the save **idempotent**: `on conflict (image_path) do nothing` → return
  the existing owned row's id as success.
- **Should-fixes folded:** RPC `withTimeout` (20 s → `network`); error mapping **by `PostgrestError.code`
  only, never logging message/details** (PII); totals **reject (not silently clamp)** when over a DB cap
  so `total ≠ sum(items)` can't be stored; `recomputeTotals` on the shared `sumNutrients`; `MealReview`
  lives at `screens/meal-review.tsx` (no new `components/` dir) and is `key`ed by `uploadedPath` for
  re-pick-mid-save teardown; `quality_score` rounded to int + null-safe optional fields.
- **Dismissed "blocker":** `.rpc('create_meal_log')` won't typecheck — false; `src/lib/supabase.ts`
  builds the client **without** the `<Database>` generic (untyped), so `.rpc` returns `any` and compiles.
  We cast the result; no type regen needed. (Typing the client is a possible future cleanup.)

Decided all 6 open questions: edit headline cals+macros only (carry the rest); `eaten_at` defaults
`now()`; RPC (not client two-step); reset-to-capture after save; keep the unique constraint + idempotent
RPC; persist quality/assumptions read-only. **Gotcha for execution:** an empty-`search_path` resolution
failure only surfaces when the RPC is actually *called* (not on `db push`) — the verify plan calls it as
a signed-in user.

### Session 10 — 2026-06-23 · Plan 0009 executed & web-verified — meal review/save (S2 piece 3) DONE
Executed plan 0009 as written; **S2 (Capture & AI Analysis) is now complete end-to-end** — a user can
shoot a meal, analyze it, **correct the estimate, and persist it** as an owned, queryable record.

- **`create_meal_log` RPC** (migration `20260623132156`, `db push`ed) is the atomic, idempotent,
  self-validating save: `SECURITY INVOKER` + `search_path=''` so RLS applies; parent + children in one
  transaction (no orphan on partial failure); reads an explicit **column allowlist** and sets
  `user_id/verified/meal_log_id/position` as server literals (crafted jsonb can't smuggle them);
  validates `image_path` lives in the caller's `${uid}/…` namespace; guards item count `1..50`;
  idempotent `on conflict (image_path) do nothing` → returns the existing owned id so a lost-ack retry
  reads as success, not a `unique_violation` dead-end.
- **Client:** `meal-form.ts` (pure model — string-typed editable numerics, DB-mirroring validators on
  the shared `parseNumber`, `recomputeTotals` on `sumNutrients`, `toSavePayload` recomputing totals so
  `total = sum(items)`); `save-meal.ts` (`withTimeout` 20 s; maps **by `PostgrestError.code` only** and
  logs **only the typed kind** — `message/details` can echo health PII); `meal-review.tsx` (editable
  card, live totals + over-cap reject, inline field errors gating Save, `conflict`→**Saved ✓**).
- **Why an RPC, not two client inserts:** a client "insert log → insert items" leaves an orphan parent
  if the items insert fails midway and costs two round-trips. The RPC makes it atomic + halves latency,
  and `SECURITY INVOKER` keeps RLS as the authorization (no service-role) — consistent with analyze.
- **Two small execution deviations (logged in the plan):** `supabase.rpc()` returns a thenable builder,
  not a Promise, so the `withTimeout` race needed a `Promise.resolve(...)` wrap to typecheck (runtime
  unchanged); and two transitively-used imports were dropped from `meal-review.tsx`. Neither altered the
  design. **Verify:** `tsc` + `expo lint` clean; user web-verified the full edit→remove→Save→Saved flow.
- **Tracked obligations unchanged & still open:** privacy policy must disclose meal photos + nutrition
  go to **OpenAI**; CORS prod origin TODO in `_shared/cors.ts`; 0007 SF9 storage orphan cleanup; custom
  SMTP. **Carry-through drift** (edited macros vs carried sugar/fiber) is the named v1 follow-up.

**Next: S3** — a meals history/list + day totals reading the `meal_logs`/`meal_items` rows this piece
now writes.

### Session 10 (cont.) — 2026-06-23 · Plan 0010 executed & web-verified — in-app privacy policy DONE
Closed the highest-risk privacy gap: the app sends meal photos + nutrition to **OpenAI** and stores
health-adjacent data in Supabase with previously **zero disclosure**. Shipped an in-app privacy policy.

- **`/privacy` route** — content authored as **data** (`src/features/legal/privacy-content.ts`),
  rendered by a flat presentational screen (no `lib/`/`screens/` ceremony — review trimmed the extra
  feature dir). Registered as an **unguarded `<Stack.Screen>`** sibling of the three `Stack.Protected`
  groups in `_layout.tsx`, so it's reachable **both signed-out** (from sign-up) **and signed-in** (from
  Settings); `headerShown:true` gives a themed back chevron.
- **Three entry points:** a sign-up agreement line, a Settings "Legal" link, and a Capture
  **point-of-processing notice** ("uploaded and sent to OpenAI…") shown before the photo leaves the
  device (it leaves at Upload→Supabase, again at Analyze→OpenAI).
- **Review caught two real copy-accuracy blockers** (the whole point of an adversarial pass on a legal
  doc): (B1) the "what we collect" list was incomplete — and a reviewer's claim that "no body-metric
  columns exist" was **investigated and proven false** (`20260619192848_goals_body_inputs.sql` stores
  age/sex/height/weight), so the fix was to *expand* the list, not trim it; (B2) deletion was
  over-promised — there is **no self-serve delete**, no account-deletion flow, and a row delete does
  **not** remove the Storage photo file, so the policy now routes deletion through email and never
  implies a button that doesn't exist. Also folded: OpenAI "no-training" claim **attributed +
  date-anchored** (not self-guaranteed), generic Supabase region, "share only with OpenAI/Supabase"
  (not an unqualified no-share), and `<Screen scroll>` **without** `tabBarInset` (root screen, no tabs).
- **Decision — notice over a persisted consent gate for v1**, affirmed by the data/privacy lens: food
  photos are health-*adjacent*, not GDPR Art. 9 special-category per se, so prominent + pre-action
  notice + signup agreement is defensible under GDPR/CCPA and meets Apple/Google disclosure
  expectations. A `profiles.privacy_accepted_at` modal stays the named escalation if a store reviewer
  requires it. **Verify:** tsc + lint clean; user web-verified reachability (incl. cold deep-link +
  sign-out-while-open), the capture notice across states, outbound links, and the themed header.

**Tracked obligations now:** public hosted-URL mirror moves with the CORS prod origin when a prod domain
lands; 0007 SF9 photo-orphan cleanup + a real self-serve/account-deletion flow are separate follow-ups
(the policy promises email-based deletion until they ship); custom SMTP; carry-through drift (0009).

### Session 10 close — 2026-06-24 · Plan 0011 (orphan photo cleanup) drafted + reviewed → NEEDS CHANGES
Tackled tracked obligation #3 (0007 SF9: orphan meal photos accumulate forever — uploaded but never
saved to a `meal_logs.image_path` row). User chose the **two-layer** strategy: client delete-on-abandon
+ a scheduled server sweep backstop. Drafted plan 0011 and ran the 4-lens review.

- **Verdict: NEEDS CHANGES — 4 blockers, NOT yet resolved in-plan** (recorded in the plan's `## Review`
  with concrete resolutions; this is a real Layer-2 redesign, unlike 0009/0010's copy fixes):
  - **B1 (client guard fails open):** the `savedPath`/`onSaved` signal is gated behind `mounted.current`
    and lost when `MealReview` unmounts (sign-out / re-pick remount) after the save commits → a later
    abandon deletes a genuinely saved photo. Fix: mark "do-not-delete" at **save initiation**, lifted to
    the parent — never delete a path Save was even started for.
  - **B2 (sweep nukes the bucket):** a degraded/empty `select image_path from meal_logs` read makes every
    object look orphaned → service-role mass-delete. Fix: **fail-closed** on query error, per-folder
    containment, a delete circuit-breaker (abort if > cap/% of scanned), and an **observe-only first
    rollout**.
  - **B3 (secret leak):** Vault secret baked into `cron.job.command` / echoed in `pg_net` tables. Fix:
    read it as a **live Vault subquery inside the stored cron command**; verify no plaintext in
    `cron.job`/`net._http_response`.
  - **B4 (5 new infra primitives):** Edge Function is justified — raw `delete from storage.objects` does
    NOT reclaim the S3 blob, so the Storage API `.remove()` is required — but confirm pg_cron/pg_net
    enable on this project first, drop the Vault entry for the (non-secret) function URL, and keep a
    dashboard-Cron / GitHub-Action fallback.
- **Key should-fixes to fold:** raise grace to **72 h** + save tolerates a vanished blob; **re-check
  `meal_logs` immediately before `.remove()`** (TOCTOU) + single-run lock; **page the top-level folder
  list** (not just per-folder); pin `image_path` ↔ `{uid}/{name}` byte-identical; one
  `maybeDeleteAbandoned()` helper + drop the redundant fresh-pick hook; rate-limit the
  `verify_jwt=false` endpoint; inspect `.remove()` partial results.
- **Why not resolved-in-plan this session:** context budget (~75%) + the redesign depth warrant a fresh
  session. Next session folds B1–B4 + should-fixes into the approach, re-confirms the Layer-2 safety
  design, then executes (Layer 1 first — it's safe, small, and de-risks the headline guard).

**Session 10 net:** shipped plans **0009** (meal review/save → S2 complete) and **0010** (in-app privacy
policy) end-to-end; drafted + reviewed **0011** (left at NEEDS CHANGES for next session).

### Session 11 — 2026-06-24 · Plan 0011 folded → APPROVED; Layer 1 (client delete-on-abandon) shipped
Resumed plan 0011 (orphan meal-photo cleanup). Two units of work this session.

**1. Folded the review into the plan body (NEEDS CHANGES → APPROVED).** The 4 blockers + should-fixes
were woven into approach / data-model / edge-cases / verify / rollout with `(resolves Bn)` / `(SF)`
markers (not just left in `## Review`):
- **B1** — record do-not-delete at save **initiation**, not on the success ack (an unmount between RPC
  commit and ack would otherwise lose the mark and let a later abandon delete a genuinely saved photo).
- **B2** — the sweep must fail **closed**: abort on a degraded `image_path` read, per-folder containment,
  a delete circuit-breaker (cap/% of scanned), and an observe-only (`DRY_RUN`) first run.
- **B3** — the cron command reads the secret as a **live Vault subquery**, never a baked literal, so
  `cron.job.command` / `pg_net` never hold plaintext.
- **B4** — the Edge Function is justified (raw `delete from storage.objects` does NOT reclaim the S3
  blob → Storage API `.remove()` required) but must be confirmed empirically; the function URL is not a
  secret (inline, no Vault entry); confirm pg_cron/pg_net enable before the migration.
- Should-fixes folded: grace 24h → **72h** + save tolerates a vanished blob; TOCTOU re-check before
  `.remove()` + single-run lock; page BOTH `list('')` and each `list('{uid}')`; byte-identical key
  match; one `maybeDeleteAbandoned()` helper; self rate-limit; inspect `.remove()` partials.

**2. Built + shipped Layer 1 (client delete-on-abandon).**
- NEW `src/features/capture/lib/delete-meal-photo.ts` — best-effort `deleteMealPhoto(path): Promise<void>`,
  never throws/blocks, message-only logging (no PII), uses the existing owner-scoped DELETE policy.
- EDIT `meal-review.tsx` — new `onSaving?(path)` prop fired the instant the save RPC is dispatched (B1).
- EDIT `capture-screen.tsx` — `savedPath` ref + a single guarded `maybeDeleteAbandoned(prior)` helper.
- **Deviation from the planned hook sites (documented in the plan's Execution log).** The plan named
  `handleUpload` (re-upload) + `chooseAnother`. Reality: the two pick buttons stay enabled after upload,
  so a **fresh pick** while an uploaded-unsaved path exists is a real abandon — and `applyPickOutcome`
  clears `uploadedPath` without deleting; meanwhile `handleUpload` never sees a prior path (it's already
  nulled) → that hook was dead code. Corrected to **`applyPickOutcome` + `chooseAnother`**.
- **Verified:** tsc PASS; expo lint clean; web bundle builds. **User web-verified** cases 1–3: Choose
  another deletes the orphan; re-pick deletes A and keeps B; **Save → Log another keeps the saved photo**
  (the B1 guard holds). **Layer 1 DONE.**

**Next:** Layer 2 (scheduled server sweep) — confirm pg_cron/pg_net + the blob-reclaim premise, then
build the fail-closed `cleanup-orphans` Edge Function + the Vault-subquery cron migration.

### Session 11 (cont.) — 2026-06-24 · Plan 0011 Layer 2 (server sweep) code-complete, pre-deploy
Continued in the same session: pre-flight fact-checks + built Layer 2 (not deployed — stopped at a
clean checkpoint with context ~70%, user chose to defer the production deploy to a fresh session).

**Pre-flight fact-checks (empirical, via Management API — no destructive ops):**
- **pg_cron / pg_net** are AVAILABLE on this project (not yet installed): pg_cron 1.6.4, pg_net 0.20.3.
  → the migration's `create extension if not exists` will enable them; no external-scheduler fallback.
- **Raw `delete from storage.objects` is BLOCKED**, not just blob-leaking: `storage.objects` has a
  `BEFORE DELETE` trigger `protect_objects_delete` → `storage.protect_delete()` that raises `42501
  'Direct deletion from storage tables is not allowed. Use the Storage API instead.'` unless the GUC
  `storage.allow_delete_query='true'` is set. Its own hint: "This prevents accidental data loss from
  orphaned objects." → **the Edge Function + Storage API `.remove()` is mandatory (B4); the
  SECURITY-DEFINER-collapse alternative is ruled out.** (Structural proof from the trigger; no test
  object created.)

**Built Layer 2 (deno check + lint clean — same URL-import convention as analyze-meal):**
- `supabase/functions/cleanup-orphans/index.ts` — service-role sweep that fails CLOSED: aborts on a
  degraded saved-paths read (B2), per-folder containment, pages BOTH `list('')` and each `list('{uid}')`,
  byte-identical `{uid}/{name}` match, grace **72h** with fail-safe KEEP on bad/missing timestamps,
  circuit-breaker (abort if would delete > 500 or > 50% of scanned), **DRY_RUN default ON** (observe-only
  first cycle), TOCTOU re-check before each `.remove()` batch, per-batch result inspection, count-only logs.
- `supabase/migrations/20260624140000_schedule_orphan_cleanup.sql` — pg_cron + pg_net; a `cleanup_run`
  one-row table + SECURITY DEFINER `claim_cleanup_run` (single-run lock + rate-limit, mirrors
  `analyze_usage`, granted service_role only); idempotent daily cron (`17 3 * * *`) whose command reads
  the secret as a **live Vault subquery** (B3) — function URL inlined, not Vaulted (B4).
- `supabase/config.toml` — `[functions.cleanup-orphans] verify_jwt = false`.

**Why deploy was deferred:** a production deploy (generate ≥256-bit secret → Edge `CLEANUP_SECRET` +
`CLEANUP_DRY_RUN=true` + Vault `cleanup_secret` → `functions deploy` → migration → observe-only verify) is
real production work; at ~70% context the safe call was to checkpoint the code (commit 09b1896) and deploy
next session with a fresh budget. DRY_RUN-default makes the eventual deploy safe (deletes nothing until
proven).

**Session 11 net:** plan 0011 folded NEEDS CHANGES → APPROVED; **Layer 1 SHIPPED + web-verified**
(commit aa83c54); **Layer 2 code-complete, pre-deploy** (commit 09b1896, unpushed until this session-end).

### Session 12 — 2026-06-24 · Plan 0011 Layer 2 DEPLOYED + VERIFIED → DONE
Deployed the scheduled server sweep to production and ran the full verify matrix. All steps
non-interactive (Supabase CLI access token from the macOS keychain; Vault + verification SQL via the
Management API `database/query` endpoint; project ref `vldpfoczswakghkrkyrm`).

**Ordering divergence (WORKFLOW step 3):** the plan put the migration last, but the function calls
`rpc('claim_cleanup_run')` and that RPC + the `cleanup_run` table are created by this migration — so the
function can't clear its own rate-limit claim until the migration is applied. Applied order:
**secrets+Vault → migration → function deploy → verify**. The migration's cron is harmless before
verification (DRY_RUN on; fires 03:17 UTC, not during the test).

**What shipped:**
- 256-bit secret (`openssl rand -hex 32`) → Edge `CLEANUP_SECRET` + `CLEANUP_DRY_RUN=true` and the SAME
  value into Vault `cleanup_secret` (atomic, never printed). `db push` enabled pg_cron 1.6.4 + pg_net
  0.20.3, seeded `cleanup_run` at epoch, created `claim_cleanup_run` (service_role-only), and the daily
  cron `cleanup-orphans-daily` (`17 3 * * *`) whose command holds only the Vault subquery ref (B3 ✓).
  `functions deploy cleanup-orphans` (cloud build).

**Verified:**
- Observe-only (DRY_RUN on): correct secret → `{dryRun:true,scanned:11,orphaned:0,deleted:0}`; rapid
  repeat → **429**; wrong/missing secret → **401**.
- Live (DRY_RUN false): planted a synthetic orphan `_sweeptest/old-orphan.jpg` (service-role upload,
  `created_at` backdated — UPDATE allowed, only DELETE is trigger-blocked) → invoke →
  `{dryRun:false,scanned:12,orphaned:1,deleted:1}`; the orphan is **gone** (blob reclaimed via
  `.remove()`), a known saved photo **survives** (byte-identical `{uid}/{name}` match).
- Real cron path (case 8): ran the EXACT cron `net.http_post` (live Vault-subquery header) →
  `net._http_response` status **200**; **0** plaintext-secret rows in `net._http_*`, request queue
  drained, `cron.job.command` is reference-only. The 03:17 UTC tick will populate `cron.job_run_details`
  on its next fire; the identical command path is proven working.

**Why this is Done:** every destructive guard exercised end-to-end (fail-closed read, rate-limit/claim,
circuit-breaker thresholds in code, byte-identical match, TOCTOU re-check, count-only logging). DRY_RUN
is now **live**; the cron is armed. **Plan 0011 DONE; 0007 SF9 (orphan storage lifecycle) closed.**
Secret hygiene: rotate the Edge secret + Vault entry together. Remaining tracked obligations unchanged.

### Session 12 (cont.) — 2026-06-24 · Plan 0012 meal history + delete-meal flow → DONE
Picked the next tracked obligation (the delete-meal flow / 0011 NIT). Discovered there was **no meal
history surface at all** — Home/Explore were still Expo starter screens and `meal_logs` was never read
back. The user chose "history list + delete in one plan."

**Plan + review:** wrote plan 0012; the 4-lens review returned **2 blockers**, both *missed surfaces*
(not design flaws): (B1) the route rename `explore→history` forgot `app-tabs.web.tsx` (hardcoded
`href="/explore"`) → web nav would break; (B2) shipping in-app delete contradicts the published privacy
policy, which states "there is NO self-serve delete." The headline should-fix — **drop the optimistic
`removeLocal`/`restoreLocal` hook mutators for plain await-then-refetch** — also dissolved a cluster of
rollback/sign-out edge cases. All folded → Approved.

**Built (no design deviation):** a new `history` feature — `useMealHistory` (owner-scoped, newest-first,
`limit(100)`, `Pick<>` column allowlist, `useProfile` lifecycle discipline), `deleteMeal` (owner-scoped
row delete + `meal_items` cascade + best-effort `deleteMealPhoto` reusing the 0011 helper; 15 s timeout;
idempotent — `ok` iff `error === null`; typed-kind errors; no-PII logging), and a History screen
(`FlatList`; await-then-refetch delete with confirm; in-flight `Set<id>` gating both dialog and call;
`Alert.alert` native / `window.confirm` web; pull-to-refresh + web Refresh button; "100 most recent"
notice). Repurposed the throwaway Explore tab → History (renamed route + **both** tab files, B1).
Updated `privacy-content.ts` to disclose in-app per-meal deletion (B2).

**Why no backend work:** the `meal_logs_delete` RLS policy (`auth.uid() = user_id`) and the
`meal_items … on delete cascade` already existed; deletion needed zero migration.

**Verified:** `npx tsc --noEmit` PASS; `npx expo lint` clean; web bundle compiles (HTTP 200); **user
web-verified** the full flow in a logged-in browser. **Plan 0012 DONE.** Follow-ups still open: photo
thumbnails (signed URLs), pagination past 100, meal **edit**, daily totals/dashboard, account/bulk
self-serve deletion (still email-routed), real-device pass, real tab art.

### Session 12 close — 2026-06-24
Net: **two full plans shipped** — 0011 Layer 2 (orphan-cleanup sweep deployed + verified in production;
DRY_RUN now live, cron armed) and 0012 (meal History list + delete-meal flow, user web-verified). The app
gained its first `meal_logs` READ surface (History tab, repurposed from the starter Explore tab) and a
self-serve per-meal delete (row + cascade + best-effort photo removal). No open plans; tree clean; tsc +
lint green; all pushed. Next session starts a fresh `/plan` (candidates in HANDOFF: thumbnails, dashboard,
meal edit, pagination, real-device pass).

### Session 13 — 2026-06-24 · Plan 0013 History photo thumbnails → DONE
Picked the natural fast-follow to 0012 (HANDOFF candidate 1): show each saved meal's
photo in the History list. The `meal-photos` bucket is **private**, so a row's
`image_path` isn't directly loadable — this is the project's **first
`createSignedUrl(s)` integration**, the pattern Daily-totals/Meal-edit will reuse.

**Plan + review:** wrote plan 0013; the 4-lens review surfaced **5 blockers** —
(B1) exact `createSignedUrls` result shape + the `error:null / signedUrl:null` trap;
(B2) no timeout on the mint (every sibling helper has one); (B3) empty-array call
guard; (B4) the verify plan over-claimed `expo-image` `cacheKey` on **web** (web
ignores it — `<img src=uri>`, caches by URL); (B5) *assumed* a Storage SELECT policy.
The data reviewer **verified B5 away**: `meal_photos_select` already exists
(`20260619102510_initial_schema.sql:222`) — signing authorizes against SELECT (a
*distinct* policy from 0011's DELETE), so no migration. The headline should-fix
**dissolved the design**: drop the ref-backed expiry cache + `REFRESH_MARGIN_MS`
(and its inverted/units-mixed math) for **mint-on-set-change** — `cacheKey` already
makes the bytes survive URL rotation on native, so per-URL expiry tracking bought
nothing. All folded → Approved.

**Built (no design deviation):** `useSignedThumbnails(meals)` — derived state over
the 0012 `MealCard[]` (never queries `meal_logs`); one batch `createSignedUrls(paths,
3600)` for the distinct non-null paths (never per-row), empty-guard, 30 s
`withTimeout`, exact result handling (write only `error==null && path && signedUrl`),
URL map in `useState` **keyed to `userId`** (a fast user-switch can't surface user
A's URLs), **retry-on-Refresh** (effect deps `[userId, paths]`; `paths` gets a fresh
identity each refetch so a failed/offline mint re-attempts, while a steady re-render
mints nothing), **404 negative-cache** via `reportError`, and in-memory-only +
no-path/url logging (a signed URL is a bearer token for a private health photo; TTL
locked at 1 h). History screen: `MealRow` now `React.memo`'d with a leading 56×56
`Thumbnail` (expo-image, `cacheKey: image_path`, transition + `onError` → flat themed
placeholder tile + `reportError`); a flat tile holds the same footprint when there's
no URL so the row never jumps. Centralized `MEAL_PHOTOS_BUCKET` (was triplicated) and
extracted a shared `withTimeout` util.

**Two within-intent implementation choices:** (1) reset the row's `errored` flag via
`<Thumbnail key={image_path}>` remount instead of a `useEffect(setErrored)` — the
effect form tripped `react-hooks/set-state-in-effect`; same behavior, lint-clean.
(2) `entryRef` synced in an effect (declared before the mint effect), not during
render (`react-hooks/refs`).

**Why no backend work:** `image_path` was already in the `MealCard` allowlist (0012)
and `meal_photos_select` already authorizes signing — zero migration.

**Verified:** `npx tsc --noEmit` PASS; `npx expo lint` clean; web bundle compiles
(`expo-router/entry.bundle?platform=web` → HTTP 200, ~8 MB, zero `*Error`); **user
web-verified** the full flow (thumbnails render; placeholder for no-photo; one
`createSignedUrls` per path set; Refresh reuses URLs; delete unaffected). **Plan 0013
DONE.** Follow-ups still open: tap-to-enlarge/lightbox (OQ4, non-goal here),
pagination past 100, meal **edit**, daily totals/dashboard, account/bulk self-serve
deletion (still email-routed), real-device pass (now also covers the native
cacheKey-survival test), real tab art.

### Session 13 (cont.) — 2026-06-24 · Plan 0014 daily dashboard → DONE
Picked HANDOFF candidate 2 (dashboard). The **Home tab was still the Expo starter** —
the landing surface showed nothing about the user's day, while `meal_logs` (per-meal
totals) and `goals` (daily targets) already held everything needed. Built the app's
**first aggregate-read surface**: today's calories + macros vs goals.

**Plan + review:** wrote plan 0014; the 4-lens review returned **3 blockers** — (B1) a
**tz-ordering bug**: `useProfile` renders `null` tz first then the real tz, and the
`(userId, reloadKey)` fetch keying (copied from `useMealHistory`) doesn't react to a
*second* async input (tz), so totals could bucket under the UTC/device fallback and
never correct; (B2) **divide-by-zero/NaN** drift across the four metrics from prose-only
0-goal handling; (B3) extracting Settings' `useGoalsRow` (which does `select('*')`)
would **leak body-PII** (age/sex/height/weight) onto Home. All resolved by edits: tz is
a **param** + bucket is a `useMemo(rows, tz)` (re-buckets on late tz, also kills a double
profile fetch); one guarded `progressFor` helper; a dashboard-local NARROW goals reader
(4 columns), Settings untouched. RLS for both reads verified present
(`meal_logs_select`, `goals_select` in the initial migration). → Approved.

**Built (no deviation):** `useDailyGoals` (narrow `Pick<>`, in-code `.eq('user_id')`,
refetch), `useDailyTotals(tz)` (48 h bounded `.gte(eaten_at)` — provably covers "today"
in any tz: ≤25 h day + ≤14 h offset ≈ 39 h ≤ 48 h — then bucket+sum in `useMemo(rows,
tz)` via one hardcoded-`en-CA` `Intl.DateTimeFormat`; **same-formatter date-string
compare** sidesteps all UTC-offset/DST math; try/catch at construction → UTC fallback),
and the dashboard screen (single `useProfile`, tz resolve stored→device→UTC, guarded
`progressFor` for calories + P/C/F, two-View progress bars (no svg), gate-order
loading→profile-error→totals-error, no-meals/no-goals empty states, `useFocusEffect`
refetch of totals+goals). Home `(app)/index.tsx` → thin re-export (mirrors `history.tsx`);
tab stays `/`, so no `app-tabs*` edit.

**Native caveat (tracked):** Hermes without full-ICU can *silently ignore* the `Intl`
`timeZone` option (no throw → bucket by device-local). Web has full Intl so web-verify is
valid; the deferred iPhone pass must confirm tz is honored.

**Verified:** `tsc` PASS; `expo lint` clean; web bundle HTTP 200 (~7.9 MB, zero errors);
**user web-verified**. **Plan 0014 DONE.** Follow-ups: weekly/trend view, calorie ring
(OQ1), quality nutrients on dashboard (OQ2), and the iPhone pass (now also covers native
Intl tz-honoring).

### Session 13 close — 2026-06-24
Net: **two full plans shipped + one reviewed-and-approved**. 0013 (History photo
thumbnails — signed URLs, expo-image cacheKey, first `createSignedUrl(s)` integration)
and 0014 (daily totals dashboard — Home tab, first aggregate read; tz-correct via
same-formatter date-string bucketing) both built, web-verified, and pushed. 0015 (edit
a saved meal — first UPDATE surface) was **planned + 4-lens-reviewed + Approved** but
**NOT executed** (session hit the context red zone). 0015's review cleared 2 blockers:
dropped `updated_at` from the update RPC's SET list (an existing `set_updated_at` trigger
owns it), and replaced the wavering not-found handling with a distinct `P0002` SQLSTATE +
a dedicated `updateMeal` result type (no reused `conflict`/`id`). All 5 RLS policies the
SECURITY-INVOKER `update_meal_log` RPC relies on were verified present. Tree clean, tsc
green, all pushed. **Next session: execute plan 0015** (it includes a migration deploy —
heavier than the recent pure-client plans).

## Session 14 — 2026-06-24

### Plan 0015 DONE — edit a saved meal (first UPDATE surface) + migration deploy
Executed the approved plan 0015 end-to-end with **no material deviations**. The app's
first post-save edit path: from a History row, open an edit screen seeded with the meal's
current dish + items + totals, change/remove, Save → atomic update → back to History
(refetch-on-focus shows the new values). Totals always = `sum(items)`.

**The atomic RPC (new migration `20260624150000_update_meal_log`).** Mirrors
`create_meal_log`'s security posture (`SECURITY INVOKER`, `set search_path=''`, allowlisted
`->>` reads, server-set `meal_log_id`/`position`). Body order — **ownership before any
child mutation**: auth `28000` → item-count 1..50 `23514` → parent UPDATE scoped to
`id=p_id AND user_id=auth.uid()` → `GET DIAGNOSTICS ROW_COUNT=0` raises a **distinct
`P0002`** (so the client says "no longer exists", not "check your values") → delete
children → re-insert `with ordinality`. NEVER touches `user_id`/`image_path`/`eaten_at`/
`created_at`/`verified`/**`updated_at`** (the `set_updated_at` trigger owns the last; B1).
One implicit txn → a failed re-insert rolls back, children never lost. Dropped the
create-path `image_path`/namespace block (column never written here). **`db push`ed to
prod**; Management-API check confirmed it exists, `prosecdef=false`, grants
`authenticated:EXECUTE` (no `anon`) — identical to `create_meal_log`.

**Client.** New shared `callMealRpc` primitive (`capture/lib/meal-rpc.ts`) — factored the
`withTimeout`/`TIMEOUT`/race + a transport-agnostic `{status:'ok'|'error'|'network'}`
outcome carrying ONLY the SQLSTATE out of `saveMeal`; each caller keeps its own
classify + typed-kind logging (so `saveMeal` retains `conflict`+`id`; `updateMeal`
(`history/lib/update-meal.ts`) has a **dedicated** result type with `not_found` mapped from
`P0002`/`23503`, no `id`, no `conflict` — B2). `useMealDetail` (`history/lib`) fetches the
editable detail with strict `Pick<>` allowlists (no `image_path`/totals), explicit
`.eq('user_id')` parent guard + RLS-only child scope, and a **both-or-neither gate**
(parent-deleted OR items-error OR 0-items → one hard error, never a partial Save-disabled
seed). `seedFormFromMealLog` (added to `meal-form.ts`, + `StoredMealLog`/`StoredMealItem`)
maps a stored row → the SAME `MealForm` as create, so every validator/`recomputeTotals`/
`toSavePayload` is reused; `quality` reconstructed only when `quality_score != null`.

**UI.** Extracted the editable body (dish + items + live totals + assumptions) into a
shared **`MealEditorForm`** (`capture/screens/meal-editor-form.tsx`) used by BOTH
`meal-review` (create) and the new `edit-meal-screen` — pinned controlled props
(`form/onDishChange/onItemChange/onRemoveItem/totals/withinCaps`); the assumptions block
now reads `form.assumptions` (was `analysis.assumptions`) so it serves both. New
`edit-meal-screen.tsx` (loading/error gates → `key`ed child seeds form once via `useState`
initializer → Save → `router.back()`; terminal `not_found` screen with Back; transient →
inline retry; `mounted` ref wraps the `updateMeal` resolution). Guarded root route
`src/app/meal-edit.tsx` + `<Stack.Screen name="meal-edit" headerShown title="Edit Meal">`
inside the signed-in+onboarded guard. History gained an **Edit** affordance per row +
`useFocusEffect(refetch)` that **skips the first focus** (a `hadFirstFocus` ref) so it
doesn't double-fire with the mount fetch (SF4).

**Deviation worth noting:** the plan said "don't over-copy `useMealHistory`'s keyed-outcome
machinery," but `expo lint`'s `react-hooks/set-state-in-effect` forbids synchronous
`setState` in an effect body — so `useMealDetail` adopts the SAME keyed-outcome +
`useMemo` derivation (setState only in the async callback, keyed to
`(id,userId,reloadKey)`). The right call; gate + PII discipline unchanged. Minor:
`estimated_grams` null seeds as `0` (form type is `number`) → a no-change save writes `0`
not `null` (legacy-row edge, within "carried-through" tolerance, passes the column bound).

**Verified:** `tsc` PASS; `expo lint` clean; web bundles HTTP 200 + valid JS (edit chain
present); migration applied + verified in prod; **user web-verified** (seed/edit/persist,
remove item, today-meal dashboard reflect, over-cap block, create-flow regression). DONE.

---

## Plan 0016 — Photo lightbox (full-screen meal photo)

**What.** Tapping a History thumbnail that has a minted signed URL now opens a
full-screen, aspect-correct view of that meal's photo; the ✕, a backdrop tap, and
Android hardware-back all dismiss it. Placeholder rows (no photo) stay inert.

**Why.** History thumbnails are 56×56 (plan 0013) — detail is lost. This gives a
larger look with **zero new fetch / no migration**: it reuses the in-memory signed
URL `useSignedThumbnails.urlFor` already minted for the thumbnail, so it adds no
storage call in the common case and inherits 0013's privacy posture.

**How.** New presentational `photo-lightbox.tsx` — a bare RN `Modal` (not the
`<Screen>` primitive, which clamps width/insets) with a fixed dark scrim backdrop
`Pressable`, an `expo-image` `contentFit="contain"` source `key`ed on `cacheKey`
(= `image_path`, so native reuses the thumbnail's cached bytes) wrapped in its own
no-op `Pressable` so a tap on the photo doesn't bubble to the backdrop, and a themed
✕ in the top safe-area inset. No spinner / `onError` / inline-error (review B1 — a
failed decode just shows the scrim, still dismissible; the thumbnail's own
`onError`→`reportError` remains the sole negative-cache path). History wiring reuses
the single `thumbUrl` for both the tappable gate and the URL, holds one `lightbox`
state, and closes it on `userId` change so a sign-out never leaves user A's URL
viewable. The signed URL never enters route params — it lives only as an in-memory
prop.

**Verified.** `tsc` PASS; `expo lint` clean; web bundle on :8081; user web-verified.
Native back / light StatusBar / VoiceOver-modal ride the deferred iPhone pass. DONE.

---

## 2026-08-04 — Docs reconciled: AI model is OpenAI `gpt-4o-mini` (not Claude)

**What.** Swept the repo for stale AI-provider references and aligned every *living*
doc with the code, which is the source of truth. Ground truth (verified in code, not
prose): `supabase/functions/analyze-meal/openai.ts` → `const MODEL = "gpt-4o-mini"`,
endpoint `api.openai.com`, secret `OPENAI_API_KEY` (`index.ts:96`).

**Why this entry exists.** This journal is append-only, so rather than rewrite the
kickoff/step-1 entries (which correctly record the decision *as it was then*), this
note supersedes them. The provider actually evolved **Claude (ADR-0001 assumption,
never built) → Gemini 2.5 Flash (kickoff/step 1) → OpenAI `gpt-4o-mini` (plan 0008,
2026-06-23)**. The Gemini→OpenAI switch is already documented in the Session 9 (cont.)
entry above and was driven by OpenAI's no-training-by-default API terms resolving the
free-Gemini-tier privacy risk (B5). What was missing was consistency in the docs that
readers treat as *current* truth.

**Changed (docs/comments only — no code behavior touched; `MODEL` left untouched):**
- `README.md` — Tech-stack row + golden rule "Claude" → "OpenAI GPT-4o-mini"; project
  structure "analyze-meal (to be created)" → deployed, + `cleanup-orphans`/`migrations`;
  MVP roadmap all five ticked (verified in code) + a new "Also shipped" list (delete,
  thumbnails, lightbox, edit-saved-meal, in-app privacy, orphan cleanup); Getting-started
  gained the real Supabase backend steps (`link`/`db push`/`functions deploy`/`secrets set`).
- `CLAUDE.md` — "GPT-4o vision" → "GPT-4o-mini vision" (×2).
- `.env.example` — the note's `ANTHROPIC_API_KEY` → `OPENAI_API_KEY` (warning kept).
- `supabase/functions/analyze-meal/index.ts` — header comment "NEVER calls Gemini" →
  "OpenAI"; "GPT-4o vision" → "GPT-4o-mini vision".
- `docs/ARCHITECTURE.md` — mermaid node + capture row "Gemini" → "OpenAI GPT-4o-mini".
- `docs/decisions/0001-tech-stack.md` — added a "Superseded in part" pointer on the AI
  line (original text kept); new **`docs/decisions/0003-ai-provider.md`** records the
  current provider decision + the full Claude→Gemini→OpenAI history and rationale.
- `docs/sessions/HANDOFF.md` — refreshed to real status (0015 + 0016 shipped).

**Deliberately NOT changed (historical execution records — like this journal, they
capture what was true at the time; rewriting them would falsify history):** the plan
docs `0001`/`0007`/`0008` still reference Claude/Gemini in their point-in-time text.
ADR-0003 + this entry carry the current truth; the plans stay as-built.

---

## 2026-08-26 — Plan 0018 executed: weekly calorie trend (verify pending)

**What.** A new "Weekly trend" screen (reached from a button on the Home dashboard):
7 vertical bars of daily calories for the last 7 local-calendar days (oldest→newest,
weekday-labelled, today highlighted) + a weekly-average card (avg daily calories + avg
P/C/F over LOGGED days only). Pure client, read-only, no migration, no new dependency.

**Why.** The dashboard only showed *today*; the most-requested signal is "am I trending
up or down this week?" This reuses 0014's exact `meal_logs`/tz machinery widened from a
48 h "today" window to an 8-day 7-bucket window.

**How.** Extracted the shared `makeDayFormatter` (`day-formatter.ts`) so both the daily
and weekly hooks import it. New `useWeeklyTotals(tz)` clones 0014's keyed-outcome /
`.eq('user_id')` / `Pick<>`-allowlist machinery; its one subtlety (review B1) is that the
7 day-keys AND weekday labels are derived from a noon-UTC seed via UTC accessors only
(`toISOString().slice(0,10)` + `WEEKDAY_LABELS[getUTCDay()]`) — never a second tz
formatter — so an invalid tz can't crash and extreme zones can't drift the label off its
bar; keys+labels regenerate inside the `useMemo([rows,tz])`. The screen mirrors the
dashboard's gate order with a LOCAL height-% bar component (no chart lib, no shared `Bar`)
and a plain-`Text` average summary (no `MetricBar` — that's goal-progress). Registered as
a guarded root `Stack.Screen` over the tabs (the `meal-edit` precedent).

**Verified.** `tsc` exit 0; `expo lint` clean; web bundle HTTP 200 · 3.9 MB · complete.
User web-verify pending before Done. Native `Intl` tz rides the deferred iPhone pass.

---

## 2026-08-26 — Plan 0019 executed: calorie goal line on the weekly trend (verify pending)

**What.** A horizontal reference line across the weekly-trend bars at the user's daily
calorie goal (`useDailyGoals().goals.calories`), with the goal shown in the chart caption
("· goal N kcal"). Days above the line ate over target, below = under. Pure client, one
file, no migration.

**Why.** The 0018 bars had no reference point — you couldn't tell over/under target. This
is the named 0018 follow-up ("goal overlay line").

**How.** Reused the dashboard-grained `useDailyGoals` (strict Pick allowlist, non-fatal).
The chart is NOT restructured (review SF1): the line is an absolutely-positioned segment
INSIDE each existing `DayBar` track, so its `bottom%` and the bar-fill `height%` share the
same track coordinate space and align with no pixel math (7 aligned segments). Bars scale to
`domainMax = goalCal != null ? max(maxCalories, goalCal*1.1) : maxCalories` — goal-only
headroom (review B1) so the line is never pinned at the ceiling and the no-goal path stays
identical to 0018. Deviation: the planned ref/state "hold last goal" (SF4) hit the
react-compiler lint rules (`react-hooks/refs` / `set-state-in-effect`), so `goalCal` is
derived during render guarded on `!goalsLoading`; the transient is masked by the totals
loading gate (goals resolves before the 8-day totals query).

**Verified.** `tsc` exit 0; `expo lint` clean; web bundle HTTP 200. User web-verify pending
before Done. Native line render rides the deferred iPhone pass.

---

## 2026-08-26 — Plan 0020 DONE: meal text note → AI + saved & editable (user web-verified)

**What.** An optional free-text note in Capture: after the photo uploads, a multiline
"Add a note (optional)" field appears before Analyze. Its text is sent WITH the photo to
`analyze-meal` → OpenAI, which is instructed to treat the note as AUTHORITATIVE when it
conflicts with the photo (ingredients, portion, preparation). The note is persisted on
`meal_logs.note` and is shown + editable in the review card and the edit-meal screen. Empty
note = today's behavior exactly.

**Why.** The photo was the only input, so the user couldn't tell the model what the camera
can't see ("cooked in lots of oil", "2 cups of rice", "protein shake, not milk"). The note
lets the user correct the estimate at its source.

**How.** Two rails (the note is USER input, not AI output, so `MealAnalysis` is unchanged):
(a) to the Edge Function for this one analysis — a labelled user-text part placed BEFORE the
image + a standing system clause making it authoritative-on-conflict; (b) into the editable
`MealForm` (`note: string`) → `create_meal_log`/`update_meal_log` allowlists → re-editable.
Migration `20260826120000_meal_log_note.sql`: nullable `note text` + `char_length <= 500`
check; both RPCs gained `note` in their explicit column allowlists (no `jsonb_populate_record`,
server still sets `user_id`/`verified`). The DS `Input` already spreads `TextInputProps`, so
`<Input multiline>` needed no `shared/ui` change (its `hint` prop carries the char counter).

**Review fixes folded in.** B1 — `edit-meal-screen.tsx` DID need a change: both form callers
(`MealReview`, `EditMealScreen`) add a `setNote` handler and pass `onNoteChange` to the shared
`MealEditorForm` (the plan's earlier "no change" was wrong; without it tsc fails / the note is
display-only there). SF2 — the note is capped by CODE POINT (`[...s].slice(0, NOTE_MAX)`) in the
edge function AND `validateNote`, never a bare `.slice`, so a surrogate pair is never split
(a lone surrogate would corrupt the RPC jsonb + the OpenAI body). SF3 — on an analyze failure
when a note was sent, the terminal copy points at editing/removing the note (a refusing note
re-trips every Retry). SF4/SF5 — the note is disclosed at BOTH the just-in-time capture notice
("your photo and any note you add are sent to OpenAI") and privacy §1 (stored) + §2 (sent).
`NOTE_MAX = 500` is a sync-set across the client const, the edge cap, and the DB check.

**Deployed.** `supabase db push` applied the migration (remote up-to-date confirmed);
`supabase functions deploy analyze-meal` redeployed the note-aware prompt. No new secret,
CORS unchanged.

**Verified.** `tsc` exit 0; `expo lint` clean; web bundle HTTP 200 (~3.9 MB, complete). Note
never logged (grep gate: no `console.*note`); no new `select('*')`. User web-verify pending
before Done (type a note that changes the estimate; conflict test; edit-and-reopen; empty-note
regression). The multiline field + keyboard behavior on-device rides the deferred iPhone pass.

---

## 2026-08-27 — Plan 0021 executed: Saturday-first weekly bars + four plan-progress rings (verify pending)

**What.** Two changes to the Weekly trend (`/trends`): (1) the 7 bars now read in a fixed
**Saturday → Friday** layout (same rolling last-7-days data, no empty days), with today
highlighted wherever it falls; (2) a new card of **four pure-View ring charts** — Calories,
Protein, Carbs, Fat — showing how much of the recommended plan the user has hit **this week so
far**: `consumed(Sat→today) ÷ (daily goal × days elapsed since Saturday)`. The real % is in the
ring's center (can exceed 100%), the ring fills to a visual 100% cap, and an over-target ring is
colored `danger`.

**Why.** The bars had no week anchor (rolling, today-last) and no sense of "am I on plan?". The
user wanted a Saturday-anchored week and a per-macro progress-against-plan readout.

**How.** Pure client — no migration, no new dependency (no SVG → no native rebuild), no extra
fetch. The rings are derived from the SAME weekly rows the bars use: a new pure helper
`weekPlanProgress(days, goals)` sums a contiguous Sat→today tail and divides by `goal × elapsed`
(elapsed from the Saturday-first weekday rank of today). The Sat-first bar order is a display-only
sort by `(getUTCDay(key)+1)%7`; a new `isToday` flag on `DayTotals` (set on the seed day) carries
the highlight so the reorder can't desync it. The donut is the classic two-layer border-arc View
technique (track ring + a rotated top/right-bordered half-ring, with a track-colored offset layer
for ≤50% or a second colored half-ring for >50%).

**Review fixes folded in.** SF1 — `elapsed` derived structurally + guarded (`elapsed > 0`,
defensive empty result) so a `goal × 0` denominator can't make `percent = Infinity` (the
`goal > 0` guard alone wouldn't catch it). SF2 — the rings are computed AFTER the loading/error/
empty gates (where `days` is length-7). SF3 — the no-goal hint shows ONLY on `!goalsLoading &&
goals == null`; while goals load, a spinner (never a hint flashed at a user who has goals). SF4 —
one shared `guardedRatio` helper replaces the duplicated `progressFor` guard (dashboard screen +
rings both consume it). SF5 — no-log discipline + typed `Pick<>` allowlists on the new files.
SF6 — rings kept per the user's explicit request; a 4-bar fallback (reusing `guardedRatio`) is
noted. OQs resolved: ring is dashboard-local; over-target reuses the `danger` token (no new
theme token).

**Verified.** `tsc` exit 0; `expo lint` clean; full `expo export --platform web` exit 0 with the
new trend code present in the compiled bundle (the trend route is code-split, so a full export —
not the entry.bundle curl — is the authoritative web check here). No metric/goal/percent logged.
User web-verify pending before Done (Sat→Fri order + today highlight on a non-Friday; ring
percentages; over-target color; no-goal hint). Pure-View ring render on-device rides the deferred
iPhone pass.
