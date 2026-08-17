# Plan: Web app — separate repo bootstrap (Next.js on the shared backend)

- **Status**: ~~Draft~~ → ~~In Review~~ → ~~Approved~~ → ~~In Progress~~ → **ABANDONED (2026-08-04)**
- **Abandoned**: The separate web-app direction was dropped by product decision — we
  refocused on the mobile app. The standalone `calorie-count-web` repo (Next.js, never
  pushed to a remote) was **deleted from disk**. This plan is kept for the record only;
  do not execute it. The shared Supabase backend was never modified, so nothing needs
  reverting there. If a web client is ever revisited, start a fresh plan.
- **Created**: 2026-06-30
- **Plan #**: 0017

## Problem / Goal
Today the only "web" build is `react-native-web` (`expo start --web`) from this
mobile repo. It renders, but it's a phone UI stretched into a browser — no real
desktop layout, weak SEO, no server rendering. We want a **proper web app**,
developed in **its own repo**, that talks to the **same Supabase backend** (same
project, same tables, same Edge Functions, same users) as the mobile app.

This plan is the **bootstrap only**: stand up the new repo, wire it to the shared
backend, ship email/password **auth**, and prove the connection with **one authed
data read** (the user's meal history list). Per-screen feature parity (capture →
analyze → review → save, dashboard, lightbox, etc.) lands in **later plans in the
new repo** — not here.

**"Done" =** a new git repo `calorie-count-web` exists with a Next.js (App Router,
TS, Tailwind) scaffold; a browser + a server Supabase client (typed `<Database>`) are
wired to the SAME project via `NEXT_PUBLIC_*` env (same values as mobile's
`EXPO_PUBLIC_*`); a user can **sign in / sign out** with email+password, and **sign up**
renders a "check your email" state (mirrors mobile — the shared project has email
confirmation ON, so `signUp` returns no session); after signing in with an
**already-confirmed** account, a `/history` Server Component (gated on `getUser()`)
**lists exactly that user's own meals** read from the shared `meal_logs` table
(bounded `.limit()`, explicit `.eq('user_id', user.id)` + column allowlist, error
state) — the proof is a **non-empty** list for a known-populated account plus a second
account seeing only its own rows; `tsc` + `next lint` + `next build` all green; the
mobile repo is **untouched**; user browser-verifies sign-in + own-history isolation.

## Non-goals
- **No changes to this (mobile) repo.** Not one file. The shared surface is the
  Supabase project, reached over the network — not shared source. (Type sharing is by
  **copy** for v1; see below.)
- **No new Supabase project, no data migration, no schema/RLS/migration change.** The
  web app is a second client of the existing backend. Existing RLS (plan 0001) is the
  data boundary and already scopes every row by `user_id` — it does the work for free.
- **No new Edge Functions.** Web reuses `analyze-meal` and `cleanup-orphans` as-is.
  (One **config** change may be needed: the function's CORS allow-list must include the
  new web origin — see Rollout. That's an Edge Function *secret/config* edit, not code,
  and not part of this bootstrap's "done" unless capture ships.)
- **No capture/analyze/review/save flow in this plan.** No photo upload, no
  `functions.invoke('analyze-meal')` yet. History is a **read-only** proof-of-life.
  (So CORS isn't on this plan's critical path — the DB read goes through PostgREST, not
  the Edge Function.)
- **No dashboard, no photo lightbox, no edit/delete** in this plan (later plans).
- **No monorepo / no shared npm package** yet. Two independent repos; the web repo
  **copies the generated `database.ts`**. A shared `@calorie/types` package is a **named
  follow-up** once the first capture screen forces a `nutrition.ts` copy.
- **No `forgot-password`/password-reset flow** in this plan (deferred, SF6 — needs the web
  origin in Supabase Auth's redirect allow-list).
- **No custom design system port.** Use plain Tailwind for v1; a real design pass is
  later.
- **No deploy to production hosting** in this plan (local `next dev` + a green
  `next build`). Vercel/hosting is a later plan.

## Proposed approach
Smallest thing that proves the architecture: **scaffold + shared-backend client + auth
+ one authed read.** Everything else is deferred to per-screen plans.

### 0. Repo location & identity
- New folder **`/Users/roham_abt/Desktop/calorie-count-web`** — a **sibling** of this
  repo, deliberately **without the space** in the path (the mobile repo's space-in-path
  is a known papercut; the CLAUDE.md even calls it out). Its own `git init`, its own
  `main`, its own `.gitignore`, its own CLAUDE.md/AGENTS.md later.
- **Not** nested inside this repo (would entangle the two git trees and Metro/Next
  tooling).

### 1. Scaffold — Next.js App Router
- `create-next-app@latest` with: **TypeScript, App Router, Tailwind, ESLint, `src/`
  dir, import alias `@/*`**, no Turbopack flag pinned (accept the tool default).
- Pin to the current stable Next.js the scaffolder installs; record the version in the
  repo's own README. Pin an explicit **`.nvmrc`** in the new repo (installed Node is
  v24.16.0 — fine for Next); the mobile repo has no `.nvmrc` to inherit.

### 2. Shared-backend Supabase clients (`@supabase/ssr`)
The web app needs **cookie-based** sessions (SSR/route handlers can read auth), which is
different from mobile's `AsyncStorage`. Use `@supabase/ssr`:
- `src/lib/supabase/client.ts` — `createBrowserClient<Database>(url, anonKey)` for Client
  Components.
- `src/lib/supabase/server.ts` — `createServerClient<Database>(url, anonKey, { cookies })`
  for Server Components / route handlers / middleware. **The RSC cookie adapter's
  `set`/`remove` must be a no-op / try-catch** — a Server Component can't write cookies and
  the default adapter throws "Cookies can only be modified in a Server Action or Route
  Handler" (SF8). All cookie **mutation** happens in middleware + server actions only.
- `src/middleware.ts` — the standard `@supabase/ssr` session-refresh middleware. Its
  **matcher must cover the `(app)` routes and exclude `_next/*` static assets** (SF10/NIT)
  so the cookie actually refreshes on protected pages.
- Env: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` in `.env.local`
  (git-ignored), **same values** as this repo's `.env` `EXPO_PUBLIC_*`. The anon key is
  publishable by design; RLS is the real guard (mirrors mobile). A `.env.example` with
  the key **names** (no values) is committed. **Fail-fast** on env in a validated module
  imported early — `NEXT_PUBLIC_*` are inlined at **build** time, so a missing value must
  fail the `next build`, not just at runtime (SF10). **Cookie flags:** `secure` +
  `sameSite=lax`; add a baseline CSP (`@supabase/ssr` cookies are JS-readable / not
  `httpOnly` by design — accepted, mitigated by CSP; SF12).

### 3. Shared data contract — reuse the generated `Database` types
- **Copy this repo's already-generated `src/types/database.ts`** into the web repo (or
  regenerate via `supabase gen types` against the shared project). Type the clients
  `createBrowserClient<Database>` / `createServerClient<Database>`, and derive the history
  row via `Pick<Database['public']['Tables']['meal_logs']['Row'], 'id' | 'dish_name' |
  'total_calories' | 'eaten_at' | 'image_path'>` — exactly the pattern
  `src/features/history/lib/use-meal-history.tsx` already uses. This gives correct
  **nullability** (`image_path`, `quality_score` nullable; `confidence` is the
  `'low'|'medium'|'high'` enum) for free — no hand-written, drift-prone `meal-log.ts`.
- **Do NOT copy `nutrition.ts` in this plan.** Nothing in the bootstrap consumes
  `MealAnalysis`/`Nutrients`/`FoodItem` — the `/history` read is flat `meal_logs` columns.
  The mirror copy moves to the first **capture** plan that actually imports it (and the
  shared-`@calorie/types`-package debate with it). Zero type-drift surface here.
- The table is **`meal_logs`** (plural; child `meal_items`), created in
  `supabase/migrations/20260619102510_initial_schema.sql` — NOT `create_meal_log.sql`
  (that file is the insert **RPC**, no `CREATE TABLE`).

### 4. Auth (email + password, mirrors mobile) — sign-in scope only
- Routes under `src/app/(auth)/`: **`sign-in` + `sign-up`** only. Use
  `signInWithPassword` / `signUp`. **`forgot-password`/reset is DEFERRED** (SF6): the reset
  + email-confirm links redirect to the project **Site URL** (currently mobile's
  deep-link), and making them return to web needs the web origin added to Supabase Auth's
  redirect allow-list — a backend config touch out of scope here.
- **`signUp` renders a "check your email" state, not a redirect** (B2): the shared project
  has email confirmation ON, so a successful `signUp` returns **no session**. Mirror
  mobile exactly.
- **`sign-in` handles `error.code === 'email_not_confirmed'`** with a **Resend**
  (`supabase.auth.resend`) affordance — mirror mobile (SF7).
- Session handling via SSR: Server Components / the protected layout gate on
  **`supabase.auth.getUser()`** (revalidates the JWT — NOT `getSession()`, which trusts the
  cookie unverified; SF3). A small **client** sign-out hook gets its own session via
  `createBrowserClient` — **the session/token is never passed as props across the
  RSC→Client boundary** (it would serialize into the stream; SF11). **Never log the
  session** anywhere (server actions/middleware included) — log at most `user.id` (mobile
  SECURITY note, extended).
- Protected layout `src/app/(app)/layout.tsx`: redirect to `/sign-in` when `getUser()`
  returns no user (server-side, before render — no flash). UX gate only; RLS is the real
  boundary.
- **Onboarding gate is intentionally NOT ported** (SF13): mobile forces a signed-in user
  with no `goals` row into onboarding; web does not. Acceptable because `/history` reads
  **nothing** from `goals` — but a later dashboard plan must handle a null `goals` row.

### 5. Proof-of-life authed read — `/history`
- `src/app/(app)/history/page.tsx` — a **Server Component** that, using the `user.id` from
  `getUser()`, queries `meal_logs` with an **explicit column allowlist** (no `select('*')`),
  an explicit **`.eq('user_id', user.id)`** (defense-in-depth, mirroring
  `use-meal-history.tsx` — RLS is still the boundary, the filter is the belt + an index
  hit), `.order('eaten_at', { ascending: false })`, and a **`.limit(n)`** (bound the pull;
  a heavy user's full health history must not stream on every load; SF5). Renders a plain
  list (dish, calories, date).
- **Error handling:** branch on `{ data, error }` → render an error state; use `data ?? []`
  for the empty case (SF9). An empty list renders an empty state, not a crash.
- **The proof is positive + isolation, not "empty"** (SF1/SF2): verify with an
  **already-confirmed** account known to have mobile-created meals → the list is
  **non-empty** and matches; a second account sees only its own rows. (An empty list for a
  fresh user proves nothing — and a mis-wired cookie adapter would run the query as `anon`
  and *also* return empty, silently faking a pass.)
- Photos are **out of scope here** (signed-URL minting mirrors a later plan); show text
  rows only. If `image_path` is present, show a "📷" marker, not the image.

### 6. Repo hygiene
- `README.md` (what it is, the shared-backend contract, env setup), `.gitignore`
  (`.env.local`, `.next`, `node_modules`), and defer CLAUDE.md/AGENTS.md/`docs/` to a
  follow-up so the new repo gets its own workflow docs intentionally.

## Files to change
**All in the NEW repo `/Users/roham_abt/Desktop/calorie-count-web` — none in this repo.**
- `package.json`, `next.config.*`, `tsconfig.json`, `tailwind.config.*`, `.gitignore`,
  `.env.example` — from the scaffold, lightly edited.
- `src/lib/supabase/client.ts` — browser client (`createBrowserClient`).
- `src/lib/supabase/server.ts` — server client (`createServerClient` + cookies).
- `src/middleware.ts` — `@supabase/ssr` session-refresh middleware.
- `src/types/database.ts` — **copy of the mobile generated `Database` types** (or
  `supabase gen types`). No hand-written `meal-log.ts`; no `nutrition.ts` copy (deferred).
- `src/lib/env.ts` — validated, fail-fast env module (SF10).
- `src/app/(auth)/sign-in/page.tsx`, `sign-up/page.tsx` — auth screens
  (**no** `forgot-password` — deferred, SF6).
- `src/app/(auth)/actions.ts` — server actions for sign-in/up/out.
- `src/app/(app)/layout.tsx` — protected layout (redirect via `getUser()`) + sign-out.
- `src/app/(app)/history/page.tsx` — authed proof-of-life meal list (filtered, bounded,
  error-handled).
- `README.md`, `.env.local` (git-ignored, real values), `.nvmrc`.

## Data model / schema impact
**None.** No tables, columns, migrations, RLS, storage, or Edge Function **code**
changes. The web app is a new client of the existing backend. The only backend-side
touch that may come *later* (not in this plan) is adding the web origin to the
`analyze-meal` CORS allow-list — and only when the capture flow ships.

## Edge cases & failure modes
- **Wrong/missing env** → a validated `src/lib/env.ts` **fails the `next build`** (not just
  runtime) with a clear message; `NEXT_PUBLIC_*` are build-time-inlined, so a runtime-only
  check would let a broken build pass the green-build gate (SF10).
- **Signed-out user hits `/history`** → protected layout redirects to `/sign-in`
  (server-side, before render — no flash of protected content).
- **Session expired mid-session** → middleware refresh handles the common case; a failed
  refresh drops to `/sign-in`.
- **RLS working as intended** → a user sees ONLY their own rows; the explicit test is a
  **non-empty** list for a confirmed, mobile-populated account, plus a second account
  seeing only its own rows (SF1/SF2). An empty list proves nothing (RLS-off, broken query,
  or `anon`-run query all look identical).
- **Anon key exposed in the browser** → expected and safe; it's publishable, RLS guards
  data (same posture as mobile's `EXPO_PUBLIC_*`). Never ship the **service-role** key to
  the browser (it must never enter this repo at all).
- **Cookie/SSR pitfalls** → use the official `@supabase/ssr` cookie wiring exactly;
  don't hand-roll cookie handling.
- **Type drift** → none in this plan (only `database.ts` is copied, regenerable via
  `supabase gen types`; no `nutrition.ts` copy yet).
- **Path with a space** (mobile repo) vs no-space (web repo) → intentional; the web repo
  avoids the papercut.
- **Empty history** (new user) → render an empty state, not a crash.

## Test / verify plan
- In the new repo: `npx tsc --noEmit` PASS; `npm run lint` (next lint) clean;
  `npm run build` (`next build`) succeeds.
- **Manual (browser):**
  1. `npm run dev` → `/sign-in` → sign in with an **already-confirmed** account that has
     meals created on mobile.
  2. Redirects to `/history` → the user's OWN meals list (dish + calories + date), and it
     is **non-empty** — cross-check a couple against the mobile app. (Non-empty is the real
     proof: it confirms the cookie/JWT reached Postgres; an empty list could just mean the
     query ran as `anon`.)
  3. **Isolation:** sign in as a second confirmed account → sees only ITS own rows, none of
     account 1's.
  4. Sign out → `/history` now redirects back to `/sign-in`.
  5. `signUp` with a new email → **"check your email" state** (no session, no redirect to
     `/history` — email confirmation is ON).
  6. `email_not_confirmed` sign-in → shows the **Resend** affordance.
  7. Break the env (rename `.env.local`) → the **build/boot fails clearly**, not a white
     screen.
- **Security gate:** grep the repo for the service-role key / any secret — none present;
  `.env.local` is git-ignored; no session/token is ever `console.log`'d; only the anon
  key + URL reach the browser bundle.

## Rollout
1. Create `/Users/roham_abt/Desktop/calorie-count-web`, `create-next-app`, `git init`,
   first commit (scaffold).
2. Add Supabase clients (typed `<Database>`) + middleware + validated `env.ts` +
   `.env.local` (copy the two `EXPO_PUBLIC_*` values from this repo's `.env` into
   `NEXT_PUBLIC_*`) + `.nvmrc`.
3. Copy `database.ts` from the mobile repo (or `supabase gen types`). (No `nutrition.ts`,
   no hand-written `meal-log.ts`.)
4. Build auth screens (sign-in + sign-up "check your email" + sign-out) + protected layout
   (`getUser()`) + the filtered/bounded/error-handled `/history` read.
5. `tsc` / lint / build; user browser-verify (sign-in + **non-empty** own-history +
   two-account isolation).
6. Commit to the new repo's `main`. (Push to a new remote is a follow-up once the user
   creates the GitHub repo — offer `gh repo create`.)
7. **Later, not now:** password-reset + web origin in the Auth **redirect allow-list**;
   when capture ships, the web origin in `analyze-meal`'s **CORS** allow-list; a `next
   build` deploy target (Vercel); confirm the **privacy policy** covers the web surface
   before exposing beyond localhost.

## Open questions
1. **Repo name / location** — proposed `calorie-count-web` as a Desktop sibling
   (no-space path). OK, or a different name/parent dir?
2. **GitHub remote now or later?** Proposed: local `git init` now; `gh repo create` +
   push as a quick follow-up once you confirm the repo name. (Creating a remote is an
   outward action — I'll confirm before pushing anywhere.)
3. **Type sharing** — RESOLVED (review): copy the generated `database.ts` (regenerable);
   the `nutrition.ts` mirror + shared-`@calorie/types`-package decision defer to the first
   capture plan.
4. **Auth parity** — mobile is email+password only (`signInWithPassword`/`signUp`). Web
   mirrors exactly. Any desire for OAuth/magic-link on web (a Supabase Auth setting) —
   or keep identical for now?
5. **Styling** — plain Tailwind for the bootstrap; real design system later. Fine?

---

## Review
_Balanced 4-lens review (correctness, architecture, edge cases, data/privacy),
2026-08-04. Findings consolidated + deduped below. Two BLOCKERs were each found
independently by 3–4 reviewers. All resolutions folded into the plan above._

### BLOCKER (resolved)
- **B1 — Wrong table name; the one authed read would 404.** The plan said the shared
  `meal_log` table (singular) and cited `20260623132156_create_meal_log.sql` as the
  column source — but that migration defines an **RPC**, not a table. The real table is
  **`public.meal_logs`** (plural), created in `20260619102510_initial_schema.sql`, with a
  child `meal_items`. `from('meal_log')` → PostgREST 404. **Resolution:** use `meal_logs`
  everywhere; source columns from the initial-schema migration; and (architecture)
  **reuse the mobile repo's already-generated `src/types/database.ts`** — type the clients
  `createServerClient<Database>` and derive the row via
  `Pick<Database['public']['Tables']['meal_logs']['Row'], …>`, exactly as
  `src/features/history/lib/use-meal-history.tsx` does. Drop the hand-written
  `meal-log.ts`.
- **B2 — Email confirmation is ON, so the verification is impossible as written.** The
  shared project has email confirmation enabled (`sign-up-screen.tsx`: a successful
  `signUp` returns **no session** + sends a confirmation email). So "sign up a fresh
  account → lands on an EMPTY history" (Test step 4, and the "done" line) cannot happen —
  the new user isn't signed in and the protected layout bounces them to `/sign-in`.
  **Resolution:** (1) web sign-up renders a **"check your email"** state (mirror mobile),
  never a redirect to `/history`; (2) **scope the bootstrap's auth to sign-IN of an
  already-confirmed account** as the proof path; (3) reframe the RLS proof — see SF1.

### SHOULD-FIX (folded in)
- **SF1 — An empty new-user history does NOT prove RLS isolation.** An empty result is
  consistent with RLS-on, RLS-off, or a broken query. **Fix:** the real proof is
  *positive + isolation* — user A signs in and sees **exactly their own N** mobile-created
  rows; a second confirmed account sees only its own. Verification must assert a
  **non-empty** list for a known-populated account (this also catches the false-empty in
  SF2).
- **SF2 — A misconfigured server client silently "passes" as empty.** If the
  `@supabase/ssr` cookie adapter isn't wired (or middleware doesn't run on the route), the
  query runs as **anon** and RLS returns zero rows — a populated user sees an empty list
  and the headline proof "passes" wrongly. **Fix:** assert non-empty for a known account;
  confirm the `cookies` adapter is actually exercised.
- **SF3 — Gate on `auth.getUser()`, not `getSession()`** (found by 3 lenses). On the
  server, `getSession()` trusts the cookie without revalidating the JWT (spoofable);
  Supabase's guidance is `getUser()` for any authz decision. **Fix:** `middleware.ts` and
  `(app)/layout.tsx` gate on `getUser()`; derive `user.id` from it. (RLS still protects the
  read either way — PostgREST re-verifies — but the gate must use `getUser()`.)
- **SF4 — Keep explicit `.eq('user_id', user.id)` + a column allowlist** (no `select('*')`).
  Mobile's `use-meal-history.tsx` documents this as **mandatory defense-in-depth** (leak
  guard if RLS were ever misconfigured, plus an index hit). Diverging in the second client
  — whose whole point is proving RLS — sets the wrong precedent. **Fix:** mirror mobile:
  RLS is the boundary, the filter + allowlist are the belt.
- **SF5 — Bound the read.** The `/history` select had no `.limit()` — a heavy user pulls
  their entire health-data history on every load. **Fix:** `.limit(n)` / range pagination;
  select only the list columns (id, dish_name, total_calories, eaten_at, has-image bool).
- **SF6 — Confirmation / reset links use the project Site URL (mobile), not the web
  origin** (found by 3 lenses). Password-reset + email-confirm redirect to a URL that must
  be in Supabase Auth's **redirect allow-list**; only the mobile deep-link is there today,
  and a careless wildcard is an open-redirect that leaks the recovery token. **Fix:** DROP
  `forgot-password` (and the reset-password landing route) from the bootstrap scope; ship
  **sign-in + sign-up("check your email") + sign-out** only. Password-reset + the web
  origin in the Auth allow-list become a named follow-up. This also clears SF's
  "half-feature" and "missing update-password route" findings.
- **SF7 — Handle `email_not_confirmed` on sign-in.** Mobile catches
  `error.code === 'email_not_confirmed'` and offers **Resend** (`supabase.auth.resend`).
  **Fix:** mirror the resend path so an unconfirmed user isn't stuck on a generic error.
- **SF8 — Server-Component cookie-write no-op.** The `@supabase/ssr` server client's
  `set`/`remove` cookie adapter throws "Cookies can only be modified in a Server Action or
  Route Handler" if invoked from a Server Component. **Fix:** use the official adapter that
  swallows that write in RSC context; all cookie **mutation** happens in middleware +
  server actions only.
- **SF9 — Handle the `/history` query error path.** Branch on `{ data, error }` → render an
  error state; use `data ?? []` for empty. An expired-mid-request token or transient
  PostgREST error otherwise crashes the Server Component.
- **SF10 — Fail-fast on env at build/startup.** `NEXT_PUBLIC_*` are **inlined at build
  time**; a `next build` with a missing `.env.local` embeds `undefined` and still goes
  green (the plan's own gate), failing only at runtime. **Fix:** a validated env module
  imported early so a misconfigured build fails the build.
- **SF11 — Don't serialize the session/tokens across the RSC→Client boundary.** Anything a
  Server Component passes as props to a Client Component is serialized into the
  HTML/RSC stream. **Fix:** the client sign-out hook gets its **own** session via
  `createBrowserClient`; never receive `session`/`access_token` as props. (SSR extension of
  mobile's "never log the session" rule.)
- **SF12 — Cookie flags + XSS posture for health data.** `@supabase/ssr` auth cookies are
  JS-readable by the browser client (not `httpOnly` — inherent to the lib), an XSS
  token-theft vector the RN app lacks. **Fix:** set `secure` + `sameSite=lax`; add a
  baseline CSP in `next.config`/middleware; note the non-`httpOnly` limitation as a
  conscious accepted risk.
- **SF13 — Onboarding-gate divergence.** Mobile hard-gates a signed-in user with no
  `goals` row into onboarding (`_layout.tsx` + `use-onboarding-status.tsx`); web has no
  equivalent. Acceptable for a read-only history bootstrap, but **must be stated**: web
  does NOT gate on onboarding, `goals` may be absent, and `/history` reads nothing from
  `goals` (a later dashboard plan must handle the null `goals` row).

### NIT (addressed/noted)
- Defer the `nutrition.ts` mirror entirely — the bootstrap has **zero consumer** for
  `MealAnalysis`/`Nutrients`/`FoodItem` (the `/history` read is flat `meal_logs` columns),
  and the "must match DB columns" rationale was wrong (the DB-row type models columns, not
  `nutrition.ts`). It moves to the first capture plan. This also empties the type-drift
  surface OQ3 worried about. • Row type must model **nullability** (`image_path`,
  `quality_score`, `quality_factors`/`assumptions` nullable; `confidence` is a
  `'low'|'medium'|'high'` enum) — free via `database.ts`. • Middleware **matcher** must
  cover `(app)` routes and exclude `_next/*` static assets. • No `.nvmrc` exists in the
  mobile repo — pin an explicit `.nvmrc` in the web repo (installed Node is v24.16.0, fine
  for Next). • Extend "never log the session" to **server actions / middleware / query
  results** (log at most `user.id`; `meal_logs` rows are health data — never to any log or
  analytics sink). • Confirm the **privacy policy** covers the new web surface before it's
  exposed beyond localhost (follow-up).
- **Confirmed correct, no change:** the central bet — `createServerClient(url, anonKey,
  {cookies})` attaches the cookie JWT so `auth.uid()` resolves and RLS
  (`auth.uid() = user_id`, default-deny per-verb) filters server-side — is **sound**. A
  separate sibling repo (no-space path) + App Router + `@supabase/ssr` is the right grain,
  not over-engineered (SSR cookies are exactly what buys the desktop/SEO goal). Photos
  correctly out of scope (📷 marker, no `<img>`, no signed URL). Service-role key correctly
  excluded from the browser/repo. **CORS correctly deferred** — the read goes through
  PostgREST (Supabase-managed CORS), not the Edge Function.

### Verdict
**NEEDS CHANGES → RESOLVED.** Two blockers (B1 wrong table + `database.ts` reuse; B2
email-confirmation breaks the proof), both folded in. Scope tightened to
**sign-in + sign-up("check your email") + sign-out + one bounded, filtered, error-handled
`meal_logs` read gated on `getUser()`**; `forgot-password`/reset and the `nutrition.ts`
copy deferred to follow-ups. With those edits applied above, the plan is **APPROVED** for
execution.

## Execution log
Built per the approved plan in the new sibling repo
**`/Users/roham_abt/Desktop/calorie-count-web`** (own `git init`, `main`).
`create-next-app` (Next **16.3.0**, App Router, TS, Tailwind, `src/`, `@/*`) +
`@supabase/ssr`/`@supabase/supabase-js`. Files: `src/lib/env.ts` (fail-fast, SF10);
`src/lib/supabase/{client,server}.ts` typed `<Database>`, server `setAll` try/catch
no-op for RSC (SF8); session-refresh interceptor; `(auth)/actions.ts` +
`sign-in`/`sign-up` screens (sign-up → "check your email", B2; `email_not_confirmed`
→ Resend, SF7); `(app)/layout.tsx` gated on `getUser()` (SF3) + server-action sign-out
(no token across RSC→Client, SF11); `(app)/history/page.tsx` reads `meal_logs` with
column allowlist + `.eq('user_id', user.id)` + `.limit(100)` + error branch (SF4/5/9);
`database.ts` copied from mobile (no `nutrition.ts`, no hand-written `meal-log.ts`);
root `/` → `/history`; `.nvmrc` (24), `.env.local` (git-ignored; `!.env.example`
committed), README.

**Deviation (accepted):** Next **16** deprecated the `middleware` file convention in
favor of **`proxy`** — renamed `src/middleware.ts` → `src/proxy.ts`, `export function
proxy` (same @supabase/ssr session-refresh wiring + matcher). Build is warning-free.

**Verified:** `tsc --noEmit` PASS; `next lint` clean; `next build` green (routes `/`,
`/sign-in`, `/sign-up`, ƒ `/history`, ƒ Proxy); no secret/service-role in tracked files;
`.env.local` confirmed git-ignored. Committed to the web repo's `main` (`fc473d1`).
**PENDING: user browser-verify** (sign-in + non-empty own-history + isolation) before
flipping to Done. GitHub remote push deferred (OQ2 — confirm first).
