# Plan: Home = a Daily/Weekly/Monthly segmented switcher + monthly bar chart & weekly-average

- **Status**: ~~Draft~~ → ~~In Review~~ → **Approved** (2 stages) → In Progress → Done
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
_Executed in TWO stages/commits (SF5): **Stage A** = the switcher + extraction + route removal (no
behavior change beyond nav); **Stage B** = the monthly parity features._

### 1. Home host — owns the frame + shared plumbing (B1, SF1)
`dashboard-screen.tsx` becomes the switcher host. It owns `useState<'daily'|'weekly'|'monthly'>
('daily')` (Daily on COLD START, remembered across in-app tab switches), the SHARED plumbing
(`useResolvedTz` → `tz` + greeting + profile gate; `useDailyGoals` → `goals`; the goals
focus-refetch), and — critically — the **frame** (B1): an outer themed `View` (`paddingTop:
insets.top + Spacing.three`), the greeting + the pinned **`SegmentedControl`**, then a SINGLE
`ScrollView` (`contentContainerStyle`: horizontal padding + `maxWidth: MaxContentWidth`/`alignSelf:
center` + `paddingBottom: BottomTabInset + Spacing.four`) hosting the active section. The profile
loading/error gate renders INSIDE the scroll region (control stays usable). It passes `tz` + `goals`
down to the active section. Only the active section is mounted (whole-component conditional render →
rules-of-hooks safe; only that section's period hook fetches).

`segmented-control.tsx` (**new, B2**): a 3-up toggle ROW of its OWN pressables (small horizontal
padding, `numberOfLines={1}` + `adjustsFontSizeToFit`), selected = primary fill / unselected =
secondary — NOT `Button` reused (which wraps "Monthly" at large text).

### 2. Three section components — BARE content (B1), period hook only (SF1)
Each is bare content (Fragments/Views with `gap`, NO `Screen`/scroll/insets), takes `tz` + `goals`
as props, owns ONLY its period hook + that hook's gate + a period focus-refetch, and renders its
loading/error/empty INLINE below the control:
- **`DailySection`** — `useDailyTotals(tz)` + `<DailySummary totals goals>` + no-meals note.
- **`WeeklySection`** — `useWeeklyTotals(tz)` + the `CalorieBarChart` (7 day-bars) + weekly
  `PlanRingsCard(week, goals)` + weekly average.
- **`MonthlySection`** (Stage B) — `useMonthlyTotals(tz)` + the `CalorieBarChart` (4 week-bars) +
  monthly `PlanRingsCard` + the per-week average.

### 3. Extract a shared `CalorieBarChart` (Stage A)
`dashboard/screens/calorie-bar-chart.tsx`: `CalorieBarChart({ bars: { key, label, value, isCurrent,
hasData }[], domainMax, goalValue })` — the bars + goal-line rendering (the current `DayBar`
internals, generalized). `hasData` blanks the top value label when false (SF4 — a future/unlogged
bucket must not read "0"); the value label gets `numberOfLines={1}`/`adjustsFontSizeToFit` (5-digit
weekly totals). Weekly passes 7 day-bars (`label`=weekday, `isCurrent`=isToday, `hasData`=mealCount>0,
`goalValue`=daily goal); Monthly passes 4 week-bars (`label`="Wk 1"…"Wk 4" — formatted IN the
section, `isCurrent`=today's bucket, `hasData`=bucket mealCount>0, `goalValue`=daily×7). No visual
change to the weekly chart. Keep the `domainMax>0 ? … : 0` divide guard.

### 4. Monthly week buckets — pure helper + `useMonthlyTotals` (Stage B, SF2)
New pure `dashboard/lib/month-weeks.ts`: `monthWeeks(...)` → `MonthWeek[]` (length 4) from the
per-row bucketing `bi = Math.min(Math.floor((dayOfMonth − 1) / 7), 3)` (days 22–end → bucket 3).
`MonthWeek = { index, isCurrent, calories, protein, carbs, fat, mealCount }` — NO `label` (a view
concern), NO `days` (unused). `useMonthlyTotals` calls it inside the existing `[rows, tz, todayKey]`
memo (rows stay private to the hook) and returns `weeks: MonthWeek[]`; `todayBucket =
Math.min(Math.floor((elapsed − 1)/7), 3)` marks `isCurrent`. A `ZERO_WEEKS` skeleton (4 slots with
`index`+`isCurrent`, macros 0) is returned in the signed-out/loading/error branches (SF3).

### 5. Monthly bar chart + per-week average (Stage B)
- **Bar chart:** `CalorieBarChart` with the 4 `MonthWeek` bars (`value`=calories, `label`="Wk N"
  formatted here, `hasData`=mealCount>0), `goalValue` = daily goal × 7 (a SINGLE flat weekly-goal
  line across all four; bucket 3 may legitimately exceed it — accepted), `domainMax = goalWeekly !=
  null ? max(maxWeekCalories, goalWeekly×1.1) : maxWeekCalories`, `isCurrent` on `todayBucket`.
- **Per-week average card:** mirrors the weekly average — "Monthly average · over N logged week(s)"
  (N = buckets with `mealCount > 0`) → "X kcal / week" + protein/carbs/fat per-week averages =
  `sum(month) ÷ N` (0 logged weeks → the empty state, never NaN).

## Files to change
**Stage A (switcher + extraction + route removal):**
- `src/features/dashboard/screens/dashboard-screen.tsx` — the host: section state + shared plumbing
  (`useResolvedTz` + `useDailyGoals` + focus-refetch) + greeting + the frame (pinned control + one
  ScrollView + insets/clamp, B1) + the active section; drop the 0026 push-button row + `router` push.
- `src/features/dashboard/screens/segmented-control.tsx` — **new (B2).** Own-pressable 3-up toggle.
- `src/features/dashboard/screens/daily-section.tsx` — **new**, bare content (from `daily-summary-screen`
  body), takes `tz`+`goals`, owns `useDailyTotals` + inline gates.
- `src/features/dashboard/screens/weekly-section.tsx` — **new**, bare content (from `trend-screen` body),
  owns `useWeeklyTotals`, uses `CalorieBarChart`.
- `src/features/dashboard/screens/calorie-bar-chart.tsx` — **new.** Shared bars + goal-line chart
  (`hasData`, fit-shrink value label).
- **Remove:** `daily-summary-screen.tsx`, `trend-screen.tsx`, `monthly-screen.tsx`; `src/app/daily.tsx`,
  `src/app/monthly.tsx`, `src/app/trends.tsx`; their `Stack.Screen` entries in `src/app/_layout.tsx`;
  the 3 `router.push` refs. (Grep-gate `/daily`|`/monthly`|`/trends`.)

**Stage B (monthly parity):**
- `src/features/dashboard/lib/month-weeks.ts` — **new (SF2).** Pure `monthWeeks(...)` → `MonthWeek[]`
  (+ `MonthWeek` type; no `label`/`days`).
- `src/features/dashboard/lib/use-monthly-totals.tsx` — call `monthWeeks` in the memo; return
  `weeks` (+ `ZERO_WEEKS` skeleton in non-ok branches, SF3).
- `src/features/dashboard/screens/monthly-section.tsx` — **new**, bare content: `useMonthlyTotals` +
  `CalorieBarChart` (4 week-bars, "Wk N" labels) + monthly `PlanRingsCard` + per-week average.

**Keep/reuse:** `daily-summary.tsx`, `metric-ring.tsx` (`PlanRingsCard`), `plan-progress.ts`,
`use-resolved-tz.ts`, `week-plan-progress.ts`, all totals hooks.

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
_3-lens review (correctness, architecture, edge/UX), 2026-09-05. **Two BLOCKERs** (both
layout/UX) + should-fixes. All folded below._

### Verdict
**NEEDS CHANGES → RESOLVED → APPROVED.** Two blockers (the scroll/inset composition, and the
SegmentedControl label-fit) resolved. The core math (bucket formula, `todayBucket`, per-week
average, `domainMax`, lazy-mounted-sections model, route removal) was verified correct.

### BLOCKER (resolved)
- **B1 — Scroll/inset composition (a naive "sections keep their `<Screen scroll>`" breaks).** The
  shared `Screen` ALWAYS adds `insets.top`; a section reusing `<Screen scroll>` under the host's
  pinned control → double top-inset + nested ScrollView + a control that isn't actually pinned.
  **Resolution:** the **host owns the frame** — an outer themed `View` with `paddingTop: insets.top
  + Spacing.three`, the pinned `SegmentedControl`, then a SINGLE `ScrollView` whose
  `contentContainerStyle` carries the horizontal padding + `maxWidth: MaxContentWidth`/`alignSelf:
  center` (S4) + `paddingBottom: BottomTabInset + Spacing.four`. **Sections become BARE content**
  (Fragments/Views with their existing `gap`, NO `Screen`, NO scroll, NO insets); their
  loading/error/empty gates render INLINE below the control (S2), not as a full-screen `Screen`.
- **B2 — `SegmentedControl` from `Button` can't keep "Monthly" on one line at large text.** `Button`
  hardcodes `<Text type="smallBold">` with no `numberOfLines`/`adjustsFontSizeToFit` + 24px
  horizontal padding; three `flex:1` buttons wrap "Monthly" at OS large-text. **Resolution:** build
  `segmented-control.tsx` with its OWN pressables (smaller horizontal padding, `numberOfLines={1}` +
  `adjustsFontSizeToFit`/`minimumFontScale`), selected = primary fill / unselected = secondary. (A
  dedicated component is now justified — it's not just `Button` reuse.)

### SHOULD-FIX (folded in)
- **SF1 — The host owns the SHARED plumbing (`useResolvedTz` + `useDailyGoals` + focus-refetch);
  sections own ONLY their period hook.** Otherwise tz + goals re-resolve/re-fetch on every switch and
  the profile gate is triplicated. **Resolution:** host resolves tz + goals + the profile
  loading/error gate (inline, control stays usable) and passes `tz` + `goals` down; each section
  owns its `useDailyTotals`/`useWeeklyTotals`/`useMonthlyTotals` + that hook's gate + a period
  focus-refetch.
- **SF2 — Extract the 4-bucket derivation as a PURE `month-weeks.ts` helper, don't grow the hook.**
  `useMonthlyTotals` calls `monthWeeks(rows-agg, todayKey, …)` inside its existing `[rows, tz,
  todayKey]` memo (rows stay private to the hook — right privacy posture). Mirrors the
  `weekPlanProgress`/`planMetrics` pure-helper grain; keeps it testable without a fetch.
- **SF3 — `weeks` returned in ALL branches with `index` + `isCurrent` (skeleton), macros 0 when not
  fresh.** So the loading/error/signed-out UI still renders the 4 bar slots + current-week highlight
  (mirrors `ZERO_CONSUMED`). Define a `ZERO_WEEKS` skeleton.
- **SF4 — `CalorieBarChart` bar item needs `hasData` (behavior-preserving).** Today `DayBar` shows
  the calorie number only when `mealCount>0` (blank, not "0", for an unlogged period). The generic
  bar `{ key, label, value, isCurrent, hasData }` must blank the top label when `!hasData` (a future
  monthly bucket must not read "0"). Also add `adjustsFontSizeToFit`/`numberOfLines={1}` to the bar's
  value label (monthly per-week totals are ~5 digits) (N1).
- **SF5 — Ship in TWO stages/commits (lower blast radius).** **Stage A:** the structural switcher —
  host + `SegmentedControl` + extract `DailySection`/`WeeklySection` + `CalorieBarChart` (weekly-only
  consumer, ZERO visual change) + route/screen removal. **Stage B:** monthly parity — `month-weeks.ts`
  + `MonthlySection` (4-week bars + per-week average) + `useMonthlyTotals` extension. Each stage:
  its own `tsc`/`lint`/export + commit.

### NIT (addressed/noted)
- **Labels are a VIEW concern** — the hook returns `index` (+ raw fields), NOT the "Wk 1" string;
  the section/chart formats the label (keeps the derivation pure; lets OQ2 change freely). • **Drop
  `MonthWeek.days`** — unused with a flat `daily×7` goal line + `mealCount>0` average denominator; a
  leftover from the abandoned per-bucket line. • **Goal line is a SINGLE flat `daily×7`** across all
  4 bars (Problem/Goal prose corrected — no per-bucket line; bucket 3 may exceed it, accepted). •
  **Greeting ("Hi, {name}")** — the host owns the profile (via `useResolvedTz`), so render the
  greeting at the host top (above/beside the control); don't lose it. • **State persistence** —
  `useState('daily')` = Daily on COLD START, remembered across in-app tab switches (matches "on app
  entry"); reword Done to "Daily on cold start" (no focus-reset). • **Spinner flash per switch** —
  lazy-mount refetches on each switch (accepted; do NOT keep all three mounted — that defeats
  lazy-open + triples the open-time fetch). • **The switcher is a toggle ROW**, not an iOS segmented
  control (a joined pill would need a shared border; a gapped row of pressables is fine). • Current
  partial bucket reads "under" the flat line (inherent to bars; optional "in progress" cue, no
  action).

### Confirmed correct (no change)
Bucket formula `min(floor((DD−1)/7),3)` (1→0,7→0,8→1,21→2,22→3,31→3) + `todayBucket`; lazy-mounted
sections respect rules-of-hooks; per-week average `sum ÷ (mealCount>0 buckets)` NaN-safe; `domainMax`
headroom mirrors weekly; extending the `[rows,tz,todayKey]` memo stays compiler-safe + keeps the
`(userId,reloadKey)` gate + `userId==null` zeroing; the `mounted`/`active` in-flight guards live in
the hooks so moving callers into sections is safe; route removal has no dangling refs (only the 3
`router.push` + 3 re-exports + 3 `Stack.Screen` lines); no migration/new-dep/new-query.

## Execution log
<!-- Filled during execution. -->
