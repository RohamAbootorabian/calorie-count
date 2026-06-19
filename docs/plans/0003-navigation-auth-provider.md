# Plan: Navigation skeleton + auth provider (Phase A — Step 3)

- **Status**: Draft (awaiting `/review-plan` — do NOT code yet)
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
  - On mount: `supabase.auth.getSession()` → set initial state; then subscribe via
    `supabase.auth.onAuthStateChange((_event, session) => …)` to keep state live
    (covers sign-in, sign-out, token refresh). **Unsubscribe** on unmount
    (`data.subscription.unsubscribe()`).
  - Expose `signOut: () => Promise<void>` (calls `supabase.auth.signOut()`) — a
    trunk-level concern used by the gate test and later by Settings.
  - Types come from `@supabase/supabase-js` (`Session`, `User`).
- `src/lib/auth/use-auth.ts` — `useAuth()` returns the full context; throws a clear
  error if used outside `AuthProvider`.
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
  SplashScreen.preventAutoHideAsync();          // module scope
  export default function RootLayout() {
    return (
      <AuthProvider>
        <ThemeProvider value={navTheme}>        // navTheme derived from Colors
          <RootNavigator />
          <AnimatedSplashOverlay />             // cosmetic flourish, kept
        </ThemeProvider>
      </AuthProvider>
    );
  }
  function RootNavigator() {
    const { session, loading } = useAuth();
    useEffect(() => { if (!loading) SplashScreen.hideAsync(); }, [loading]);
    if (loading) return null;                   // native splash stays; no auth flash
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
- **`(auth)/_layout.tsx`:** `<Stack screenOptions={{ headerShown: false }} />`.
- **`(auth)/sign-in.tsx`:** placeholder using our design system (`Screen`, `Text`,
  and — guarded by `__DEV__` — `Input`/`Button`) that calls
  `supabase.auth.signInWithPassword`. Clearly commented **TEMP — remove when S1
  lands**. Lets us prove the gate flips. (Dog-foods plan 0002's primitives.)

### 3. Brand-synced navigation theme
Build `navTheme` from `Colors` for both schemes and pass to expo-router's
`ThemeProvider` so headers/native chrome match the green brand (review SF16):
```ts
const navTheme = scheme === 'dark'
  ? { ...DarkTheme,  colors: { ...DarkTheme.colors,  primary: Colors.dark.primary,  background: Colors.dark.background,  card: Colors.dark.backgroundElement,  text: Colors.dark.text,  border: Colors.dark.border } }
  : { ...DefaultTheme, colors: { ...DefaultTheme.colors, primary: Colors.light.primary, background: Colors.light.background, card: Colors.light.backgroundElement, text: Colors.light.text, border: Colors.light.border } };
```
Use `useColorScheme()` once at the root (coalesce `null`/`'unspecified'` → light,
same rule as the fixed `useTheme`).

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
   - Use the `__DEV__` temp sign-in with a **test user** (create one in the
     Supabase dashboard, or via `supabase.auth.signUp` in the temp form) → UI flips
     to `(app)` tabs; Home/Explore both render; brand-green chrome visible.
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

## Open questions
1. **Test user for gate verification:** create a throwaway user via the Supabase
   dashboard, or let the temp `__DEV__` form do `signUp` then `signInWithPassword`?
   (Lean: temp form supports both — quickest, fully local.)
2. **`useUser` shape:** return just `{ user, loading }`, or also `session`/`signOut`
   for convenience? (Lean: keep `useUser` minimal = `{ user, loading }`; richer
   access via `useAuth()`.)
3. **Keep `index.tsx`/`explore.tsx` template content** as the `(app)` placeholders,
   or strip to a bare "signed in ✓ / Sign out" screen now? (Lean: keep them moved &
   unchanged — smaller diff; real screens come later. Add the temp Sign-out button
   to Home.)
4. **AnimatedSplashOverlay:** keep as-is (cosmetic), or retire it now that we have
   real splash control? (Lean: keep — it's harmless and on-brand-neutral; revisit
   when we design the real splash.)
5. **`(auth)` anchor route name:** confirm `sign-in` is the right initial route
   name S1 will keep, so the protected-redirect target is stable. (Lean: yes;
   document it for S1.)

---

## Review
<!-- Filled by /review-plan. Findings grouped: BLOCKER / SHOULD-FIX / NIT, each
     with a suggested resolution. Verdict: APPROVED or NEEDS CHANGES. -->

## Execution log
<!-- Filled during execution: what actually happened, any deviation from the plan
     and why, final verification result. -->
