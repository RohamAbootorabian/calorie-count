# Plan: Meaningful tab-bar icons (Home / History / Capture / Profile)

- **Status**: ~~Draft~~ → ~~In Review~~ → **Approved** → In Progress → Done
- **Created**: 2026-09-13
- **Plan #**: 0030

## Problem / Goal
The bottom tab bar uses placeholder art: `History`, `Capture`, and `Profile` all point at
**byte-identical** copies of the old `explore` magnifier PNG (`assets/images/tabIcons/`),
and there is no `history` asset at all (History reuses `explore.png`). Only `home.png` is
distinct. So three of four tabs show the same wrong icon.

"Done": each tab shows an icon that matches its purpose, crisp on the user's iPhone, and
auto-tinted by the tab bar in light/dark + selected/unselected.

## Non-goals
- No redesign of the web tab bar (`app-tabs.web.tsx` is text-only buttons + a brand label;
  it renders no icons today — out of scope).
- Not authoring new raster PNG artwork (no design pipeline; SF Symbols are the right tool).
- No Android-specific `drawable` work (no Android target in play; the existing `src` PNGs
  remain the Android/fallback and are untouched).
- No label/text or navigation-structure changes.

## Proposed approach
Add an **`sf` (SF Symbol) prop** to each `NativeTabs.Trigger.Icon` in
`src/components/app-tabs.tsx`. On iOS `sf` takes priority over `src` (per expo-router:
"Priority on iOS: `sf` > `xcasset` > `src`"), so the iPhone gets a proper vector icon that
the system renders + tints; the existing `src` PNG stays as the Android/fallback. Use the
`{ default, selected }` form so the selected tab shows the filled variant (standard iOS feel):

| Tab | `sf` default | `sf` selected |
|-----|--------------|---------------|
| Home (`index`) | `house` | `house.fill` |
| History | `clock.arrow.circlepath` | `clock.arrow.circlepath` |
| Capture | `camera` | `camera.fill` |
| Profile | `person.crop.circle` | `person.crop.circle.fill` |

`clock.arrow.circlepath` (the standard "history/revert" glyph) has no `.fill` variant, so it
stays the same on selection — acceptable and idiomatic. Keep `renderingMode="template"` so the
tab bar tint (already themed) applies. Names are type-checked by `sf-symbols-typescript` (the
type expo-router's `sf` prop uses), so a typo is a compile error — our correctness net.

## Files to change
- `src/components/app-tabs.tsx` — add `sf={{ default, selected }}` to the four `Icon`s; update
  the stale "placeholder / reusing explore" comments to reflect the real icons now in use.

## Data model / schema impact
None.

## Edge cases & failure modes
- **Older iOS lacking a symbol:** all four are long-standing SF Symbols (iOS 13–15 era), well
  under the app's deployment target — no availability gap.
- **Android / web:** `sf` is ignored; Android falls back to the existing `src` PNGs (unchanged);
  web tab bar renders no icons (unchanged). No regression on non-iOS.
- **Theme/selected tint:** unchanged — `template` rendering + the existing `NativeTabs`
  `labelStyle`/colors keep tint correct in light/dark.

## Test / verify plan
- `npx tsc --noEmit` → 0 (this validates every SF Symbol name via `sf-symbols-typescript`).
- `npx expo lint` → 0.
- `npx expo export --platform web` → success (web path unaffected).
- Device: on iPhone, each tab shows its new icon; selected tab shows the filled variant
  (Home/Capture/Profile); tint follows light/dark.

## Rollout
Pure client change. No migration/secret/deploy. Native `sf` icons are a JS/config change that
Expo Router maps to system symbols — a Reload shows them (no native rebuild: no new native
module, only a prop the runtime already supports). Commit to `main`.

## Open questions
None.

---

## Review
Two focused reviewers (correctness/API + edge/cross-platform), right-sized for a cosmetic
change with a compile-time correctness net (`sf-symbols-typescript` types the `sf` prop).
**Verdict: APPROVED — no blockers.**

### Verified
- **`sf={{ default, selected }}` is valid in the installed expo-router (SDK 56).** `elements.d.ts`
  types `sf?: SFSymbol | { default?: SFSymbol; selected: SFSymbol }`, `sf`+`src` coexist on the
  Icon type, and the docblock states "Priority on iOS: `sf` > `xcasset` > `src`". (This was the
  one BLOCKER-to-verify; confirmed against the source, not memory.)
- **All 7 SF Symbol names are valid** against `sf-symbols-typescript@2.2.0` (no version override →
  full cumulative union), so `tsc` is the correctness gate: `house`, `house.fill`,
  `clock.arrow.circlepath`, `camera`, `camera.fill`, `person.crop.circle`, `person.crop.circle.fill`.
- **No non-iOS regression:** `sf` is iOS-only; Android keeps the existing `src` PNGs; the web tab
  bar (`app-tabs.web.tsx`) renders no icons and is untouched.

### SHOULD-FIX (resolved)
- Make the comments honest: drop the stale "placeholder / until real art lands" wording; state
  that `src` is now the **inert non-iOS fallback** and that History reuses `explore.png` because
  no `history.png` asset exists. → done in the code comments.

### NIT (addressed in comments)
- `clock.arrow.circlepath` has no `.fill`, so History won't change glyph on selection (only the
  label tint) — intended, not a bug; noted so device QA doesn't file it.
- `renderingMode="template"` governs only the `src` (Android) fallback; iOS tints the `sf` symbol
  via the tab bar's item color regardless — noted.

## Execution log
Implemented per the approved plan.

- **`src/components/app-tabs.tsx`** — added `sf={{ default, selected }}` to all four
  `NativeTabs.Trigger.Icon`s (Home `house`/`house.fill`, History `clock.arrow.circlepath`,
  Capture `camera`/`camera.fill`, Profile `person.crop.circle`/`person.crop.circle.fill`); kept
  each `src` PNG as the inert non-iOS fallback; rewrote the stale placeholder comments per the
  SHOULD-FIX/NITs.
- **Verify:** `npx tsc --noEmit` → 0 (validates every symbol name) · `npx expo lint` → 0 ·
  `npx expo export --platform web` → success.
- No deviation from the approved plan.
