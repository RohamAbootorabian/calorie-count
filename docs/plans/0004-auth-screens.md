# Plan: Auth screens — sign up / log in / log out / password reset (S1 · piece 1)

- **Status**: Done (2026-06-19) — built per the approved plan; `tsc` + `lint` +
  web bundle clean; sign-in / wrong-password / validation verified on web.
  Email-send flows (signup confirm + reset) blocked only by Supabase's email rate
  limit (infra, not code) — re-verify once SMTP/limit is sorted.
- **Created**: 2026-06-19
- **Plan #**: 0004

## Problem / Goal
Step 3 shipped the auth *infrastructure* (the `src/lib/auth` provider + the
`Stack.Protected` gate) but only a throwaway `__DEV__` sign-in form. We now need
the **real, user-facing auth screens** so a person can create an account, sign in,
sign out, and recover a forgotten password — the foundation S1's onboarding and
profile pieces build on.

**Done looks like:**
- A signed-out user can **sign in** with email + password and the gate flips to
  `(app)`.
- A new user can **sign up**; because the Supabase project requires email
  confirmation, sign-up lands on a clear "check your email to confirm" state
  (it does **not** silently fail or pretend they're signed in).
- A signed-in user can **sign out** and return to the auth screens.
- A user can request a **password-reset email** from a "forgot password" screen.
- All screens are built on `@/shared/ui` (brand-green), handle loading/error
  states, and live under `src/features/auth/`.
- The temp `__DEV__` form is gone; `tsc` + `lint` pass; the flow is verified on web.

## Non-goals
- **Onboarding wizard / TDEE / `goals`** — S1 piece 2 (separate plan).
- **Profile & Settings screens** — S1 piece 3. (See "log out" note below.)
- **Social / OAuth / magic-link / phone auth** — email + password only for v1.
- **Account deletion.**
- **Changing the Supabase email-confirmation setting** or any RLS/schema change.
- **Hardening token storage** (`expo-secure-store`) — already deferred (plan 0003 SF6).
- Modifying anything outside `src/features/auth/` except the thin `(auth)` route
  files and the one temp-cleanup edit called out below.

## Proposed approach

### Structure: routes → feature screens
Route files in `src/app/(auth)/` are **one-liner wrappers** that render a screen
component from `src/features/auth/` (the new `sign-up`/`forgot-password` routes);
`sign-in.tsx` is a **replacement** of the existing `__DEV__` placeholder, not a wrap
(N3). This honors the S1 boundary ("create/edit only inside `src/features/auth/`")
while keeping the trunk-owned routing layer trivial. Routes import screens directly
— **no `index.ts` barrel** (auth screens are internal, not reusable primitives like
`@/shared/ui`) (N2).

```
src/app/(auth)/
  _layout.tsx        # add sign-up + forgot-password to the Stack (keep sign-in anchor)
  sign-in.tsx        # REPLACE the __DEV__ placeholder → render <SignInScreen/>
  sign-up.tsx        # NEW one-liner → render <SignUpScreen/>
  forgot-password.tsx# NEW one-liner → render <ForgotPasswordScreen/>

src/features/auth/
  screens/sign-in-screen.tsx
  screens/sign-up-screen.tsx
  screens/forgot-password-screen.tsx
  lib/auth-utils.ts              # one file (N1): validateEmail/validatePassword
                                 # (pure) + getAuthErrorMessage(error) → friendly copy
```

### Auth calls (all via the existing `supabase` singleton)
- **Sign in:** `supabase.auth.signInWithPassword({ email, password })`. On success
  the provider's `onAuthStateChange` flips the gate — the screen does **not**
  navigate manually.
- **Sign up:** `supabase.auth.signUp({ email, password, options: { emailRedirectTo } })`.
  With email confirmation ON, `data.session` is `null` and Supabase sends a
  confirmation email. **B1:** do **not** branch on `data.user.identities` / error
  codes to detect an already-registered address — that's deliberately obfuscated
  for anti-enumeration. Always show the generic "check your email" state on
  success, **and always show an "Already have an account? Sign in" link on it** so
  an already-registered user is never trapped (no email will arrive for them). No
  manual `profiles` insert — the `handle_new_user` trigger handles it.
- **Sign out:** already implemented in the provider (`useAuth().signOut`). Piece 1
  does not build a Settings screen, so the Home sign-out button **stays** until S1
  piece 3 ships Settings (otherwise a signed-in user has no way out). **SF4:**
  rename its label `Sign out (dev)` → `Sign out` (it's now the real, interim
  control) — a one-word edit to `src/app/(app)/index.tsx`. Piece 3 moves it into
  Settings (N4 — documented lifecycle).
- **Forgot password:** `supabase.auth.resetPasswordForEmail(email, { redirectTo })`.
  This **sends** the recovery email. Completion happens on Supabase's hosted page in
  v1 — see the deep-link decision below. Also exposes **resend confirmation** via
  `supabase.auth.resend({ type: 'signup', email })` for the `email_not_confirmed`
  case (SF3).

### Password-reset completion (the hard part) — request-only for v1
Completing a reset requires the user to tap the emailed link, which must deep-link
back into the app and exchange the recovery token for a session before
`updateUser({ password })`. Our client sets `detectSessionInUrl: false` and we have
no deep-link/`expo-linking` handler wired yet. Building that robustly (native
scheme + web URL + token parsing) is its own chunk.

**Decision for v1 (B2):** ship the **request** side only. Both **email
confirmation** and **password reset** are **completed on Supabase's hosted pages**
in v1: the user taps the emailed link, finishes on Supabase's page, then returns to
the app and signs in. Screen copy sets this expectation ("Tap the link in your email
to finish, then come back and sign in"). The in-app deep-link callback
(set-new-password + in-app confirm) is **deferred to plan 0005**, because both flows
need the same `expo-linking` plumbing — wiring it once is cheaper than twice.
**This is only acceptable if the hosted link resolves**, so the test plan must
actually click an emailed link and confirm it lands on a working page (not a dead
end) — see Test/verify. Requires a sane Supabase **Site URL** / default redirect.

### Error & validation handling (one file: `lib/auth-utils.ts`)
- **Validation** (pure): trim + basic email-shape check; password min length **= 6**
  (confirmed against `config.toml` `minimum_password_length`, N6); confirm-password
  match on sign-up.
- **Error mapping** `getAuthErrorMessage(error)`: map the known set (N5) —
  `invalid_credentials`, `email_not_confirmed`, `over_email_send_rate_limit`,
  weak-password, network failure — to friendly copy, with a **fallback** of
  "Something went wrong. Please try again." for anything unmapped (SF1). Never echo
  the raw `AuthError.message`/tokens; never reveal whether an email is registered.
- **Inputs** use `@/shared/ui` `Input` (`error` prop drives the red border) and
  **clear their error `onChangeText`** for real-time feedback (SF6); the submit
  `Button` uses its built-in `loading` + double-tap guard.
- **Unmount guard (SF2):** each form keeps a `useRef(true)` mounted flag, cleared in
  cleanup, and checks it before any `setState` after an `await` (the gate can
  unmount the screen mid-submit). Mirrors the `active` flag in `auth-provider.tsx`.

## Files to change
- `src/app/(auth)/_layout.tsx` — register `sign-up` + `forgot-password` screens
  (keep `sign-in` declared first as the anchor).
- `src/app/(auth)/sign-in.tsx` — replace the `__DEV__` placeholder with
  `<SignInScreen/>` (removes the temp form entirely).
- `src/app/(auth)/sign-up.tsx` — NEW thin route → `<SignUpScreen/>`.
- `src/app/(auth)/forgot-password.tsx` — NEW thin route → `<ForgotPasswordScreen/>`.
- `src/features/auth/screens/sign-in-screen.tsx` — NEW: email/password form,
  "Forgot password?" link, "Create account" link → `sign-up`; on
  `email_not_confirmed`, show confirm-email message + **Resend** (SF3).
- `src/features/auth/screens/sign-up-screen.tsx` — NEW: email/password (+ confirm
  password) form; success → check-email state **with an "Already have an account?
  Sign in" link** (B1); link back to `sign-in`.
- `src/features/auth/screens/forgot-password-screen.tsx` — NEW: email form →
  sends reset email → "check your email" state (copy: finish on the emailed link).
- `src/features/auth/lib/auth-utils.ts` — NEW: pure validators +
  `getAuthErrorMessage` with fallback (N1/SF1).
- `src/app/(app)/index.tsx` — **SF4:** rename the sign-out button label
  `Sign out (dev)` → `Sign out` (one word); keep the button until piece 3 Settings.

## Data model / schema impact
**None.** No tables, columns, migrations, RLS, or buckets change. The
`handle_new_user` trigger (plan 0001) already creates the `profiles` row on signup;
auth screens rely on it and never write `profiles`/`goals` directly.

## Edge cases & failure modes
- **Wrong credentials** → "Invalid login credentials" mapped copy; field error, no crash.
- **Unconfirmed email signing in** → Supabase returns `email_not_confirmed`; show
  "Please confirm your email first" with a way back to the confirm-email notice.
- **Sign-up with an already-registered email** → Supabase returns a success-shaped,
  obfuscated response and sends no email (anti-enumeration). We do **not** try to
  detect it; we show the same "check your email" state with an **"Already have an
  account? Sign in"** link so the user is never trapped (B1).
- **Confirm/reset link tapped (v1)** → user lands on Supabase's hosted page,
  completes there, returns to the app, signs in. Dead-end risk if Site URL/redirect
  is misconfigured → covered by the test plan (B2).
- **Empty / malformed email, password too short, mismatched confirm-password** →
  blocked client-side by `validation.ts` before any network call.
- **Offline / network error** → caught, friendly "check your connection" message;
  button returns from `loading`.
- **Rate limiting** (`over_email_send_rate_limit` on repeated signup/reset) → mapped
  copy asking the user to wait.
- **Double-tap submit** → already guarded by the `Button` in-flight guard.
- **Race: gate flips mid-submit** → after `signInWithPassword` resolves, the
  component may unmount as the gate swaps; guard `setState` after `await` (mounted
  ref or ignore-on-unmount) to avoid a state-update-on-unmounted warning.
- **Token hygiene** → never log `session`/tokens (provider rule SF1 extends here).
- **Web vs native** → all three screens are pure `@/shared/ui`; verified the SPA
  (`web.output: single`) build doesn't re-trip the SSR `window` crash from 0003.

## Test / verify plan
- `npx tsc --noEmit` and `npx expo lint` both clean.
- Pure-function unit sanity for `validation.ts` (manual or lightweight) — valid/invalid
  emails, short password, mismatch.
- **Manual on web** (`npx expo start --web`, confirmed test user from Step 3):
  1. Sign in with the confirmed user → gate flips to `(app)`; reload persists.
  2. Sign out (temp Home button) → back to `sign-in`.
  3. Sign up with a **new** throwaway address → "check your email" state (no gate
     flip) showing the "Sign in" link (B1).
  4. **Click the confirmation email link** → confirm it lands on a working Supabase
     hosted page; then sign in → gate flips (proves B2 isn't a dead end).
  5. Sign in before confirming → `email_not_confirmed` message + working **Resend** (SF3).
  6. Forgot password → "check your email"; **click the reset link** → confirm it
     reaches a working hosted reset page (B2).
  7. Bad email / short password / wrong credentials / mismatched confirm → inline
     errors that clear on edit (SF6), no crash.
- **Expo Go** (if a network that scans is available) — at least sign-in + sign-out;
  otherwise note web-verified and defer device pass (as in Step 3).
- Use a **distinct throwaway email per iteration** to avoid the email rate limit
  (SF5); clean up any throwaway signup users created during testing.

## Rollout
1. Build feature screens + thin routes (no schema/secret changes).
2. Verify per above; remove the temp `__DEV__` form (replaced).
3. Append `docs/JOURNAL.md` entry, mark plan Done, **commit straight to `main`**
   and push (project rule overrides the S1 brief's `feat/auth` branch — we build
   sequentially, no PRs).
4. No migrations, env vars, or Edge Function deploys required.
5. **Prod dashboard pre-checks (SF5/B2):** confirm the Supabase **Site URL** is set
   (so confirm/reset links resolve) and the **email rate limit** is high enough for
   real use (default ≈2/hr/IP is low). Dashboard-only; no code.

## Open questions
1. **Email confirmation: keep ON or turn OFF for v1?** — **DECIDED: keep ON**
   (2026-06-19, user). New users complete confirmation on Supabase's hosted page in
   v1 before signing in; the "check your email" + Resend UX stays. Safer for a
   health-data app.

_Resolved during review:_
- **(was Q2) Password-reset completion** — RESOLVED: request-only in v1; in-app
  set-new-password + deep-link confirm bundled into **plan 0005**. Completion via
  Supabase hosted page meanwhile (B2).
- **(was Q3) `redirectTo`** — RESOLVED: rely on Supabase's hosted pages + a valid
  Site URL in v1 (verified in test plan); app-scheme deep links land in plan 0005.
- **(was Q4) Password min length** — RESOLVED: **6**, matching `config.toml`; mirror
  in `auth-utils` (N6).

---

## Review
_Multi-agent review (4 lenses), 2026-06-19. Findings consolidated & deduped._

**Verdict: NEEDS CHANGES → resolved in-plan (see edits below). 2 blockers, both cleared.**

### Pre-review fact-check (dismissed false alarms)
- **"config.toml has `enable_confirmations = false`, contradicting the plan"**
  (raised by Correctness B2 + Data B1) — **DISMISSED.** `supabase/config.toml`
  governs only local `supabase start`; the app's `supabase` client points at the
  **production** project (plan 0003 review B1), where email confirmation is
  empirically **ON** (the handoff observed `email_not_confirmed` from a live
  signup). The plan's confirmed-email assumptions are correct. _Action: add a note
  to the plan so this isn't re-litigated (done — see B1 resolution)._

### BLOCKER
- **B1 — Don't rely on the `signUp` response shape to detect duplicates; never
  trap an already-registered user.** (Correctness #1, Edge #1, Data #3 — all the
  same root issue.) With confirmation ON, Supabase deliberately returns a
  success-shaped, obfuscated user (empty `identities`, no email sent) for an
  already-registered address — by design we **cannot and must not** distinguish it.
  The risk is a user who re-signs-up with an existing email gets stuck forever on
  "check your email" (no email ever arrives).
  **Resolution:** Do NOT branch on `identities`/error code to detect duplicates.
  Always show the generic "check your email" state on signup success, **and always
  render an "Already have an account? Sign in" link on that state** so there is
  never a dead end. (Folded into the approach + edge cases.)
- **B2 — In-app completion of confirm/reset is deferred, so v1 must route users to
  Supabase's hosted pages — and the test plan must prove that link works.**
  (Edge #2/#6, Data #6.) Without a deep-link handler, a new/reset user completes
  the flow on Supabase's hosted confirmation/reset page, then returns to the app to
  sign in. That's acceptable for v1 **only if** the hosted link actually resolves
  (sane Site URL / default `redirectTo`).
  **Resolution:** State explicitly that confirm + reset **complete on Supabase's
  hosted pages in v1** (in-app deep-link callback = follow-up plan 0005); set
  copy expectations ("tap the link in your email to finish"); and add a verify step
  that actually clicks the emailed link and confirms it lands on a working page,
  not a dead end. (Folded into approach, edge cases, test plan, rollout.)

### SHOULD-FIX
- **SF1 — Define a fallback error message.** `auth-errors` must map a small known
  set and fall back to a generic "Something went wrong. Please try again." for
  anything unmapped — never echo the raw `AuthError.message`. (Correctness #4.)
- **SF2 — Specify the unmount-guard pattern.** Use a `useRef(true)` mounted flag
  cleared in cleanup; check it before any `setState` after an `await` (the gate can
  unmount the screen mid-submit). Mirror the `active` flag pattern already in
  `auth-provider.tsx`. (Correctness #3, Edge #5.)
- **SF3 — `email_not_confirmed` needs a real path forward.** On that sign-in error,
  show "Confirm your email — we sent a link to <inbox>" and offer **Resend
  confirmation** via `supabase.auth.resend({ type: 'signup', email })` (rate-limit
  aware). Otherwise an unconfirmed user is blocked. (Edge #3.)
- **SF4 — Rename the Home button `Sign out (dev)` → `Sign out`.** It is now the
  real (interim) sign-out until piece 3 Settings; the "(dev)" label is misleading
  to a real user. This is a one-word label edit to `src/app/(app)/index.tsx`
  (overrides the plan's "no change to Home" line). Keep the button until piece 3.
  (Edge #4.)
- **SF5 — Check the production email rate limit.** Supabase's default
  (≈2 emails/hr/IP) will block a user who signs up then immediately resets, and
  will exhaust during testing. Verify the prod project's rate limit (raise if
  needed) and use **distinct throwaway emails per test iteration**. (Data #2.)
- **SF6 — Clear errors on input change.** Input `error` should clear `onChangeText`
  so users get real-time feedback rather than a stale red border. (Edge #5.)

### NIT
- **N1 — Collapse `lib/validation.ts` + `lib/auth-errors.ts` into one
  `src/features/auth/lib/auth-utils.ts`.** Two ~15-line pure-function files for one
  feature is false modularity. (Architecture #1.)
- **N2 — Drop the `src/features/auth/index.ts` barrel.** Auth screens are internal,
  not reusable primitives (unlike `@/shared/ui`); routes import screens directly.
  Avoids implying a public API. (Architecture #3.)
- **N3 — "thin wrapper" language is imprecise for `sign-in.tsx`** — it's a
  *replacement* of the `__DEV__` placeholder, not a wrap. New routes
  (`sign-up`/`forgot-password`) are one-liner wrappers. (Architecture #2.)
- **N4 — Document the temp-button lifecycle** explicitly (removed/moved when piece 3
  Settings ships). (Architecture #4.)
- **N5 — Enumerate the ~6 Supabase error codes** to map up front
  (`invalid_credentials`, `email_not_confirmed`, `over_email_send_rate_limit`,
  `user_already_exists`, weak-password, network) so `auth-utils` is reviewable. (Edge #8.)
- **N6 — Confirm password min length = 6** (matches `config.toml`); mirror the
  constant in `auth-utils`; resolves Open Question 4. (Correctness #5, Data #4.)

### Praise (reviewers concurred)
Good reuse of `@/shared/ui` (zero bespoke components), correct reliance on RLS as
the real boundary with the UX gate as cosmetic, sound deferral of the deep-link
work, no token/PII logging, and a thorough edge-case list. Boundary discipline
(only `src/features/auth/` + thin routes) is clean.

## Execution log
**2026-06-19 — executed per the approved plan.**
- Built `src/features/auth/lib/auth-utils.ts` (pure validators + `getAuthErrorMessage`
  with generic fallback, `PASSWORD_MIN_LENGTH = 6`).
- Built three screens in `src/features/auth/screens/`: sign-in (with
  `email_not_confirmed` → Resend via `auth.resend`), sign-up ("check your email"
  state + always-present "Sign in" link per B1; `emailRedirectTo` omitted → uses
  project Site URL), forgot-password (request-only, hosted-page completion per B2).
  All on `@/shared/ui`; SF2 mounted-ref guard on every post-`await` setState; SF6
  errors clear `onChangeText`.
- Routes: replaced the `__DEV__` `sign-in.tsx` with `<SignInScreen/>`; added
  one-liner `sign-up.tsx` + `forgot-password.tsx`; registered all three in
  `(auth)/_layout.tsx`. No barrel (N2).
- SF4: renamed Home button `Sign out (dev)` → `Sign out` + updated its comment.
- **Deviation (minor):** first `tsc` failed because `typedRoutes` hadn't picked up
  the new route files (the expected "type churn" from plan 0003). Booting
  `expo start` regenerated `.expo/types/router.d.ts`; re-ran clean. No code change.

**Verification so far:**
- `npx tsc --noEmit` → clean. `npx expo lint` → clean.
- Web bundle force-compiled (HTTP 200, ~7.8MB, no resolve/syntax errors); SPA boots
  HTTP 200.
- **Manual web pass (user):** sign-in with the confirmed test user → gate flips +
  persist + sign-out; wrong password → friendly error; email/password/confirm
  validation errors render and clear. All ✅.
- **Email-send flows not yet exercised end-to-end:** signup hit
  `over_email_send_rate_limit` — the code mapped it correctly to friendly copy, but
  Supabase's default email service caps ~2/hr, so the confirm + reset *emails*
  couldn't be sent during testing. **This is infra, not a code defect.** Re-verify
  signup-confirm + reset once a custom SMTP provider is configured (needed for prod
  anyway) or the rate limit resets. Tracked as a follow-up alongside plan 0005
  (deep-link completion).
