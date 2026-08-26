# Plan: Weekly view — Saturday-first bars + four "plan progress" rings

- **Status**: **Draft** → In Review → Approved → In Progress → Done
- **Created**: 2026-08-27
- **Plan #**: 0021

## Problem / Goal
Two changes to the **Weekly trend** screen (`/trends`):

1. **Start the week on Saturday.** Today the 7 bars are the rolling last-7-days, oldest→newest
   (today last). Re-order them into a **fixed weekday layout Sat → Fri** so the leftmost bar is
   always Saturday (the user's week start). Same data window (still the last 7 days — no empty
   future days, per the user's choice); only the column order + the "today" highlight change.

2. **Add a "plan progress" section: four circular (ring) charts** — Calories, Protein, Carbs,
   Fat — showing **how much of the recommended daily plan the user has hit so far this week**.
   Each ring is a percentage: **consumed (this week, Saturday → today) ÷ (daily goal × days
   elapsed since Saturday)**. The center shows the **real** percentage (e.g. `120%`), the ring
   fills up to a visual 100% cap, and an over-target ring is colored distinctly.

**"Done" =** on `/trends`, the bars read Sat → Fri (leftmost = Saturday), today is highlighted
wherever it falls; below the existing cards a new card shows four labeled rings with the correct
this-week-so-far percentages; over-target rings show the true number + an over color; no daily
goal set → the rings section degrades gracefully (a "set your goals" hint, no NaN); `tsc` /
`lint` / web-bundle green; user web-verifies. Pure client — **no migration, no new dependency,
no extra fetch.**

## Non-goals
- **No new chart/SVG dependency.** `react-native-svg` is a native module → a new dev build
  (established as painful). The rings are **pure `View`** (border + rotation masking), matching
  every other chart in the app (the trend bars, the dashboard progress bars).
- **No change to the bar DATA source.** Still the rolling last-7-days from `useWeeklyTotals`;
  only the display order changes. (The user explicitly chose "last 7 days, just ordered from
  Saturday" over "current calendar week with empty future days".)
- **No schema/goal change.** Goals stay daily (`useDailyGoals`); the weekly denominator is
  derived (goal × elapsed days). No `meal_logs`/`goals` migration.
- **No new fetch.** The ring numbers are aggregated from the SAME `days` the bars already use
  (this-week days are a contiguous subset of the last-7-days window).
- **No per-day rings / no history-of-weeks.** One current-week snapshot.
- **No re-theming the trend screen** beyond adding the rings card + reordering bars.

## Proposed approach
All changes are in the dashboard feature. `MealAnalysis`, the DB, and the fetch are untouched.

### 1. Saturday-first bar order (`use-weekly-totals.tsx` + `trend-screen.tsx`)
The last-7-days window contains **exactly one of each weekday**, so re-ordering to Saturday-first
is a fixed permutation — no data changes, no empty columns.
- **Mark today in the hook.** The seed IS today's local date, so tag the built day: add
  `isToday: boolean` to `DayTotals` (true only for the seed day). This replaces the screen's
  positional `i === days.length - 1` guard (which breaks once we reorder).
- **Return the days still chronological** (oldest→newest) from the hook — the ring aggregation
  (below) needs chronological order to take "the last N days = this week". The **display**
  reorder happens in the screen (or a tiny pure helper), so the hook stays a pure data source.
- **Saturday-first rank:** for a day with `getUTCDay()` (Sun=0…Sat=6), rank = `(getUTCDay()+1) %
  7` → Sat=0, Sun=1, …, Fri=6. Sort the 7 days by this rank for display. (Locale-free, reuses the
  existing noon-UTC/UTC-accessor convention — no second tz formatter, matching the file's B1 rule.)
- `DayBar` gets `isToday={day.isToday}` instead of the positional check.

### 2. Ring data — "this week so far" (pure helper in the dashboard lib)
A pure, testable helper `weekPlanProgress(days, goals)` (new, e.g. `week-plan-progress.ts`):
- **Elapsed days since Saturday** = today's Saturday-first rank + 1 (Sat→1, …, Fri→7). Today is
  the `isToday` day; its rank gives the count with no calendar math.
- **This-week consumed** = sum of `calories/protein/carbs/fat` over the **last `elapsed`
  chronological days** (today back to Saturday) — a contiguous tail of the 7-day array (Saturday
  is always ≤6 days before today, so it's inside the window).
- **Per-metric percent** = `goal > 0 ? consumed / (goal × elapsed) : null` (the `progressFor`
  guard pattern from `dashboard-screen.tsx` — a missing/zero goal → `null`, never NaN/Infinity).
  Returns the **real** fraction (may exceed 1). Each of the four metrics: `{ percent: number |
  null, consumed, target }`.
- Returns `{ elapsed, calories, protein, carbs, fat }`. No I/O, no logging (health data).

### 3. Ring component — pure `View` donut (`shared/ui` or a dashboard-local subcomponent)
A `ProgressRing` that draws a 0–100% arc with **no SVG**, using the standard two-half-rotation
technique:
- A square track (full circle via `borderRadius: size/2`, `borderWidth`, track color).
- Two half-circle overlays (left/right), each a half clipped by an `overflow:'hidden'` wrapper,
  rotated by an angle derived from the **clamped** fraction (`Math.min(percent, 1)`) so the
  filled arc grows 0→360°. The **visual fill caps at 100%** even when `percent > 1` (per the
  user's choice: real number in the center, ring full).
- **Center label:** the real percent as an integer (`Math.round(percent*100)%`), plus the metric
  label below the ring. `null` percent (no goal) → render a muted "—".
- **Over-target color:** when `percent > 1`, the arc uses a distinct token (e.g. `danger` for
  calories-style "over", or a dedicated "over" color) so 120% reads differently from 90%.
  (Calories over = bad; protein over = usually fine — v1 uses ONE over color for all four;
  per-metric semantics is a follow-up, OQ.)
- Colors from the theme (`useTheme`), sized via props; no hard-coded hex. Accessible label
  derived from the metric name + percent (static string; never logs a value).

### 4. Trend screen — render the rings card
`trend-screen.tsx` already owns `useDailyGoals()` (for the 0019 goal line) and `useWeeklyTotals`.
- Compute `weekPlanProgress(days, goals)` during render (goals may be `null`/loading — non-fatal,
  mirrors the 0019 goal-line derivation guarded on `!goalsLoading`).
- New `<Card>` below the summary card: a title ("This week's plan · N of 7 days"), then a row of
  four `ProgressRing`s (Calories, Protein, Carbs, Fat) that wraps on a narrow screen.
- **No goals set** (`goals == null` and not loading) → instead of rings, a muted hint: "Set your
  goals in Settings to see weekly progress." (mirrors the dashboard's no-goal copy). Loading →
  the existing top-level spinner already gates (goals resolves before totals).

## Files to change
- `src/features/dashboard/lib/use-weekly-totals.tsx` — add `isToday` to `DayTotals` (seed day
  only); keep the returned `days` chronological. (No fetch/window change.)
- `src/features/dashboard/lib/week-plan-progress.ts` — **new.** Pure `weekPlanProgress(days,
  goals)` → `{ elapsed, calories, protein, carbs, fat }` with per-metric `{ percent|null,
  consumed, target }` (Saturday-first elapsed count + guarded division).
- `src/features/dashboard/screens/trend-screen.tsx` — Sat-first display reorder of the bars;
  `DayBar isToday={day.isToday}`; new rings `<Card>` (four `ProgressRing`s + no-goal hint);
  caption "N of 7 days".
- `src/shared/ui/progress-ring.tsx` (or a dashboard-local subcomponent) — **new.** Pure-`View`
  donut ring with a center percent + over-target color + clamped fill. (Decide placement in
  review: `shared/ui` if it's generic; dashboard-local if trend-specific. Leaning dashboard-local
  since it bakes in the center-percent + label layout.)
- (Maybe) `src/constants/theme.ts` — add an "over-target" color token IF `danger` isn't the right
  fit for all four rings; otherwise reuse `danger`/`primary`. Decide in review.

## Data model / schema impact
**None.** No migration, no column, no RPC change. Goals stay daily; the weekly plan is derived
(`goal × elapsed`). No storage/fetch change — the rings reuse the bars' already-fetched rows.

## Edge cases & failure modes
- **No daily goals set** → each `percent` is `null`; the rings card shows the "set your goals"
  hint instead of `NaN`/`Infinity` rings (guarded division, `goal > 0` only).
- **Goal present but zero consumed this week** → `0%`, empty ring (not an error).
- **Consumed over target** (e.g. 120% calories) → center shows `120%`, ring visually full, over
  color. No clamp on the NUMBER, only on the visual arc.
- **Today is Saturday** → `elapsed = 1`; rings are today-only vs. a one-day plan (denominator =
  goal × 1). Correct, not a divide-by-small artifact (it's a real one-day progress).
- **Empty week (no meals logged)** → the existing all-7-empty branch still shows the friendly
  empty state BEFORE the rings; if partially empty, rings compute from what's logged (consumed
  may be 0 for a metric → 0%).
- **DST / invalid tz** → unchanged; the Sat-first rank uses `getUTCDay()` on the same noon-UTC
  seed the keys already use (no new tz formatter), so it inherits the file's DST-safe posture.
- **Reorder correctness** → because any 7 consecutive days contain each weekday exactly once, the
  Sat-first sort is a bijection (no dropped/duplicated column); `isToday` rides the data, so the
  highlight lands on the right column regardless of what today is.
- **Ring rounding** → center percent is `Math.round`; a 99.6% shows `100%` but the ring isn't
  quite full — acceptable (matches the rounded integers used everywhere else).
- **Very large percent** (e.g. 500%) → number shown as-is; ring capped at full. No layout break
  (the center text is the metric's own — bounded width).

## Test / verify plan
- `npx tsc --noEmit` PASS; `npx expo lint` clean; web bundle HTTP 200 with the new card.
- **Manual (web, logged in):**
  1. Open `/trends` → bars read **Sat → Fri** left→right; today's bar is the highlighted one
     (verify on a day that isn't Friday, so "today ≠ last column" is exercised).
  2. With goals set: the four rings show plausible this-week-so-far percentages; cross-check one
     metric by hand (`consumed Sat→today ÷ (goal × elapsed)`).
  3. Eat over a target for a day → that ring shows >100% with the over color, ring full.
  4. Clear/unset goals (or a fresh account) → rings card shows the "set your goals" hint, no NaN.
  5. Regression: the 0019 **goal line** on the bars still renders; the weekly average card is
     unchanged; dashboard/History/edit untouched.
- **Grep gate:** no metric/goal value logged; no `select('*')`; ring a11y label is a static
  string.
- **Deferred iPhone pass:** the pure-View ring render + the Sat-first order on-device (Hermes/ICU
  tz caveat already tracked for the buckets).

## Rollout
Pure client, single screen + two new files. Land on `main`; `tsc`/`lint`/web-bundle; user
web-verify. Journal + mark Done + commit & push. (No migration, no deploy, no secret.)

## Open questions
1. **Ring placement in `shared/ui` vs. dashboard-local** — leaning dashboard-local (it bakes in
   the center-percent + label). Confirm in review.
2. **One over-target color for all four rings vs. per-metric semantics** (calories-over = bad,
   protein-over = fine). v1 proposes ONE over color; per-metric is a follow-up. OK?
3. **Denominator = goal × elapsed-days** (progress "so far this week") is confirmed by the user.
   The bars remain the rolling 7-day window ordered Sat-first (also confirmed). Flag any residual
   mismatch between "bars = last 7 days" and "rings = this week Sat→today" in review — they share
   the fetch but scope differently by design.
4. **Caption wording** — "This week's plan · N of 7 days" vs. something clearer? Cosmetic.

---

## Review
<!-- Filled by /review-plan. -->

## Execution log
<!-- Filled during execution. -->
