# Plan: Navigation skeleton + auth provider (Phase A — Step 3)

- **Status**: Done (2026-06-19) — executed per the approved plan; tsc + lint clean. Device verification pending (see Execution log).
- **Created**: 2026-06-19
- **Plan #**: 0003

## Problem / Goal
Step 3 of Phase A (the trunk). The app currently boots straight into the Expo
template's tab navigator ([src/app/_layout.tsx](../../src/app/_layout.tsx) renders
`<AppTabs/>` directly) with no concept of authentication. Before S1 can build auth
screens, the trunk must own:
1. An **auth session provider + `useUser` hook** in `src/lib/auth/` that holds the
   Supabase Auth session, restores it on launch (AsyncStorage is already wired in
   [src/lib/supabase.ts](../../src/lib/supabase.ts)), and stays in sync via
   `onAuthStateChange`.
2. A **navigation skeleton with an auth gate**: signed-out users land in an
   `(auth)` group, signed-in users in the `(app)` group (the tabs). Implemented with
   Expo Router's `Stack.Protected guard={…}` (the SDK 53+ idiomatic pattern,
   confirmed for SDK 56 via the Expo docs).
3. **Brand-synced navigation theme** — feed expo-router's `ThemeProvider` a theme
   derived from our `Colors` tokens instead of stock `DefaultTheme`/`DarkTheme`
   (the deferred review item SF16 from plan 0002).

**Done looks like:** launching the app with no session shows the `(auth)` group;
acquiring a session (via a temporary, clearly-marked `__DEV__` sign-in, since the
real screens are S1's) flips the UI to the `(app)` tabs without a remount glitch;
signing out flips it back. Session survives an app restart. `tsc` + lint clean.
The provider/hook are importable as `@/lib/auth` so S1 builds on top without
touching the trunk.

## Non-goals
- **No auth feature screens** (sign-up / login / password-reset / onboarding UI).
  Those are **S1's** job in `src/features/auth/`. We ship only a *placeholder*
  `(auth)` route + a `__DEV__`-only temporary sign-in to make the gate testable.
- **No profile/settings, no real home/diary/capture screens.** The existing
  template `index.tsx`/`explore.tsx` are kept (moved into `(app)/`) as placeholders
  until later steps replace them.
- **No new product tabs** or tab redesign — keep the current Home/Explore tabs.
- **No deep-linking / email-confirmation redirect handling** beyond what Supabase
  does by default (flag for S1's password-reset work).
- **No changes to the DB, RLS, or Edge Functions.**
- **Not** removing the cosmetic `AnimatedSplashOverlay` — we reconcile it with the
  new auth-loading splash control, not replace it.

## Proposed approach

### 1. Auth provider + hook — `src/lib/auth/`
- `src/lib/auth/auth-provider.tsx` — `AuthProvider` React context.
  - State: `session: Session | null`, `user: User | null` (= `session?.user`),
    `loading: boolean` (true until the initial session restore resolves).
  - On mount: `supabase.auth.getSession()` **wrapped in try/catch** (SF2) → set
    initial state; on any reject (corrupt AsyncStorage) treat as signed-out
    (`session=null`), set `loading=false`, hide splash, and log **only**
    `error.message` — never the session/storage payload. Then subscribe via
    `supabase.auth.onAuthStateChange((_event, session) => …)` to keep state live
    (covers sign-in, sign-out, token refresh). **Unsubscribe** on unmount
    (`data.subscription.unsubscribe()`).
  - **SF1 — token hygiene:** NEVER log the `session` object in the callback or
    catch; at most log `session?.user?.id`. Tokens (`access_token`/`refresh_token`)
    must not reach console/analytics/storage logs.
  - Expose `signOut: () => Promise<void>` (calls `supabase.auth.signOut()`) — a
    trunk-level concern used by the gate test and later by Settings. **N2:** catch
    & swallow (log only) — the client is signed out regardless of a server error.
  - Types come from `@supabase/supabase-js` (`Session`, `User`).
  - **SF6 (known limitation):** the session persists via AsyncStorage (iOS
    Keychain-backed; Android relies on device encryption). Acceptable for v1;
    a later hardening pass may move token storage to `expo-secure-store` (out of
    scope here — would touch the `supabase.ts` singleton).
- `src/lib/auth/use-auth.ts` — `useAuth()` returns the full context; **N1:**
  `if (!context) throw new Error('useAuth must be used within AuthProvider')`.
- `src/lib/auth/use-user.ts` — `useUser()` convenience returning just
  `user` (and `loading`), per the handoff's named hook.
- `src/lib/auth/index.ts` — barrel: `AuthProvider`, `useAuth`, `useUser`.

### 2. Route restructure (Expo Router groups + protected gate)
Move the template screens into an `(app)` group and add an `(auth)` group; groups
are parenthesized so they **don't change URLs** (`/` and `/explore` stay valid).

```
src/app/
  _layout.tsx          ← root: AuthProvider + brand ThemeProvider + splash control
                          + RootNavigator (the Stack.Protected gate)
  (app)/
    _layout.tsx        ← the tab navigator (renders <AppTabs/>, moved from old root)
    index.tsx          ← moved from src/app/index.tsx (unchanged content)
    explore.tsx        ← moved from src/app/explore.tsx (unchanged content)
  (auth)/
    _layout.tsx        ← a <Stack> for auth screens
    sign-in.tsx        ← PLACEHOLDER (+ __DEV__ temp sign-in; S1 replaces)
```

- **Root `_layout.tsx`:**
  ```tsx
  import { useColorScheme } from 'react-native';   // SF4/N3: RN hook directly at root
  SplashScreen.preventAutoHideAsync();          // module scope, exactly once

  export default function RootLayout() {
    const scheme = useColorScheme();             // 'light' | 'dark' | null
    const navTheme = useMemo(() => buildNavTheme(scheme), [scheme]);  // SF4: memoized
    return (
      <AuthProvider>
        <ThemeProvider value={navTheme}>        // navTheme derived from Colors
          <RootNavigator />
          <AnimatedSplashOverlay />             // cosmetic flourish, kept
        </ThemeProvider>
      </AuthProvider>
    );
  }
  // SF4: module-level sibling, NOT nested in RootLayout.
  function RootNavigator() {
    const { session, loading } = useAuth();
    useEffect(() => { if (!loading) SplashScreen.hideAsync(); }, [loading]);
    if (loading) return null;                   // native splash stays under overlay; no auth flash
    // SF3: Stack.Protected is a UX gate only — RLS (plan 0001) is the real
    // boundary. guard={!!session} and guard={!session} are exact complements,
    // so exactly one branch is always active once loading===false.
    return (
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected guard={!!session}>
          <Stack.Screen name="(app)" />
        </Stack.Protected>
        <Stack.Protected guard={!session}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
      </Stack>
    );
  }
  ```
- **`(app)/_layout.tsx`:** returns `<AppTabs/>` (the existing native-tabs component).
  `NativeTabs.Trigger name="index"/"explore"` and the web `href="/"`/`"/explore"`
  resolve correctly inside the group (group adds no URL segment).
- **`(auth)/_layout.tsx`:** `<Stack screenOptions={{ headerShown: false }}>` with
  `<Stack.Screen name="sign-in" />` declared **first** (SF5) — this is the
  deterministic protected-redirect anchor; S1 must keep the `sign-in` route name.
- **`(auth)/sign-in.tsx`:** placeholder using our design system (`Screen`, `Text`,
  and — guarded by `__DEV__` — `Input`/`Button`) that calls
  `supabase.auth.signInWithPassword` **only**. **B1: NO `signUp`** — the client
  points at the prod Supabase project, so the test user is created manually in the
  Supabase dashboard (Auth → Users) before testing; `signUp` would pollute prod
  `auth.users`. Clearly commented **TEMP — remove when S1 lands**. Lets us prove
  the gate flips. (Dog-foods plan 0002's primitives.)

### 3. Brand-synced navigation theme
Build `navTheme` from `Colors` for both schemes and pass to expo-router's
`ThemeProvider` so headers/native chrome match the green brand (review SF16):
```ts
// SF4: a plain helper (not a hook), called inside useMemo(…, [scheme]) at root.
function buildNavTheme(scheme) {
  return scheme === 'dark'
    ? { ...DarkTheme,  colors: { ...DarkTheme.colors,  primary: Colors.dark.primary,  background: Colors.dark.background,  card: Colors.dark.backgroundElement,  text: Colors.dark.text,  border: Colors.dark.border } }
    : { ...DefaultTheme, colors: { ...DefaultTheme.colors, primary: Colors.light.primary, background: Colors.light.background, card: Colors.light.backgroundElement, text: Colors.light.text, border: Colors.light.border } };
}
```
Call the RN `useColorScheme()` once at the root and coalesce `null`/`'unspecified'`
→ light (any non-`'dark'` value falls into the light branch above — same rule as
the fixed `useTheme`).

### 4. Fix the duplicated buggy scheme logic in `app-tabs`
Both [app-tabs.tsx](../../src/components/app-tabs.tsx) and
[app-tabs.web.tsx](../../src/components/app-tabs.web.tsx) compute
`Colors[scheme === 'unspecified' ? 'light' : scheme]` — the **same `null` bug** we
fixed in `useTheme` (plan 0002). Replace with `useTheme()` so a `null` scheme
doesn't yield `undefined` colors. Small, in-scope correctness fix.

## Files to change
- `src/lib/auth/auth-provider.tsx` — **new**: `AuthProvider` + context.
- `src/lib/auth/use-auth.ts` — **new**: `useAuth()`.
- `src/lib/auth/use-user.ts` — **new**: `useUser()`.
- `src/lib/auth/index.ts` — **new**: barrel.
- `src/app/_layout.tsx` — **rewrite**: AuthProvider + brand ThemeProvider + splash
  control + `RootNavigator` with `Stack.Protected` gate.
- `src/app/(app)/_layout.tsx` — **new**: renders `<AppTabs/>`.
- `src/app/(app)/index.tsx` — **moved** from `src/app/index.tsx` (content unchanged;
  fix the `@/` self-references in comments if any — none functional).
- `src/app/(app)/explore.tsx` — **moved** from `src/app/explore.tsx` (unchanged).
- `src/app/index.tsx`, `src/app/explore.tsx` — **deleted** (moved into `(app)/`).
- `src/app/(auth)/_layout.tsx` — **new**: `<Stack>`.
- `src/app/(auth)/sign-in.tsx` — **new**: placeholder + `__DEV__` temp sign-in.
- `src/components/app-tabs.tsx` — **edit**: use `useTheme()` (fix null-scheme bug).
- `src/components/app-tabs.web.tsx` — **edit**: use `useTheme()` (same fix).

No `tsconfig`/`app.json` changes — `expo-router/entry` + `typedRoutes` already on
(typed routes will regenerate for the new group paths on next start).

## Data model / schema impact
None. No tables, columns, migrations, RLS, or buckets. Uses existing Supabase Auth
+ the already-configured client. The anon key in `.env` (`EXPO_PUBLIC_*`) is public
by design; no new secrets.

## Edge cases & failure modes
- **Session-restore flash:** must not show `(auth)` for a frame before the session
  loads. Handled by `loading` gate (render `null` + keep native splash until
  `getSession()` resolves).
- **Token refresh / expiry while running:** `onAuthStateChange` fires
  `TOKEN_REFRESHED`/`SIGNED_OUT`; provider updates → gate reacts. Verify a forced
  sign-out elsewhere flips the UI.
- **`onAuthStateChange` listener leak / double-subscribe:** must unsubscribe on
  unmount and not create multiple clients. Single `supabase` singleton already
  exists — reuse it.
- **Offline launch:** `getSession()` reads cached AsyncStorage session (no network);
  app should open to `(app)` if a cached session exists, even offline. Refresh may
  fail silently until back online — acceptable; don't block the gate on a network
  call.
- **Provider used outside tree:** `useAuth()`/`useUser()` throw a clear error
  rather than returning undefined.
- **Deep link / direct URL to a protected route on web:** `Stack.Protected`
  redirects to the anchor/first available screen when the guard is false — verify
  hitting `/explore` while signed-out lands on `(auth)`.
- **Web hydration:** root color scheme uses the same null-safe coalescing; the
  `navTheme` must be stable enough not to flash. (Plan 0002 already handles the
  scheme hook.)
- **Splash double-control:** `AnimatedSplashOverlay` (cosmetic JS overlay) +
  `expo-splash-screen` (native) must not deadlock — native hide is driven only by
  `loading`, the overlay self-removes after its animation. Verify no permanent
  blank screen if `loading` never flips (guard: also hide on error).
- **`getSession()` rejects** (corrupt storage): catch → treat as signed-out, set
  `loading=false`, hide splash (don't hang on the splash forever).
- **Temp `__DEV__` sign-in in production:** must be compiled out / never shipped —
  gate the screen's form behind `__DEV__` and track its removal with S1.

## Test / verify plan
1. `npx tsc --noEmit` — clean.
2. `npm run lint` — clean.
3. **Manual (Expo Go / web):**
   - Fresh launch, no session → lands on `(auth)` placeholder (no flash of tabs).
   - Use the `__DEV__` temp sign-in with a **test user created in the Supabase
     dashboard** (Auth → Users) — `signInWithPassword` only, NO `signUp` (B1) → UI
     flips to `(app)` tabs; Home/Explore both render; brand-green chrome visible.
   - **Splash never hangs:** native splash stays under the overlay during restore
     and hides once `loading` flips; confirm a corrupt/empty session still resolves
     to `(auth)` (no permanent blank/splash).
   - Kill & relaunch the app → still signed in (session persisted), opens to tabs.
   - Tap **Sign out** (temp button) → flips back to `(auth)`.
   - Signed-out, navigate directly to `/explore` (web) → redirected to `(auth)`.
   - Toggle OS light/dark → nav chrome + screens recolor; no `undefined`-color
     crash (app-tabs fix).
4. Confirm `import { AuthProvider, useAuth, useUser } from '@/lib/auth'` resolves.
5. Remove/verify the temp sign-in is `__DEV__`-only before commit.

## Rollout
No migrations/secrets/deploys. Order:
1. Add `src/lib/auth/` provider + hooks.
2. Restructure routes into `(app)`/`(auth)`; rewrite root `_layout`.
3. Add brand `navTheme`; fix `app-tabs` scheme bug.
4. Add `(auth)` placeholder + `__DEV__` temp sign-in.
5. Verify (tsc/lint/manual). Append `docs/JOURNAL.md`, mark Done, commit to `main`.
6. Hand to **S1**: real auth screens replace the placeholder; remove the temp
   sign-in; S1 also handles password-reset deep links.

## Open questions — RESOLVED in review
1. **Test user for gate verification:** ~~signUp in temp form?~~ **RESOLVED (B1):**
   create the test user manually in the Supabase dashboard; temp form is
   `signInWithPassword`-only. No `signUp` against the prod project.
2. **`useUser` shape:** **RESOLVED:** keep minimal = `{ user, loading }`; richer
   access via `useAuth()`.
3. **Keep `index.tsx`/`explore.tsx` template content** as the `(app)` placeholders:
   **RESOLVED:** keep them moved & unchanged (smaller diff); add the temp Sign-out
   button to Home.
4. **AnimatedSplashOverlay:** **RESOLVED:** keep as-is (cosmetic, sits above the
   native splash so it can't cause a gap — verified in review); revisit when we
   design the real splash.
5. **`(auth)` anchor route name:** **RESOLVED (SF5):** `sign-in` is the anchor;
   declared first in `(auth)/_layout.tsx`; documented for S1 to keep stable.

## Deferred (post-review, not blocking)
- **Token storage hardening (SF6):** consider `expo-secure-store` for the auth
  session instead of AsyncStorage for this health-data app. Touches the
  `supabase.ts` singleton — schedule as its own small plan after Phase A.

---

## Review
_Reviewed 2026-06-19 by a 4-lens multi-agent pass (correctness, architecture,
edge-cases, data/privacy). Findings consolidated & deduped below. Three reviewer
"blockers"/nits were fact-checked and **dismissed** — see "Dismissed" at the end._

**Verdict: NEEDS CHANGES → RESOLVED (1 blocker, now fixed in-plan).**
The blocker and all should-fixes below have been folded into the plan sections
above. Re-review not required (changes are clarifications/guards, not a redesign).

### BLOCKER
- **B1 — Temp `__DEV__` sign-in must NOT create users in the prod Supabase project.**
  There is a single Supabase project and `.env` points the client at it (prod).
  Open question #1 leaned toward letting the temp form do `signUp` — that would
  write real rows into the prod `auth.users` table and pollute it.
  **Resolution (applied):** the temp form is **`signInWithPassword`-only**. A test
  user is created **manually in the Supabase dashboard** (Auth → Users) before
  testing. `signUp` is explicitly out of scope for the temp form. Open question #1
  settled accordingly; §2 + Test plan updated.

### SHOULD-FIX
- **SF1 — Never log the `session` object.** The Supabase `Session` holds
  `access_token`/`refresh_token`. The `onAuthStateChange` callback and the
  `getSession()` catch must log at most `session?.user?.id` — never the session or
  raw storage. **Applied:** added as an explicit rule in §1.
- **SF2 — `getSession()` must be wrapped so `loading` always resolves & splash
  always hides.** The edge-case list mentioned this but the code template didn't
  show it; if `getSession()` rejects (corrupt AsyncStorage) the splash hangs
  forever. **Applied:** §1 now mandates a try/catch → `session=null`,
  `loading=false`, hide splash, log only the error message. (No artificial network
  timeout — `getSession()` reads local AsyncStorage, makes no network call, so a
  timeout would be over-engineering. The token *refresh* is what can be slow, and
  the plan already does not block the gate on it.)
- **SF3 — `Stack.Protected` is a UX gate, not a security boundary.** Document so no
  future contributor treats it as access control. RLS (plan 0001) is the real
  boundary; the app must still handle 401/403. **Applied:** comment noted in §2.
- **SF4 — Memoize `navTheme` and lift `RootNavigator` to module scope.** As written
  `navTheme` rebuilds every render and `RootNavigator` is redefined inside
  `RootLayout`. **Applied:** §3 now wraps `navTheme` in `useMemo(…, [scheme])` and
  `RootNavigator` is a sibling module-level component.
- **SF5 — Pin `sign-in` as the `(auth)` group's first/anchor route.** The
  protected-redirect target must be deterministic on web deep-links. **Applied:**
  settles open question #5 — `(auth)/_layout.tsx` declares `<Stack.Screen
  name="sign-in" />` first; documented for S1 to keep the name stable.
- **SF6 — Document the AsyncStorage-session-at-rest assumption (health data).**
  Tokens persist via AsyncStorage (iOS Keychain-backed; Android relies on device
  encryption). **Applied:** recorded as a known v1 limitation in §1; actual move to
  `expo-secure-store` deferred (out of scope, would touch the established
  `supabase.ts` singleton — flag for a later hardening pass, tracked in Open
  questions).

### NIT
- **N1 — `useAuth()`/`useUser()` throw-guard shown in code.** Plan text already
  requires it (§1); add the `if (!context) throw new Error('useAuth must be used
  within AuthProvider')` to the implementation. (Folded into §1.)
- **N2 — `signOut()` should catch & not re-throw.** Offline/expired-token signOut
  may reject; the client is signed out regardless, so log and swallow. (Folded into §1.)
- **N3 — Use the RN `useColorScheme()` directly at root for `navTheme`** (not the
  wrapped hook), and reuse `useTheme()` inside `app-tabs` (don't re-implement the
  null-coalescing). Already the plan's intent; noted for clarity.

### Dismissed (fact-checked, not real)
- **"Both `Stack.Protected` guards can be false simultaneously → blank screen."**
  `guard={!!session}` and `guard={!session}` are exact complements; once
  `loading===false` exactly one is always true. No such state exists.
- **"`__DEV__` is a runtime flag, ships to prod and bloats the bundle."** Metro
  substitutes `__DEV__ → false` in production builds and dead-code-eliminates the
  branch; the temp form is compiled out. (Still keep it `__DEV__`-gated and remove
  in S1 for hygiene.)
- **"AnimatedSplashOverlay hides at 600ms, leaving a gap before the native
  splash."** Verified `animated-icon.tsx`: the native splash is hidden only when
  `loading` flips false, so it remains *underneath* the overlay for the entire
  loading window — no gap. Kept only as a manual verify step.

## Execution log
**2026-06-19 — executed, no deviations from the approved plan.**

Built exactly as specified after the review fixes:
- `src/lib/auth/` — `auth-provider.tsx` (`AuthProvider` + context; `getSession()`
  in try/catch → always resolves `loading` & never logs the session [SF1/SF2];
  `onAuthStateChange` subscribe/unsubscribe via an `active` flag; `signOut` catches
  & swallows [N2]), `use-auth.ts` (throw-guard [N1]), `use-user.ts`
  (`{ user, loading }`), `index.ts` barrel. `@/lib/auth` resolves.
- Routes restructured with `git mv` (history preserved): `(app)/_layout.tsx`
  renders `<AppTabs/>`; `index.tsx`/`explore.tsx` moved unchanged; `(auth)/_layout.tsx`
  declares `sign-in` first [SF5]; `(auth)/sign-in.tsx` placeholder with a
  `__DEV__`-gated `signInWithPassword`-only form [B1].
- Root `_layout.tsx` rewritten: `AuthProvider` → brand `ThemeProvider`
  (`buildNavTheme` memoized over scheme [SF4]) → module-level `RootNavigator`
  [SF4] with the `Stack.Protected` complementary-guard gate + native-splash hide
  on `!loading`; `AnimatedSplashOverlay` kept.
- `app-tabs.tsx` + `app-tabs.web.tsx` null-scheme bug fixed by switching to
  `useTheme()` (dropped the `Colors[...]`/`useColorScheme` indexing).
- Temp dev **Sign out** button added to the Home placeholder.

**Verified:** `npx tsc --noEmit` → exit 0; `npm run lint` → exit 0.

**Confirmed against node_modules (per AGENTS.md):** `expo-router@56.2.10` exports
`Stack.Protected`, `ThemeProvider`, `DefaultTheme`, `DarkTheme`;
`expo-splash-screen@56.0.10` present.

**DEVIATION (2026-06-19) — `app.json` `web.output` `static` → `single`.**
The plan said "no `app.json` changes". On `expo start --web`, the default
`output: "static"` server-renders the route tree in Node; wiring `AuthProvider`
into the root layout pulls the `supabase` client into SSR, which auto-initializes
its AsyncStorage (web → `window.localStorage`) and crashes with
`ReferenceError: window is not defined`, killing the dev server. Switched web to
SPA mode (`output: "single"`, client-only render) — the idiomatic Expo setting for
a mobile-first app behind a login gate (no SEO/SSR need). Native (iOS/Android) is
unaffected (`web.output` is web-only). One-line change; re-verified below.

**Web verification (DONE):** after the fix, `expo start --web` boots clean
(`Web Bundled … 1357 modules`, HTTP 200, no runtime errors in the Metro log).
Drove headless Chrome against `http://localhost:8081/`: signed-out launch renders
the `(auth)/sign-in` placeholder (title "Calorie Counter", "Sign in to continue",
Email/Password inputs, full-width brand-green "Sign in" button) and **no** Home
("Welcome to Expo") content — the gate correctly holds the signed-out branch. This
also clears **plan 0002's deferred visual check** (the screen renders
`Screen`/`Text`/`Input`/`Button` correctly, brand green visible).

**Still pending — signed-in flip + native (Expo Go) verification.** Blocked on a
**confirmed** Supabase user: the project requires email confirmation, so a
script-created `signUp` user returns `email_not_confirmed` at login (no
service-role key / inbox access to confirm it). Needs a dashboard-created
auto-confirmed user (or temporarily disabling "Confirm email"). Then verify on web
+ phone: sign-in flips to `(app)` tabs, restart persists, sign-out flips back.
NOTE: a throwaway unconfirmed user `calorie.counter.s3test@gmail.com` was created
in the prod project during testing — delete or confirm it.
