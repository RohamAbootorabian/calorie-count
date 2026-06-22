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
