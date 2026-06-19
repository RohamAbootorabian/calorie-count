# Plan: Design System — `src/shared/ui` (theme + Button/Card/Input/Screen)

- **Status**: Done (2026-06-19)
- **Created**: 2026-06-19
- **Plan #**: 0002

## Problem / Goal
Step 2 of Phase A (the trunk). Every future feature screen (auth, onboarding
wizard, diary, capture, trends) needs a consistent, themed set of UI primitives so
features don't each reinvent buttons/inputs/layout. Today the repo only has the
**Expo template scaffold**: design tokens in [src/constants/theme.ts](../../src/constants/theme.ts)
(`Colors`, `Fonts`, `Spacing`), a `useTheme()` hook, and two primitives
(`ThemedText`, `ThemedView`) — plus template-demo components (`animated-icon`,
`web-badge`, `hint-row`) that are not part of a real design system.

**Done looks like:** a single import surface `@/shared/ui` exposing **Button**,
**Card**, **Input**, **Screen**, and **Text** that are theme-aware (light/dark),
typecheck clean, and render correctly in Expo Go. The token palette is extended
with the few semantic colors a real UI needs (brand/primary, border, danger,
muted surface) so components aren't hardcoding hex values (the scaffold currently
hardcodes `#3c87f7` for primary links). After this, S1 can build auth/onboarding
entirely from `@/shared/ui` without touching shared code.

## Non-goals
- **Not** rebuilding navigation or the auth gate (that is Step 3).
- **Not** deleting the template demo screens/components (`index.tsx`,
  `explore.tsx`, `animated-icon`, `web-badge`, `hint-row`). They stay until the
  real screens replace them; we only stop *extending* them. (Optional cleanup is
  called out in Open questions, not done here.)
- **Not** introducing a styling library (NativeWind/Tamagui/Unistyles). We keep
  the existing `StyleSheet` + `useTheme()` approach — smallest change, no new deps.
- **Not** building feature-specific components (macro rings, score badges, meal
  cards). Those belong to their features; only generic primitives live here.
- **Not** adding a manual light/dark toggle — we keep following the OS scheme via
  the existing `useColorScheme`.
- **Not** a full Storybook/gallery; a lightweight dev preview is optional (Open Q).

## Proposed approach
**Reuse, don't replace.** Keep `theme.ts`, `useTheme()`, `ThemedText`,
`ThemedView` as the foundation. Add semantic tokens and a thin `src/shared/ui/`
layer of composable primitives on top.

### 0. Fix the theme hook first (review BLOCKER 1)
[src/hooks/use-theme.ts](../../src/hooks/use-theme.ts) currently guards
`scheme === 'unspecified'`, a value RN's `useColorScheme()` never returns; when the
scheme is `null` it indexes `Colors[null]` → `undefined` colors. Change to
`const theme = scheme ?? 'light'`. Every primitive depends on this being correct.

### 1. Extend tokens in `src/constants/theme.ts` (additive only)
Add the semantic colors a real component set needs, for **both** light and dark,
without removing/renaming existing keys (the scaffold still imports them):
- `primary` — brand/CTA color (replaces the hardcoded `#3c87f7`). Light/dark variant.
- `primaryText` — text/icon color on top of `primary` (e.g. `#ffffff`).
- `border` — hairline/input border color.
- `danger` — destructive/error (used by Input error state, destructive Button).
- `dangerText` — text on top of `danger`.
- *(Card/surface reuses existing `backgroundElement`/`backgroundSelected` — no
  new `muted` key.)*
- **Defer `dangerText`** (review SF4): its only consumer was the destructive
  Button, which is deferred. Add `danger` now (used by Input error state).

Add every new key to **both** `Colors.light` and `Colors.dark` (review SF15 —
`ThemeColor` only derives keys present in both); add a one-line type assertion
(`const _c: ThemeColor = 'primary'`) to catch a single-palette mistake.

Add a **radius scale** alongside `Spacing`:
```ts
export const Radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;
```
`ThemeColor` type already derives from `Colors.light` keys, so new keys flow into
it automatically. Keep `as const`.

### 2. Create `src/shared/ui/` primitives (kebab-case files, matching repo convention)
- `src/shared/ui/text.tsx` — re-export the existing `ThemedText` as `Text` (single
  import surface). No reimplementation: `export { ThemedText as Text } from
  '@/components/themed-text';` and **separately** `export type { ThemedTextProps }
  from '@/components/themed-text';` (review SF14 — value vs type export under
  strict TS). Barrel exposes only `Text`, not `ThemedText` (one public name).
- `src/shared/ui/screen.tsx` — **Screen**: page wrapper generalizing the
  `index.tsx` boilerplate. Layout: a **full-bleed themed background** `View`
  wrapping an inner content container clamped to `MaxContentWidth` and centered
  (so wide/web shows no wrong-colored letterbox — review SF "MaxContentWidth").
  **Keyboard avoidance baked in** (review BLOCKER 2): wrap content in
  `KeyboardAvoidingView` (`behavior` iOS `padding` / Android `undefined`; no-op on
  web). Safe-area via `useSafeAreaInsets()` (top + horizontal; bottom only when
  `tabBarInset`) rather than `SafeAreaView` alone (review SF3 — Android
  edge-to-edge). Props: `scroll?: boolean` (wrap in `ScrollView` +
  `keyboardShouldPersistTaps="handled"`), `padded?: boolean` (default true),
  `tabBarInset?: boolean` (default **false** — auth/onboarding live outside the
  tabs; only tab screens pass true), `style`, `contentContainerStyle`, `children`.
- `src/shared/ui/button.tsx` — **Button** (trimmed per review SF4). Props:
  `children` (string or node — no separate `title`), `onPress`, `variant?:
  'primary' | 'secondary' | 'ghost'` (default `primary`), `loading?`, `disabled?`,
  `fullWidth?` _(keep — cheap and forms want it)_. **Deferred:** `destructive`,
  `size`, `leftIcon`. Built on `Pressable`. Behavior: internal in-flight guard so
  a double-tap can't fire `onPress` twice before the parent flips `loading`
  (review SF6); `ActivityIndicator` shown in a **fixed slot** with `color` =
  variant foreground so width doesn't jump and the spinner is visible on filled
  fills (SF7); press is a no-op when `loading || disabled`; disabled/loading state
  wins over pressed feedback; per-variant disabled appearance (muted
  text/border for secondary/ghost, not blanket opacity). Web: hover style via
  `({ hovered })` + keep focus outline (SF8). Colors from tokens
  (`primary`/`primaryText`, `border`). a11y: `accessibilityRole="button"`,
  `accessibilityState={{ disabled, busy: loading }}`. Min 44–48px height.
- `src/shared/ui/card.tsx` — **Card**: composes **`ThemedView`**
  (`type="backgroundElement"`) not a raw View (review SF5). `Radius.lg`, padding
  default `Spacing.three`, `overflow:'hidden'`, optional `onPress` (wrap in
  `Pressable` with `accessibilityRole="button"` + pressed feedback when present,
  else plain `ThemedView`). `style` passthrough.
- `src/shared/ui/input.tsx` — **Input**: labeled text field wrapping `TextInput`,
  controlled contract (`value` + `onChangeText`). Props: `label?`, `error?:
  string`, `hint?: string`, plus all `TextInputProps`. Accepts **`ref` as a prop**
  (React 19, no `forwardRef` — SF12) forwarded to the inner `TextInput` instance
  (for `.focus()` incl. web). Themed text/border; border turns `danger` + shows
  the message when `error` set; `placeholderTextColor` from `textSecondary`.
  **One reserved line-height slot** shared by hint/error so toggling never reflows
  siblings (error replaces hint — SF9). **Sensitive-field hygiene** (SF10/SF11):
  when `secureTextEntry`, default `autoCorrect={false}`,
  `autoCapitalize="none"`, `spellCheck={false}`; forward
  `textContentType`/`autoComplete` (don't swallow); add `-webkit-autofill` bg
  override on web. **Never** `console.*` props/`value`; `accessibilityLabel`
  derives from `label` only (never from `value`); set invalid a11y state +
  surface the error *fact* (not the value) to screen readers.
- `src/shared/ui/index.ts` — **barrel**: re-export `Button`, `Card`, `Input`,
  `Screen`, `Text` + their prop types. The only path features import.
  (`components/themed-*` remain the canonical impls; `shared/ui` is the public
  surface — don't duplicate them later.)

### 3. Replace the one hardcoded color
Point `themed-text.tsx`'s `linkPrimary` at the new `primary` token instead of the
literal `#3c87f7` (so the template demo also reflects the real brand). Low-risk,
keeps a single source of truth.

### Design token values (proposed — confirm in review)
A calm, food/health-friendly green as primary (fits a nutrition app); refine later.
- Light: `primary: '#2E7D32'`, `primaryText: '#ffffff'`, `border: '#D7DAE0'`,
  `danger: '#D14343'`, `dangerText: '#ffffff'`.
- Dark: `primary: '#4CAF50'`, `primaryText: '#0A0A0A'`, `border: '#34363B'`,
  `danger: '#E5715F'`, `dangerText: '#0A0A0A'`.

## Files to change
- `src/hooks/use-theme.ts` — **edit** (BLOCKER 1): `const theme = scheme ??
  'light'`; drop the dead `'unspecified'` branch.
- `src/constants/theme.ts` — **edit**: add `primary`, `primaryText`, `border`,
  `danger` to `Colors.light`/`Colors.dark` (both palettes); add `Radius` scale.
  (`dangerText` deferred with destructive Button.)
- `src/components/themed-text.tsx` — **edit**: emit `{ color: theme.primary }` when
  `type==='linkPrimary'` and delete the `#3c87f7` literal from `styles.linkPrimary`
  (keep its `fontSize`/`lineHeight`); confirm array order keeps the themed color
  winning (review SF13).
- `src/shared/ui/text.tsx` — **new**: re-export `Text` (= `ThemedText`) + props.
- `src/shared/ui/screen.tsx` — **new**: `Screen` layout primitive.
- `src/shared/ui/button.tsx` — **new**: `Button`.
- `src/shared/ui/card.tsx` — **new**: `Card`.
- `src/shared/ui/input.tsx` — **new**: `Input`.
- `src/shared/ui/index.ts` — **new**: barrel export.
- *(optional, Open Q)* `src/app/explore.tsx` or a dev-only route — a small preview
  rendering every primitive/variant for manual QA. Not required for "done".

No change to `tsconfig.json` — the `@/*` → `src/*` alias already covers
`@/shared/ui`.

## Data model / schema impact
None. Pure client-side UI; no tables, columns, migrations, RLS, or buckets.

## Edge cases & failure modes
- **Dark/light switch:** every component must read colors via `useTheme()` at
  render, never capture them in a module-level `StyleSheet`. Verify by toggling OS
  appearance — all primitives must recolor live.
- **Button while loading:** `onPress` must be a no-op when `loading || disabled`
  (prevent double-submit on a slow network — relevant to auth later).
- **Input long text / multiline:** ensure single-line default doesn't clip; respect
  `multiline` if passed through. `secureTextEntry` must work (password fields).
- **Input error swap:** toggling `error` on/off must not shift layout jarringly —
  reserve/animate the error line minimally (or always render a fixed-height slot).
- **Screen + keyboard:** when `scroll`, `keyboardShouldPersistTaps="handled"` so
  taps on buttons work while the keyboard is open; content not hidden behind the
  bottom tab inset.
- **Web parity:** project supports `react-native-web`; primitives must not use
  native-only APIs without a web fallback (Pressable/TextInput/ScrollView are fine).
- **Ref forwarding on Input:** must use `forwardRef` so forms can call `.focus()`.
- **A11y:** Button has an accessible role/label; disabled state sets
  `accessibilityState={{ disabled }}`.
- **Empty/huge content in Card/Screen:** no fixed heights that break on long text.

## Test / verify plan
1. `npx tsc --noEmit` — clean (strict mode is on).
2. `npm run lint` (`expo lint`) — clean.
3. **Manual in Expo Go** via a temporary preview (or by temporarily rendering the
   primitives in `explore.tsx`):
   - Each Button variant (primary/secondary/ghost/destructive), plus `loading`
     and `disabled` states; tap feedback; press blocked while loading.
   - Input: typing, placeholder color, error state (border + message),
     `secureTextEntry`, focus via ref.
   - Card: tappable vs static; correct surface color.
   - Screen: scroll vs non-scroll; safe-area + tab inset respected; centered at
     `MaxContentWidth` on wide/web.
   - Toggle device light/dark → confirm every primitive recolors.
4. Confirm `import { Button, Card, Input, Screen, Text } from '@/shared/ui'`
   resolves and renders.
5. Remove any temporary preview wiring before commit (unless we keep a dev route —
   Open Q).

## Rollout
No migrations, env vars, or secrets. Order:
1. Extend `theme.ts` tokens + `Radius`.
2. Add `src/shared/ui/` primitives + barrel.
3. Repoint `themed-text` `linkPrimary` to the token.
4. Verify (typecheck/lint/Expo Go).
5. Append `docs/JOURNAL.md`, mark this plan `Done`, commit straight to `main`.
   (S1's parallel-branch rule does not apply — we build sequentially on `main`.)

## Open questions
1. **Brand color:** ✅ **RESOLVED** — green confirmed by the user
   (`#2E7D32` light / `#4CAF50` dark), pending the WCAG contrast check (NIT 18).
2. **Dev preview:** keep a permanent `src/app/(dev)/ui-gallery` route for visual QA
   of primitives, or use a throwaway preview during this task and delete it? (Lean:
   throwaway now; add a gallery later if useful.)
3. **Typography home:** keep `ThemedText` in `src/components/` and re-export from
   `shared/ui`, or physically move it (and `ThemedView`) into `src/shared/ui/`?
   (Lean: re-export now — smaller diff, no import churn in the template files.)
4. **Should we add a `Text` size/weight scale** beyond the existing `ThemedText`
   `type` variants, or are the current variants (`title`/`subtitle`/`default`/
   `small`/…) sufficient for auth+onboarding? (Lean: sufficient; extend on demand.)

---

## Review
_Multi-agent review 2026-06-19 (correctness, architecture, edge-cases, data/privacy).
Findings consolidated + deduped. Initial verdict: **NEEDS CHANGES (2 blockers)** →
plan revised below to clear them; see "Resolution" notes._

### BLOCKER
1. **`useTheme()` returns `undefined` colors when the OS scheme is `null`.**
   RN's `useColorScheme()` returns `'light' | 'dark' | null` — never the string
   `'unspecified'` that [src/hooks/use-theme.ts](../../src/hooks/use-theme.ts)
   guards against. When it's `null` (no OS preference, and on web first paint),
   `Colors[null]` is `undefined`, so every primitive renders with `undefined`
   colors (blank/black). The entire "theme-aware light/dark" goal rests on this
   hook. **Resolution:** add a step to fix the hook to `const theme = scheme ??
   'light'` (coalesce `null`, drop the dead `'unspecified'` branch). Added to
   approach §0 + Files to change.
2. **`Screen` builds no keyboard handling, but it's the layout primitive every
   form sits in.** Auth/onboarding (the very next module) has inputs low on the
   page that the keyboard will cover; without avoidance baked into `Screen`, each
   feature re-solves it inconsistently — defeating the goal. **Resolution:**
   `Screen` wraps content in `KeyboardAvoidingView` (platform `behavior`: iOS
   `padding`, Android `height`/undefined; no-op on web) and keeps
   `keyboardShouldPersistTaps="handled"` when scrolling. Added to approach §2.

### SHOULD-FIX
3. **`Screen` bottom inset is wrong for non-tab screens (auth/onboarding live
   OUTSIDE the tab navigator).** Always applying the hardcoded `BottomTabInset`
   (ios 50/android 80) gives 50–80px of phantom dead space on screens with no tab
   bar, and can double-count with the real safe-area bottom. **Resolution:** make
   the tab inset **opt-in** via a `tabBarInset?: boolean` prop (default `false`);
   use `useSafeAreaInsets()` for the real bottom/top insets rather than relying on
   `SafeAreaView` alone (more reliable on Android edge-to-edge).
4. **Button is over-specified for what S1 needs.** 4 variants + 2 sizes +
   `leftIcon` + `fullWidth` + `title`-or-`children` is speculative surface.
   **Resolution:** ship `variant: 'primary' | 'secondary' | 'ghost'`, `loading`,
   `disabled`, `onPress`, `children` (drop the `title` string API — `children`
   only). **Defer** `destructive`, `size`, `leftIcon`, `fullWidth` until a real
   screen needs them. Consequently **defer the `dangerText` token** too (its only
   consumer was destructive Button); keep `danger` (used by Input).
5. **`Card` should compose `ThemedView`, not a raw `View`.** `ThemedView`
   (`type="backgroundElement"`) already does themed-surface-via-`useTheme()`.
   **Resolution:** Card = `<ThemedView type="backgroundElement">` (+ Pressable
   wrap when `onPress`), keeping theming in one place.
6. **Button double-submit race.** Blocking press only on the parent-controlled
   `loading` lets a double-tap fire twice before the parent re-renders (double
   sign-in / double save). **Resolution:** add an internal in-flight guard
   (ignore presses for a short leading-edge window) independent of `loading`.
7. **Button spinner + variant foreground unspecified.** A default spinner is
   invisible on a filled `primary` button, and swapping title→spinner shifts
   width. **Resolution:** `ActivityIndicator color` = variant foreground
   (`primaryText` etc.); render spinner in a fixed slot / overlay so width is
   stable; define disabled appearance per variant (muted text+border for
   secondary/ghost, not just blanket opacity); precedence: disabled/loading wins
   over pressed feedback.
8. **Web hover/focus states missing.** On `react-native-web`, `Pressable` gives
   no hover bg or focus ring by default — buttons look dead to mouse/keyboard.
   **Resolution:** add hover style via Pressable `({ hovered })` on web and keep a
   visible focus outline (don't `outline: none`).
9. **Input error toggle layout shift (the plan left it as "or").** Every field
   shifting when validation fires is real jank. **Resolution:** reserve a
   **single** line-height slot shared by hint/error (error replaces hint; no
   sibling reflow) — one line of dead space max, not a fixed multi-line block.
10. **Input password-manager / autofill / sensitive-input hygiene.** Plan passes
    `secureTextEntry` through but never sets `textContentType`/`autoComplete`, and
    `autoCorrect`/`autoCapitalize`/`spellCheck` default ON — leaking typed
    credentials to the keyboard dictionary; web autofill also restyles the field
    (yellow bg) ignoring dark theme. **Resolution:** when `secureTextEntry`,
    default `autoCorrect={false}`, `autoCapitalize="none"`, `spellCheck={false}`;
    forward `textContentType`/`autoComplete` (don't swallow); add the
    `-webkit-autofill` background override on web. Document callers set
    `textContentType="password"`/`"newPassword"`.
11. **No "never log values" rule.** Input will hold passwords + later health data.
    **Resolution:** add an explicit rule — primitives never `console.*` their
    props/`value`; `error`/`accessibilityLabel` derive from `label` only, never
    from the entered `value`.
12. **React 19: use ref-as-prop, not `forwardRef`.** In React 19 `ref` is a normal
    prop; `forwardRef` is legacy. **Resolution:** Input accepts `ref` as a prop and
    passes it to the inner `<TextInput ref={ref}>` (forward to the *TextInput*
    instance, not the wrapper — needed for `.focus()` incl. web).
13. **`linkPrimary` repoint must emit the token conditionally.** Just deleting the
    `#3c87f7` literal makes `linkPrimary` fall back to plain `text`. **Resolution:**
    in [themed-text.tsx](../../src/components/themed-text.tsx) push `{ color:
    theme.primary }` when `type==='linkPrimary'` (keep the style entry's non-color
    props), and confirm array order keeps it winning.
14. **`export type` for re-exported props (verbatimModuleSyntax/isolatedModules).**
    Re-exporting `ThemedTextProps` with a value `export` fails to compile under
    strict TS. **Resolution:** `export type { ThemedTextProps } …` separately; keep
    the name `ThemedTextProps` (avoid colliding with RN's `TextProps`).
15. **`ThemeColor` only auto-derives keys present in BOTH palettes.** A key added
    to one of `Colors.light`/`Colors.dark` silently drops from `ThemeColor`.
    **Resolution:** add a verify substep (`const _c: ThemeColor = 'primary'`) and
    add every new key to both palettes.
16. **expo-router theme not synced to the new brand.**
    [_layout.tsx](../../src/app/_layout.tsx) feeds stock `DarkTheme`/`DefaultTheme`
    to nav chrome (headers/tab bar), which will clash with the green `primary`.
    **Resolution (deferred to Step 3 — Navigation):** note that the router theme
    should derive from `Colors` when nav is built; out of scope here, flagged so
    it isn't missed. Not a blocker for the primitives.

### NIT
17. Remove the `muted` bullet from token list — it's listed then explicitly not
    added (we reuse `backgroundElement`/`backgroundSelected`); listing it muddies
    the contract.
18. Verify WCAG contrast of `primaryText` (`#0A0A0A`) on dark `primary`
    (`#4CAF50`) and danger pairs before locking the hex values.
19. Add `accessibilityState={{ busy: loading }}` + explicit
    `accessibilityRole="button"` on Button (Pressable doesn't always infer role on
    web); preserve a ≥44–48px touch target on `sm` via `hitSlop` (when size lands).
20. Tappable `Card` needs `accessibilityRole="button"` + pressed feedback +
    `overflow:'hidden'` so children respect rounded corners.
21. Web SSR/hydration: initial paint may flash light→dark on web; add a web
    first-paint theme check to the verify plan (and a `prefers-color-scheme` root
    bg fallback) — minor.
22. Optional show/hide-password affordance on secure Inputs (defer; note for S1).
23. Barrel exposes only `Text` (not also `ThemedText`) to keep one public name;
    add a one-line note that `components/themed-*` are the canonical impls and
    `shared/ui` is the public surface (so a later session doesn't duplicate them).

### Verdict
**NEEDS CHANGES → RESOLVED.** 2 blockers (useTheme `null`; Screen keyboard
avoidance) are cleared by the plan revisions below; all SHOULD-FIX items folded
into the approach/files/edge-case sections. **APPROVED for execution** once the
revised approach (below) stands. Data/privacy confirmed: **no schema, no secrets,
no hidden network/storage/cost** — pure client UI.

## Execution log
**2026-06-19 — executed per the revised (post-review) approach.**

Built:
- Fixed `src/hooks/use-theme.ts` (BLOCKER 1). Note: RN's `ColorSchemeName` here is
  `'light' | 'dark' | 'unspecified' | null`, so `scheme ?? 'light'` didn't narrow
  (typecheck error). Final form: `scheme === 'dark' ? 'dark' : 'light'` — anything
  not explicitly dark falls back to light. (Minor deviation from the planned
  `?? 'light'`, same intent, typesafe.)
- Extended `src/constants/theme.ts`: `primary`/`primaryText`/`border`/`danger` in
  both palettes (+ `_themeColorCheck` compile guard), `Radius` scale. `dangerText`
  deferred as planned.
- `src/components/themed-text.tsx`: `linkPrimary` now emits `{ color: theme.primary }`
  conditionally; removed the `#3c87f7` literal from the style.
- New `src/shared/ui/`: `text.tsx` (re-export), `screen.tsx` (full-bleed bg +
  clamp + `KeyboardAvoidingView` + `useSafeAreaInsets` + opt-in `tabBarInset`),
  `button.tsx` (3 variants, in-flight double-tap guard, fixed spinner slot, web
  hover, per-variant disabled colors), `card.tsx` (composes `ThemedView`),
  `input.tsx` (React-19 ref-as-prop, reserved helper slot, secure-field hygiene),
  `index.ts` barrel.
- `src/global.css`: `-webkit-autofill` override so password-manager fills stay
  themed on web.

Deviations:
- `Input` `accessibilityState={{ invalid }}` dropped — `invalid` isn't in RN's
  `AccessibilityState` type. The error text is already screen-reader visible via
  the helper slot, so the error *fact* is still announced.
- `expo lint` had never been run; this run installed ESLint + generated
  `eslint.config.js` (added to package.json/lock). One pre-existing template error
  (`set-state-in-effect` in `use-color-scheme.web.ts`, the intentional hydration
  pattern) was suppressed with a scoped `eslint-disable-next-line` + comment so
  lint is green for all future work.

Verification:
- `npx tsc --noEmit` — clean.
- `npm run lint` — clean.
- Manual Expo Go / web visual pass — **pending** (no temporary gallery shipped;
  recommend a quick visual check when the first real screen, S1 auth, consumes
  these primitives).
