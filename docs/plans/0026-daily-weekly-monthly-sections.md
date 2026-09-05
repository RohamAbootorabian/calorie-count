# Plan: Split into Daily / Weekly / Monthly sections — three buttons on the dashboard

- **Status**: **Draft** → In Review → Approved → In Progress → Done
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
### 1. Extract the daily summary into a shared component
Move the dashboard's daily rendering — the **calories card + macros card**, plus the file-local
`Bar`, `MetricBar`, `progressFor`, `Progress` type, `round` — into a shared
`src/features/dashboard/screens/daily-summary.tsx` as `DailySummary({ totals, goals })` (pure
presentational; `progressFor` keeps using the shared `guardedRatio`). `dashboard-screen.tsx` renders
`<DailySummary totals={totals} goals={goals} />` in place of the inline cards (no visual change).

### 2. New Daily screen (`/daily`)
`daily-summary-screen.tsx`: owns the data plumbing (mirrors `dashboard-screen`: single `useProfile`
→ `resolveTimezone` → `useDailyTotals(tz)` + `useDailyGoals`, refetch-on-focus, loading/error gates)
and renders `<DailySummary />` + the "No meals logged today" note. A `<Screen scroll>` with a
back-chevron header (route-level).

### 3. New Monthly screen (`/monthly`)
`monthly-screen.tsx`: owns `useProfile` → `resolveTimezone` → `useMonthlyTotals(tz)` + `useDailyGoals`
+ refetch-on-focus + the profile loading/error gates, and renders the monthly `PlanRingsCard`
(extracted in 0025) with its own loading/error/empty/no-goal gates — the exact card the weekly
screen shows today, now standalone.

### 4. Weekly screen (`/trends`) — remove the monthly card
`trend-screen.tsx`: drop `useMonthlyTotals` + the monthly `PlanRingsCard` + the `planMetrics`
monthly call + `refetchMonthly`. With monthly gone, revert to the simpler weekly structure: the
profile/loading/error gates + the all-7-empty full-screen empty state (the 0025 B1 restructure — an
inline empty + unconditional monthly card — existed ONLY to keep monthly visible; no longer needed),
then bars + the weekly `PlanRingsCard` + the weekly average.

### 5. Dashboard — three buttons
`dashboard-screen.tsx`: replace the single "Weekly trend →" `Button` with a row of three
`variant="secondary"` buttons — **Daily · Weekly · Monthly** — in a `flexDirection:'row'` container
(`gap`, each `flex:1`), navigating to `/daily`, `/trends`, `/monthly` respectively.

### 6. Routes
- `src/app/daily.tsx` + `src/app/monthly.tsx` — thin re-exports (mirror `trends.tsx`).
- `_layout.tsx` — register `daily` + `monthly` as GUARDED root siblings (inside `!!session &&
  !needsOnboarding`) with `headerShown:true` + titles "Daily Summary" / "Monthly Review" (keep
  `trends` = "Weekly Trend").

## Files to change
- `src/features/dashboard/screens/daily-summary.tsx` — **new.** `DailySummary({ totals, goals })` +
  the moved `Bar`/`MetricBar`/`progressFor`/`round`.
- `src/features/dashboard/screens/daily-summary-screen.tsx` — **new.** The `/daily` screen (data
  plumbing + `<DailySummary/>` + no-meals note + gates).
- `src/features/dashboard/screens/monthly-screen.tsx` — **new.** The `/monthly` screen (monthly
  `PlanRingsCard` + plumbing + gates).
- `src/features/dashboard/screens/trend-screen.tsx` — remove the monthly card + its hook/imports;
  revert to weekly-only structure.
- `src/features/dashboard/screens/dashboard-screen.tsx` — use `<DailySummary/>`; replace the single
  button with the Daily/Weekly/Monthly row.
- `src/app/daily.tsx`, `src/app/monthly.tsx` — **new** thin re-exports.
- `src/app/_layout.tsx` — register the two new routes (guarded, headerShown, titles).

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
<!-- Filled by /review-plan. -->

## Execution log
<!-- Filled during execution. -->
