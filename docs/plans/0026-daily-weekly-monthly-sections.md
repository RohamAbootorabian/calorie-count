# Plan: Split into Daily / Weekly / Monthly sections — three buttons on the dashboard

- **Status**: ~~Draft~~ → ~~In Review~~ → **Approved** → In Progress → Done
- **Plan #**: 0026
- **Created**: 2026-09-05

## Problem / Goal
The Trend screen currently stacks a weekly section AND a monthly rings card (plan 0025). The user
wants three **separate** period views, reached from **three side-by-side buttons on the dashboard
(Home)** that replace today's single "Weekly trend →" button:

- **Daily** → a screen showing today's **numeric summary** (calories + macros), the same content the
  dashboard already renders inline.
- **Weekly** → the existing weekly screen, **minus** the monthly card (bar chart + weekly rings +
  weekly average).
- **Monthly** → a **new** standalone screen with the monthly rings (moved off the weekly screen).

**"Done" =** Home shows a row of three buttons (Daily · Weekly · Monthly); each opens its own
screen over the tabs with a back chevron; the weekly screen no longer shows the monthly card; the
monthly screen shows the four month-to-date rings; the daily screen shows today's calories + macros;
no data/logic regressions (0021–0025 behavior preserved per section); `tsc`/`lint`/web-export green;
user verifies. Pure client — no migration, no new dependency, no new data logic.

## Non-goals
- **No new data/query/metric.** Reuses the existing `useDailyTotals` / `useWeeklyTotals` /
  `useMonthlyTotals` / `useDailyGoals` + `resolveTimezone`; no schema/migration.
- **No rings for Daily** — the user chose a numeric summary (calories + macros), not rings.
- **No new tab** — the three are root `Stack.Screen`s over the tabs (like `/trends` today), reached
  from Home buttons.
- **No redesign of the cards themselves** — the daily summary + weekly bars/rings/average + monthly
  rings render exactly as they do now; only their placement/routing changes.
- **Home keeps its own inline daily cards** (unchanged); the "Daily" button opens the same summary
  as a standalone screen (the user accepted this overlap).

## Proposed approach
### 0. Extract `useResolvedTz()` (SF3) — shared tz/profile plumbing
New `src/features/dashboard/lib/use-resolved-tz.ts`: `useResolvedTz()` = `useProfile()` +
`resolveTimezone(profile?.timezone)`, returning `{ tz, profileLoading, profileError, refetchProfile }`.
Used by all FOUR screens (Home, `/daily`, `/monthly`, `/trends`) for the tz + the profile
loading/error gate. Each screen KEEPS its own data hook(s) + focus-refetch (those differ). Scope
to the tz/profile slice only.

### 1. Extract the daily summary into a shared component
Move the dashboard's daily rendering — the **calories card + macros card**, plus the file-local
`Bar`, `MetricBar`, `progressFor`, `Progress` type, `round`, **AND their styles** (`calCard`,
`macroCard`, `metric`, `metricTop`, `track`, `trackLg`, `fill`) **+ the `guardedRatio` import + the
`DimensionValue` import** (SF1) — into `src/features/dashboard/screens/daily-summary.tsx` as
`DailySummary({ totals, goals })` (pure presentational). DELETE all of the above from
`dashboard-screen.tsx`. `dashboard-screen.tsx` renders `<DailySummary totals={totals} goals={goals}
/>` in place of the inline cards (no visual change) and prunes its now-dead imports (SF2).

### 2. New Daily screen (`/daily`)
`daily-summary-screen.tsx`: owns the data plumbing (mirrors `dashboard-screen`: single `useProfile`
→ `resolveTimezone` → `useDailyTotals(tz)` + `useDailyGoals`, refetch-on-focus, loading/error gates)
and renders `<DailySummary />` + the "No meals logged today" note. A `<Screen scroll>` with a
back-chevron header (route-level).

### 3. New Monthly screen (`/monthly`)
`monthly-screen.tsx`: uses `useResolvedTz()` + `useMonthlyTotals(tz)` + `useDailyGoals` +
refetch-on-focus + the profile loading/error gates, and renders — in a **`<Screen scroll>`** (SF6) —
the monthly `PlanRingsCard` (extracted in 0025) with its own loading/error/empty/no-goal gates
(`loading={monthlyLoading || goalsLoading}`, `error`, `goalsMissing`, `emptyNote`) — the exact card
the weekly screen shows today, now standalone.

### 4. Weekly screen (`/trends`) — remove the monthly card
`trend-screen.tsx`: drop `useMonthlyTotals` + the monthly `PlanRingsCard` + the `planMetrics` call +
`refetchMonthly` (and its `useFocusEffect` dep-array entry) + `monthMetrics` (SF2 — prune all
leftovers). With monthly gone, revert to weekly-only: profile/loading/error gates + the all-7-empty
**full-screen CENTERED early-return** (SF5 — re-author the original centered empty, NOT the 0025
inline card), then bars + the weekly `PlanRingsCard` + the weekly average. (The 0025 B1 inline-empty
existed only to keep monthly visible below — safe to drop now.)

### 5. Dashboard — three buttons
`dashboard-screen.tsx`: replace the single "Weekly trend →" `Button` with a `flexDirection:'row'`
container (`gap`) of three `<Button variant="secondary" style={{ flex: 1 }}>` — **Daily · Weekly ·
Monthly** — navigating to `/daily`, `/trends`, `/monthly`. **Use `style={{flex:1}}`, NOT `fullWidth`**
(SF4 — `fullWidth` stretches the cross axis in a row).

### 6. Routes
- `src/app/daily.tsx` + `src/app/monthly.tsx` — thin re-exports (mirror `trends.tsx`).
- `_layout.tsx` — register `daily` + `monthly` as GUARDED root siblings (inside `!!session &&
  !needsOnboarding`) with `headerShown:true` + titles "Daily Summary" / "Monthly Review" (keep
  `trends` = "Weekly Trend").

## Files to change
- `src/features/dashboard/lib/use-resolved-tz.ts` — **new (SF3).** `useResolvedTz()` → `{ tz,
  profileLoading, profileError, refetchProfile }`.
- `src/features/dashboard/screens/daily-summary.tsx` — **new.** `DailySummary({ totals, goals })` +
  the moved `Bar`/`MetricBar`/`progressFor`/`Progress` type/`round` + their styles (`calCard`,
  `macroCard`, `metric`, `metricTop`, `track`, `trackLg`, `fill`) + `guardedRatio`/`DimensionValue`
  imports (SF1).
- `src/features/dashboard/screens/daily-summary-screen.tsx` — **new.** The `/daily` screen
  (`useResolvedTz` + `useDailyTotals` + `useDailyGoals` + focus-refetch + gates + `<DailySummary/>` +
  no-meals note, in a `<Screen scroll>`).
- `src/features/dashboard/screens/monthly-screen.tsx` — **new.** The `/monthly` screen (`useResolvedTz`
  + `useMonthlyTotals` + `useDailyGoals` + focus-refetch + gates + monthly `PlanRingsCard`, in a
  `<Screen scroll>`).
- `src/features/dashboard/screens/trend-screen.tsx` — remove the monthly card + prune all leftovers
  (SF2); full-screen empty revert (SF5); adopt `useResolvedTz`.
- `src/features/dashboard/screens/dashboard-screen.tsx` — use `<DailySummary/>` + `useResolvedTz`;
  replace the single button with the 3-button row (`flex:1`, SF4); prune dead imports (SF2).
- `src/app/daily.tsx`, `src/app/monthly.tsx` — **new** thin re-exports.
- `src/app/_layout.tsx` — register `daily` + `monthly` (guarded, headerShown, titles "Daily Summary"
  / "Monthly Review").

## Data model / schema impact
**None.** Pure client — reuses existing hooks/components; no migration, no new fetch shape (the
Monthly + Daily screens each run the same user-scoped, `Pick<>`-allowlisted queries their hooks
already run). One extra hook instance each on their own screens (was one screen before).

## Edge cases & failure modes
- **No goals set** → Daily shows "Set your goals…" (existing `progressFor` no-goal copy); Monthly's
  `PlanRingsCard` shows the "set your goals" hint; Weekly unchanged. No NaN.
- **Empty day / week / month** → Daily "No meals logged today"; Weekly all-7-empty state; Monthly
  "No meals logged this month yet" (0025). Each screen self-contained.
- **Profile/tz load or error** → each screen has its own profile gate (spinner / Retry), like
  dashboard/trend today; tz resolved via `resolveTimezone` on each.
- **Midnight / month rollover** → each screen's hook uses the live `todayKey` (0023) → rolls
  without a refetch.
- **Back navigation / deep link** → three independent guarded root siblings (like `/trends`);
  signed-out unmounts them.
- **Narrow screen** → three short-labelled buttons in a `flex:1` row fit; if too tight, they wrap
  or the labels stay short ("Daily"/"Weekly"/"Monthly").
- **Home still renders its own daily cards** → `DailySummary` is presentational + pure, so Home and
  `/daily` render identically from their own data; no shared mutable state.

## Test / verify plan
- `npx tsc --noEmit` PASS; `npx expo lint` clean; full `npx expo export --platform web` green (all
  routes are code-split → export is the authoritative check).
- **Manual (device/web, logged in):**
  1. Home → three buttons (Daily · Weekly · Monthly); each opens the right screen with a back chevron.
  2. Weekly → bars + weekly rings + average, **no** monthly card.
  3. Monthly → the four month-to-date rings (matches what the weekly screen showed before).
  4. Daily → today's calories + macros (same as Home's inline cards).
  5. Regression: Home's inline daily cards unchanged; goal line/rings geometry intact; no-goal &
     empty states per screen; midnight/month rollover still rolls.
- **Grep gate:** no metric/goal/tz logged in the new screens; no `select('*')`; buttons use static
  labels.

## Rollout
Pure client, no migration/deploy/secret. Land on `main`; `tsc`/`lint`/export; user verifies the
three buttons + screens. Journal + mark Done + commit & push.

## Open questions
1. **Daily screen vs. Home overlap** — the user accepted it; `/daily` reuses `DailySummary`. Keep the
   `/daily` screen visually identical to Home's cards (proposed), or trim/add anything? Proposed:
   identical (via the shared component).
2. **Button labels/order** — "Daily · Weekly · Monthly" left→right (proposed). OK?
3. **Route naming** — keep `/trends` for Weekly (avoids breaking the existing route) vs. rename to
   `/weekly`. Proposed: keep `/trends`.

---

## Review
_3-lens review (correctness, architecture, edge/UX; data/privacy skipped — pure UI/routing
restructure, no new query/schema), 2026-09-05. **No BLOCKERs.** Should-fixes folded below._

### Verdict
**APPROVED.** Zero blockers. The routing pattern (thin re-export + guarded `_layout` sibling) is
confirmed identical to `/trends`/`/meal-edit`; the DS `Button` CAN render 3-in-a-row via
`style={{flex:1}}` (min touch target 48 satisfied); reverting `trend-screen` to weekly-only does NOT
reintroduce the 0025 B1 bug (that restructure existed only to keep monthly visible — moot once
monthly moves out); each new screen owning its `useProfile→resolveTimezone→hooks` plumbing works for
deep-links; `progressFor`/`guardedRatio` guard divide-by-zero; hook order is compiler-safe if it
mirrors the existing screens.

### SHOULD-FIX (folded in)
- **SF1 — Move the STYLES + `guardedRatio` import + `Progress` type WITH `DailySummary`
  (correctness + architecture).** `Bar`/`MetricBar` depend on `calCard`, `macroCard`, `metric`,
  `metricTop`, `track`, `trackLg`, `fill` (+ the `DimensionValue` import); `progressFor` needs the
  `guardedRatio` import + the `Progress` type. **Resolution:** all of these move into
  `daily-summary.tsx` and are DELETED from `dashboard-screen.tsx` (which keeps only
  `flex`/`centered`/`content`/`header`/`empty` + its own imports). Keep `goals!.calories`
  (guarded by `cal.hasGoal`).
- **SF2 — Prune now-dead imports on both edited files (lint-clean bar).** After extraction,
  `dashboard-screen.tsx` drops `Card`(if unused)/`DimensionValue`/`guardedRatio`; after the monthly
  removal, `trend-screen.tsx` drops `useMonthlyTotals`/`planMetrics` (+ `monthMetrics`,
  `refetchMonthly`, and its entry in the `useFocusEffect` dep array). Grep-verify none remain.
- **SF3 — Extract `useResolvedTz()` — 4 near-identical tz/profile copies (architecture).**
  Home + `/daily` + `/monthly` + `/trends` all re-derive `resolveTimezone(useProfile().timezone)` +
  the profile loading/error branch. **Resolution:** a tiny `dashboard/lib/use-resolved-tz.ts`
  returning `{ tz, profileLoading, profileError, refetchProfile }` (just `useProfile` +
  `resolveTimezone` passthrough), used by all four screens; each KEEPS its own data hook(s) +
  focus-refetch (those differ). Scope to the tz/profile slice ONLY — do NOT extract a full plumbing
  hook or a shared screen scaffold (gate order / empty copy / hook sets differ = over-engineering).
- **SF4 — The 3-button row uses `style={{ flex: 1 }}`, NOT `fullWidth` (edge/UX).** `fullWidth` is
  `alignSelf:'stretch'` (cross-axis in a row → wrong; distorts height, no equal columns). The row is
  a `flexDirection:'row'` container with `gap` and each `<Button variant="secondary" style={{flex:1}}>`.
- **SF5 — Weekly revert = a full-screen CENTERED empty early-return, not the 0025 inline card.** The
  inline empty (`summaryCard` in the scroll) existed only so monthly could sit below it. **Resolution:**
  re-author the all-7-empty branch as the original centered full-screen `return` (mirroring
  `ErrorState`/`Centered`), so an empty week isn't a lone small card floating atop a scroll view.
- **SF6 — `/monthly` uses `<Screen scroll>` (edge/UX).** 4 rings + subtext can exceed the viewport at
  large text; match `trend-screen`'s `<Screen scroll>` (route is `headerShown:true`; `Screen` handles
  insetTop — no double-inset).

### NIT (noted)
- `/daily` genuinely duplicates Home's inline daily cards — the user chose it (OQ1); the shared
  `DailySummary` makes the overlap cheap. Kept. • Goals-*error* renders as "Set your goals" on both
  `/daily` and `/monthly` (a null-vs-error conflation) — PRE-EXISTING (dashboard + the weekly card do
  the same); inherited, not fixed here. • Button labels have no `numberOfLines`; keep them short
  ("Daily"/"Weekly"/"Monthly") so they don't wrap at large text — acceptable. • Each screen
  instantiates its own `useDailyGoals`/totals hooks (no singleton assumption — confirmed safe;
  Home and `/daily` render identically from independent, owner-scoped data). • Double-tap is guarded
  by `Button`'s 600 ms in-flight ref; theme-correct via `variant="secondary"` tokens; midnight/month
  rollover preserved per section.

### Confirmed correct (no change)
Thin re-export routes + guarded `_layout` registration; `/trends` kept (no breaking rename);
`DailySummary` as a pure presentational feature-local component (mirrors `metric-ring.tsx`); the
monthly screen replicating `trend-screen`'s card gating verbatim (`loading={monthlyLoading ||
goalsLoading}`, `error`, `goalsMissing`, `emptyNote`); no new data/query/schema.

## Execution log
<!-- Filled during execution. -->
