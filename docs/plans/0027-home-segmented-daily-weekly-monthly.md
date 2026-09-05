# Plan: Home = a Daily/Weekly/Monthly segmented switcher + monthly bar chart & weekly-average

- **Status**: **Draft** → In Review → Approved → In Progress → Done
- **Plan #**: 0027
- **Created**: 2026-09-05

## Problem / Goal
Supersede plan 0026's three pushed screens with an **in-place segmented switcher on the Home tab**:
a Daily · Weekly · Monthly control at the TOP of the screen, defaulting to **Daily** on app entry,
switching between the three views without navigation. Plus, bring the **Monthly** view up to parity
with Weekly:
- a **4-week bar chart** (four fixed buckets of the month — days 1–7, 8–14, 15–21, 22–end), each bar
  = that week's total calories, with a goal line (daily goal × days-in-bucket; = ×7 for the full
  first three), the current week highlighted;
- a **per-week average** card ("N kcal / week" + macros, over the logged weeks);
- (keeps) the four **month-to-date rings**.

**"Done" =** the Home tab opens on **Daily** with a Daily · Weekly · Monthly switcher pinned above
the content; tapping a segment swaps the view in place; Daily shows today's summary, Weekly shows the
7-day bars + rings + weekly average, Monthly shows the 4-week bars + rings + per-week average; the
0026 pushed routes (`/daily`, `/trends`, `/monthly`) and their buttons are gone; `tsc`/`lint`/
web-export green; user verifies. Pure client — no migration, no new dependency.

## Non-goals
- **No new tab** — the switcher lives ON the existing Home tab (Capture/History unchanged).
- **No new data source / migration** — reuses `meal_logs` via the existing hooks; the monthly week
  buckets are computed from the SAME rows `useMonthlyTotals` already fetches.
- **No calendar-week months** — the monthly bar chart uses four FIXED day-buckets (1–7 / 8–14 /
  15–21 / 22–end), per the user's choice, not Saturday-anchored weeks.
- **No swipe gestures / animation** — a tap switcher (buttons), not a paged/animated carousel.
- **No change to the ring math, goal line, tz/rollover logic** — those are reused as-is.

## Proposed approach
### 1. Home host — the segmented switcher
`dashboard-screen.tsx` becomes the switcher host: `const [section, setSection] = useState<'daily' |
'weekly' | 'monthly'>('daily')`. It renders a **`SegmentedControl`** (three `Button`s in a
`flexDirection:'row'`, `flex:1` each; the selected one `variant="primary"`, the others `secondary` —
the onboarding `SelectGroup` precedent) pinned at the top (below the safe-area top inset), then the
active **section component** below it in the scrollable area (bottom tab inset). Only the active
section is mounted, so only its hooks fetch (rules-of-hooks respected by rendering whole components,
not conditional hooks).

### 2. Three section components (each self-contained)
Each owns its plumbing (`useResolvedTz` + its data hook(s) + `useDailyGoals` + focus-refetch) and
renders its own scroll content + inline loading/error/empty gates (a centered spinner/Retry BELOW
the control, so the switcher stays usable while a section loads):
- **`DailySection`** — `useDailyTotals` + `<DailySummary>` + the no-meals note (the current
  `daily-summary-screen` body, inline gates).
- **`WeeklySection`** — `useWeeklyTotals` + the 7-day bar chart + weekly `PlanRingsCard` + weekly
  average (the current `trend-screen` body, inline gates).
- **`MonthlySection`** — `useMonthlyTotals` + the NEW 4-week bar chart + monthly `PlanRingsCard` +
  the NEW per-week average (below).

### 3. Extract a shared `CalorieBarChart`
The weekly 7-day chart (bars + goal line + labels + highlight) and the new monthly 4-week chart are
the same shape. Extract `dashboard/screens/calorie-bar-chart.tsx`:
`CalorieBarChart({ bars: { key, label, value, isCurrent }[], domainMax, goalValue })` — the bars +
goal-line rendering (the current `DayBar` internals, generalized). Weekly passes 7 day-bars
(`label`=weekday, `isCurrent`=isToday, `goalValue`=daily goal); Monthly passes 4 week-bars
(`label`="Wk 1"…"Wk 4", `isCurrent`=today's bucket, `goalValue`=weekly goal = daily×7). No visual
change to the weekly chart.

### 4. Monthly week buckets — extend `useMonthlyTotals`
Add to `useMonthlyTotals`'s return a `weeks: MonthWeek[]` (length 4) computed from the SAME fetched
rows in the existing `[rows, tz, todayKey]` memo: bucket each this-month row by
`bi = Math.min(Math.floor((dayOfMonth − 1) / 7), 3)` (days 22–end → bucket 3). Each `MonthWeek`:
`{ index, label, calories, protein, carbs, fat, mealCount, days }` where `days` = the number of
elapsed days in that bucket (7 for buckets 0–2 when reached; the remainder for bucket 3; 0 for a
future bucket). `todayBucket = Math.min(Math.floor((elapsed − 1)/7), 3)` marks `isCurrent`.

### 5. Monthly bar chart + per-week average
- **Bar chart:** `CalorieBarChart` with the 4 `MonthWeek` bars (`value`=calories), `goalValue` =
  daily goal × 7 (the weekly goal — one line across all four; the last bucket may legitimately exceed
  it), `domainMax = goalWeekly != null ? max(maxWeekCalories, goalWeekly×1.1) : maxWeekCalories`,
  `isCurrent` on `todayBucket`.
- **Per-week average card:** mirrors the weekly average — "Monthly average · over N logged week(s)"
  (N = buckets with `mealCount > 0`) → "X kcal / week" + protein/carbs/fat per-week averages =
  `sum(month) ÷ N` (0 logged weeks → the empty state, never NaN).

## Files to change
- `src/features/dashboard/screens/dashboard-screen.tsx` — the segmented host (state + control +
  active section); drops the 0026 push-button row + `DailySummary`/daily hooks (moved to `DailySection`).
- `src/features/dashboard/screens/segmented-control.tsx` — **new.** The 3-way `Button` switcher.
- `src/features/dashboard/screens/daily-section.tsx` — **new** (from `daily-summary-screen` body).
- `src/features/dashboard/screens/weekly-section.tsx` — **new** (from `trend-screen` body).
- `src/features/dashboard/screens/monthly-section.tsx` — **new** (4-week bars + rings + per-week avg).
- `src/features/dashboard/screens/calorie-bar-chart.tsx` — **new.** Shared bars + goal-line chart.
- `src/features/dashboard/lib/use-monthly-totals.tsx` — add `weeks: MonthWeek[]` (+ `MonthWeek` type)
  to the return; bucket rows into the four fixed day-buckets.
- **Remove:** `src/features/dashboard/screens/daily-summary-screen.tsx`,
  `src/features/dashboard/screens/monthly-screen.tsx`, `src/features/dashboard/screens/trend-screen.tsx`
  (their bodies move into the sections); `src/app/daily.tsx`, `src/app/monthly.tsx`, `src/app/trends.tsx`;
  and their `Stack.Screen` entries in `src/app/_layout.tsx`. Grep for `/daily`/`/monthly`/`/trends`
  references and remove them.
- **Keep/reuse:** `daily-summary.tsx`, `metric-ring.tsx` (`PlanRingsCard`), `plan-progress.ts`,
  `use-resolved-tz.ts`, `week-plan-progress.ts`, all hooks.

## Data model / schema impact
**None.** Pure client. `useMonthlyTotals` gains a per-bucket aggregation over rows it already fetches
(no new query, same `Pick<>` allowlist, same `.eq('user_id')`). No migration, no new dependency.

## Edge cases & failure modes
- **App entry** → Home mounts on `section='daily'`; only `DailySection`'s hooks fetch until the user
  switches (then that section mounts + fetches).
- **Switching sections** → the previous section unmounts (its hooks stop), the new one mounts +
  fetches on mount; the control stays pinned + usable during a section's load.
- **No goals** → each section's rings/summary show their existing "set your goals" hint / no-goal
  copy; the monthly + weekly bar goal line is simply absent (no `goalValue`), bars fill to max.
- **Empty day / week / month** → each section's own empty state (below the control).
- **Monthly future buckets** (today is the 10th → buckets 2,3 future) → those weeks have no rows →
  0-height bars; per-week average counts only `mealCount>0` buckets. Correct, not NaN.
- **Bucket 3 has 7–10 days** → its bar can exceed the daily×7 goal line legitimately (like a heavy
  day exceeds the daily line in the weekly chart) — accepted; the goal line is a single reference.
- **Month rollover / midnight** → `useMonthlyTotals`/`useDailyTotals`/`useWeeklyTotals` re-bucket off
  the live `todayKey` (0023) — the buckets + `todayBucket` advance with no refetch.
- **DST / tz** → inherited from `makeDayFormatter`/`resolveTimezone`; day-of-month bucketing uses the
  same locale-free key path.
- **Profile/tz error** → each section shows its own Retry (tz is load-bearing per section).
- **Deep link to a removed route** (`/trends` etc.) → route no longer exists; ensure no in-app
  reference remains (grep gate).

## Test / verify plan
- `npx tsc --noEmit` PASS; `npx expo lint` clean; full `npx expo export --platform web` green.
- **Manual (device/web, logged in):**
  1. Open the app → Home shows the Daily · Weekly · Monthly switcher pinned on top, **Daily**
     selected, today's summary below.
  2. Tap Weekly → 7-day bars + rings + weekly average, in place (no navigation). Tap Monthly →
     4-week bars + rings + per-week average. Tap Daily → back to the summary.
  3. Monthly bars: four buckets; cross-check one week's calories = sum of that bucket's days; the
     goal line sits at daily×7; the current week is highlighted; per-week average = month ÷ logged
     weeks.
  4. Regression: no `/daily`/`/monthly`/`/trends` routes remain; Capture/History tabs unchanged;
     ring geometry + no-goal/empty states intact; midnight/month rollover still rolls.
- **Grep gate:** no metric/goal/tz logged; no `select('*')`; no dangling route references.

## Rollout
Pure client, no migration/deploy/secret. Land on `main`; `tsc`/`lint`/export; user verifies the
switcher + monthly chart. Journal + mark Done + commit & push.

## Open questions
1. **Segmented control placement while scrolling** — pinned above the scroll (proposed) vs. scrolls
   with content. Proposed: pinned (stays usable). OK?
2. **Monthly bar labels** — "Wk 1…Wk 4" (proposed) vs. date ranges ("1–7", …). Proposed: "Wk 1…4"
   (compact). OK?
3. **Per-week average denominator** — logged weeks (`mealCount>0`, proposed, mirrors the weekly
   average's "logged days") vs. elapsed weeks. Proposed: logged weeks.
4. **Removing `/trends`** — the route is dropped (folded into the Home switcher). Any external
   bookmark/deep-link dependency? Assumed none (in-app only).

---

## Review
<!-- Filled by /review-plan. -->

## Execution log
<!-- Filled during execution. -->
