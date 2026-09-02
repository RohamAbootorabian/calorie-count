# Plan: Weekly view — Saturday-first bars + four "plan progress" rings

- **Status**: ~~Draft~~ → ~~In Review~~ → ~~Approved~~ → ~~In Progress~~ → **Done** (user-verified 2026-09-02 ✓)
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
A pure, testable helper `weekPlanProgress(days, goals)` (new, e.g. `week-plan-progress.ts`).
Header carries the no-log discipline (SF5): "never `console.*` a consumed/target/percent/goal
value; static/structural strings only." Inputs typed to the existing `DayTotals[]` + goals
`Pick<>` shapes so any future over-fetch is a compile error (SF5).
- **Elapsed days since Saturday (SF1 — derive structurally, guard `> 0`).** Today is ALWAYS the
  last chronological element (the hook's seed, pushed at `i===0`). `DayTotals` has no
  `getUTCDay()`, so compute the rank from the day itself: `elapsed = ((new
  Date(todayKey).getUTCDay()) + 1) % 7 + 1` (Sat→1 … Fri→7), or equivalently count from the
  most-recent `'Sat'`-labelled entry to the end inclusive. **Defensive:** if `days` is empty or
  has no `isToday` day → return `{ elapsed: 0, calories: null, protein: null, carbs: null, fat:
  null }`; never let `elapsed` be `0`/`undefined` and divide (that would make `percent =
  consumed/0 = Infinity`, which the `goal > 0` guard does NOT catch). Fall back to `days.length`
  if needed. (In practice the helper runs only below the gates where `days` is length-7 — see §4
  — but stays defensive.)
- **This-week consumed** = sum of `calories/protein/carbs/fat` over the **last `elapsed`
  chronological days** (today back to Saturday) — a contiguous tail (`days.slice(days.length -
  elapsed)`) of the 7-day array (Saturday is always ≤6 days before today, so it's inside the
  window).
- **Per-metric percent** = via the shared guarded-ratio helper (SF4): `goal > 0 ? consumed /
  (goal × elapsed) : null` — a missing/zero/NaN/negative goal → `null`, never NaN/Infinity.
  Returns the **real** ratio (may exceed 1). Each of the four metrics: `{ percent: number | null,
  consumed, target }`.
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
  label below the ring. `null` percent (no goal) → render a muted "—" (and no target/consumed
  subtext). **Cap the string** so an absurd value can't overflow the donut — e.g. `999%+` past a
  bound, plus `numberOfLines={1}` + `adjustsFontSizeToFit`.
- **Over-target color:** when `percent > 1`, the arc uses a distinct token (e.g. `danger` for
  calories-style "over", or a dedicated "over" color) so 120% reads differently from 90%.
  (Calories over = bad; protein over = usually fine — v1 uses ONE over color for all four;
  per-metric semantics is a follow-up, OQ.)
- Colors from the theme (`useTheme`), sized via props; no hard-coded hex. Accessible label
  derived from the metric name + percent (static string; never logs a value).

### 4. Trend screen — render the rings card
`trend-screen.tsx` already owns `useDailyGoals()` (for the 0019 goal line) and `useWeeklyTotals`.
- **Compute `weekPlanProgress(days, goals)` AFTER all early returns (SF2)** — below the
  loading/error/`loggedDays.length===0` gates, where `days` is guaranteed length-7 (the helper
  stays defensive per SF1 regardless).
- New `<Card>` below the summary card: a title ("This week's plan · N of 7 days" using `elapsed`),
  then a row of four `ProgressRing`s (Calories, Protein, Carbs, Fat) that wraps on a narrow screen.
  When a metric's `percent === null`, the ring shows "—" and does NOT render its `target`/`consumed`
  (would be `NaN`/`0`).
- **No goals set → gate on `!goalsLoading && goals == null` (SF3).** Only THEN show the muted hint
  "Set your goals in Settings to see weekly progress." While `goalsLoading`, render nothing / a
  skeleton in the card — NEVER the hint (else a refocus refetch race flashes the hint at a user who
  has goals). Mirrors the `goalCal` `!goalsLoading` guard (line 53–56).
- The card + ring render carry the no-log discipline (SF5): no `console.*` of any value.

## Files to change
- `src/features/dashboard/lib/use-weekly-totals.tsx` — add `isToday` to `DayTotals` (seed day
  only); keep the returned `days` chronological. (No fetch/window change.)
- `src/features/dashboard/lib/week-plan-progress.ts` — **new.** Pure `weekPlanProgress(days,
  goals)` → `{ elapsed, calories, protein, carbs, fat }` with per-metric `{ percent|null,
  consumed, target }` (Saturday-first elapsed count + guarded division; defensive on empty days).
- `src/features/dashboard/lib/guarded-ratio.ts` (or a shared export) — **new/extracted (SF4).**
  One `goal > 0`-guarded ratio helper returning the RAW ratio (+ optionally the clamped fraction),
  consumed by BOTH `week-plan-progress.ts` and `dashboard-screen.tsx` (which drops its inline
  duplicate). Exact placement/signature decided in execution; the point is one source of truth for
  "consumed ÷ goal".
- `src/features/dashboard/screens/dashboard-screen.tsx` — **(SF4)** replace the inline
  `progressFor` guard with the shared guarded-ratio helper (behavior unchanged — it still needs
  the clamped `fraction` + `over`/`remaining`).
- `src/features/dashboard/screens/trend-screen.tsx` — Sat-first display reorder of the bars;
  `DayBar isToday={day.isToday}`; new rings `<Card>` (four `ProgressRing`s + no-goal hint);
  caption "N of 7 days".
- **Ring component — dashboard-local (OQ1 resolved).** A file-local subcomponent (in
  `trend-screen.tsx` or a `dashboard/screens/` sibling), NOT `shared/ui` — it bakes in the
  center-percent + metric label + over-target semantics, and `shared/ui` is generic-primitives
  only (`DayBar`/`Bar` set the file-local precedent). Pure-`View` donut, center percent,
  over-target color, clamped visual fill. Do NOT add a generic `Ring` primitive.
- **No `theme.ts` change (OQ2 resolved).** Reuse the existing `danger` token for over-target; do
  NOT add a new color token (a v1 with one over-color doesn't justify adding a token to BOTH
  palettes via the `_themeColorCheck` guard). Per-metric over-semantics is the stated follow-up.

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
1. **Ring placement** — RESOLVED (review): dashboard-local, not `shared/ui`.
2. **Over-target color** — RESOLVED (review): reuse `danger`, one over-color for all four rings;
   per-metric semantics is a follow-up.
3. **Denominator = goal × elapsed-days** + **bars = rolling 7 days ordered Sat-first** — both
   confirmed by the user. The scope difference (bars = last 7 days, rings = this week Sat→today)
   is intended; the "N of 7 days" caption keeps it honest (review NIT).
4. **Caption wording** — "This week's plan · N of 7 days" for v1; cosmetic, tune during execution.
5. **Rings vs. 4 reused bars (review SF6)** — RESOLVED: rings stand per the user's explicit
   request for four circular charts; the 4-bar fallback (using the SF4 helper) is a drop-in if the
   user later prefers simplicity.

---

## Review
_Balanced 4-lens review (correctness, architecture, edge cases, data/privacy), 2026-08-27.
**No BLOCKERs** — the design is buildable as written. Should-fixes folded into the sections
above; consolidated + deduped below._

### Verdict
**APPROVED.** Zero blockers across all four lenses. The privacy claims (no new fetch / no
schema change / no extra cost / no auth gap / no cross-user staleness) were verified against the
code and hold. The correctness core (Sat-first bijection, `(getUTCDay()+1)%7` rank, elapsed =
rank+1, contiguous Sat→today tail, guarded division) was verified with worked examples. The
React-Compiler-lint risk is correctly avoided (pure render-time derivation, same shape as the
0019 goal line). Six should-fixes (robustness + reuse + one product-cost acknowledgement), all
folded in — none blocks coding.

### SHOULD-FIX (folded in)
- **SF1 — Pin down how the helper computes `elapsed` (correctness + edge).** `DayTotals` exposes
  only `key` + `weekdayLabel` (+ the new `isToday`), NOT a `getUTCDay()`/rank, so the plan's
  "the isToday day's rank" was underspecified AND fragile (a `goal × 0` denominator would make
  `percent = consumed/0 = Infinity`, which the `goal > 0` guard does NOT catch). **Resolution:**
  since today is ALWAYS the last chronological element, derive `elapsed` structurally — count
  from the most-recent `'Sat'`-labelled entry to the end, inclusive (equivalently `elapsed =
  ((new Date(todayKey).getUTCDay()) + 1) % 7 + 1`). Guard `elapsed > 0` (fall back to
  `days.length`), and have the helper return a defensive `{ elapsed: 0, calories: null, … }` when
  `days` is empty or has no `isToday` day. See §2 (updated).
- **SF2 — Compute `weekPlanProgress` AFTER the loading/error/empty gates.** The hook returns
  `EMPTY_DAYS` (`[]`) while loading/error, and 7 days only once OK; calling the helper above the
  gates hands it `[]` → the SF1 breakage. **Resolution:** compute it below all early returns
  (where `days` is guaranteed length-7), and keep the helper defensive per SF1. See §4 (updated).
- **SF3 — Gate the no-goal hint on `!goalsLoading && goals == null` to kill a flash (edge).** The
  top spinner gates on `profileLoading || loading` — NOT `goalsLoading`. On refocus, `refetch()`
  + `refetchGoals()` fire together; if the 8-day meal query resolves before the single goals row,
  the card would flash "Set your goals" at a user who HAS goals (a whole card swapping copy↔rings
  is more jarring than the 0019 line's brief absence). **Resolution:** render the hint ONLY when
  `!goalsLoading && goals == null`; while `goalsLoading`, render nothing/a skeleton in the card,
  never the hint (mirrors the `goalCal` `!goalsLoading` guard). See §4 (updated).
- **SF4 — Share the guarded-ratio, don't duplicate `progressFor` (architecture).** `progressFor`
  lives inline in `dashboard-screen.tsx` and returns a CLAMPED `fraction`; the ring needs the RAW
  ratio for the center label, so it can't be reused as-is and the plan would duplicate the
  `goal > 0` guard. **Resolution:** extract one guarded-ratio helper to the dashboard lib that
  returns the raw `ratio` (and/or the clamped `fraction`), consumed by BOTH the dashboard screen
  and `week-plan-progress.ts` — one source of truth for "consumed ÷ goal", no duplicated guard.
- **SF5 — New files must inherit the "never log a metric/goal/percent" discipline (privacy).**
  The existing hooks document it in their headers; the three new/edited surfaces
  (`week-plan-progress.ts`, the ring component, the trend card) must carry the same. **Resolution:**
  add an explicit "no `console.*` of consumed/target/percent/goal; static/structural strings
  only" note to the new-file headers; keep the grep gate ("no metric/goal value logged") as a
  hard verify step. Type the helper's inputs to the existing `DayTotals`/goals `Pick<>` shapes so
  any future over-fetch is a compile error (do NOT widen `SELECT_COLUMNS`).
- **SF6 — Price the ring honestly: rings vs. 4 reused bars (architecture, product).** The
  pure-View donut is ~80–120 lines of fiddly, untested-in-repo masking (the 0–50/50–100 split),
  invented to dodge a dep — whereas the existing `Bar` + guarded-ratio would render "4 metric
  meters" in a few lines with zero new primitives. Both work; the ring is a real product cost.
  **Resolution:** the user **explicitly requested four circular charts** ("چهار نمودار دایره‌ای"),
  so rings stand as a chosen cost — recorded here, not treated as free. (If the user later prefers
  simplicity, the 4-bar fallback is a drop-in using the SF4 helper.)

### NIT (addressed/noted)
- The `week-plan-progress.ts` seam is right (pure, testable, screen-independent) — keep it. •
  **OQ1 resolved → ring is dashboard-local** (it bakes in center-percent + label + over-target;
  `shared/ui` is generic-primitives-only; `DayBar`/`Bar` set the file-local precedent). Do NOT add
  a generic `Ring` primitive. • **OQ2 resolved → reuse the `danger` token** for over-target; do
  NOT add a theme token (a new token must be added to BOTH palettes via the `_themeColorCheck`
  guard for a v1 that uses one over-color). Per-metric over-semantics stays a follow-up. • Keep
  `isToday` in the hook (needed for the highlight post-reorder; rides the data so it can't
  desync); the reorder must stay **display-only** in the screen (hook keeps `days` chronological).
  • When `percent === null`, don't render `target`/`consumed` (would show `NaN`/`0`) — show "—".
  • **Cap the center string** for absurd percents (e.g. `999%+`, or `numberOfLines={1}` +
  `adjustsFontSizeToFit`) so a 9999% day can't overflow the donut. • Optional: disambiguate a
  tiny-but-nonzero value from true 0 (`<1%` vs `0%`) — low impact. • **Empty-week early-return**
  means a user with goals but zero meals sees the capture prompt, never the rings — intentional
  (one message at a time). • **"Ate last week, nothing this week"** → four 0% rings under "N of 7
  days" while bars show last-week data — truthful but the scope-difference (OQ3) is why the "N of
  7 days" caption stays. • DST / invalid-tz / Hermes-ICU are **inherited, not newly broken** — the
  Sat-first rank uses `getUTCDay()` on the same noon-UTC seed as the keys, so the highlight, order,
  and rank stay mutually consistent (only the pre-existing tz caveat remains). Confirmed sound.

## Execution log
_Executed 2026-08-27. Landed to the approved plan (all six should-fixes) — no deviations._

**Files.**
- `lib/guarded-ratio.ts` (**new, SF4**) — `guardedRatio(consumed, goal)` → raw ratio | null
  (`goal > 0` only). One source of truth for consumed÷goal.
- `lib/week-plan-progress.ts` (**new**) — pure `weekPlanProgress(days, goals)` → `{ elapsed,
  calories, protein, carbs, fat }`. `elapsed = ((getUTCDay(todayKey)+1)%7)+1` (SF1), defensive
  `EMPTY` when `days` empty or has no `isToday` day; this-week consumed = `days.slice(len-elapsed)`
  tail; per-metric via `guardedRatio(value, dailyGoal*elapsed)`. No-log header + typed to the
  existing `DayTotals`/`DailyGoals` `Pick<>` shapes (SF5).
- `lib/use-weekly-totals.tsx` — added `isToday: i === 0` to `DayTotals` (seed day); `days` stays
  chronological.
- `screens/dashboard-screen.tsx` (**SF4**) — `progressFor` now calls `guardedRatio` (behavior
  unchanged: still derives clamped `fraction` + `remaining`/`over`).
- `screens/trend-screen.tsx` — bars re-ordered Sat→Fri via `saturdayFirstRank(key)` sort
  (display-only; `days` untouched), `DayBar isToday={day.isToday}`; new rings `<Card>` computed
  AFTER the gates (SF2) with title "This week's plan · N of 7 days"; no-goal hint gated on
  `!goalsLoading && goals == null`, `goalsLoading` → an `ActivityIndicator`, never the hint (SF3);
  four `MetricRing`s (dashboard-local, OQ1) using a pure-`View` `ProgressRing` donut (two-layer
  border-arc technique, no SVG); over-target uses the `danger` token (OQ2); center string capped
  `999%+` + `numberOfLines`/`adjustsFontSizeToFit`; `percent===null` → "—", no consumed/target.

**Deviations.** None.

**Verification.** `npx tsc --noEmit` exit 0. `npx expo lint` exit 0 (clean). Full `npx expo
export --platform web` exit 0 — the new trend code ("This week's plan"/"weekly progress") is
present in the compiled production bundle (the entry route is code-split, so a full export, not
the entry.bundle curl, is the authoritative check — noted for future 0021-style route work).
Grep gate: no `console.*` in the two new libs or the trend screen. **User web-verify pending.**
