# Plan: Calorie goal line on the weekly trend chart

- **Status**: ~~Draft~~ → ~~In Review~~ → ~~Approved~~ → **In Progress** (user web-verify pending) → Done
- **Created**: 2026-08-26
- **Plan #**: 0019

## Problem / Goal
The weekly trend chart (plan 0018) shows 7 daily-calorie bars but no reference point, so
a user can't tell at a glance which days were **over or under their calorie target**. This
adds a single **horizontal goal line** across the 7 bars at the user's daily calorie goal
(`useDailyGoals().goals.calories`), plus a small label. It's the named 0018 follow-up
("goal overlay line"). **Pure client, read-only, no backend/migration, no new dependency.**

**"Done" =** on the Weekly Trend screen, when the user has a calorie goal set, a horizontal
line is drawn across the bar band at the goal level with a small "goal N" label; the chart's
y-axis rescales to `max(maxCalories, goal)` so the line and every bar always fit; when NO
goal is set (or goals fail to load) the chart renders exactly as it does today (no line, no
crash — goals are non-fatal); `tsc`/`lint`/web-bundle green; user web-verifies.

## Non-goals
- **No per-macro goal lines** — calories only (protein/carbs/fat lines are a separate
  follow-up; the metric-toggle option was explicitly deferred).
- **No metric toggle** (calories↔macros on the bars) — separate follow-up.
- **No per-bar over/under coloring** (e.g. red bars over goal) — the line is the only new
  signal; bar color stays `primary` (no new token, matches 0018).
- **No goal editing from this screen** — the goal is read-only here; it's set in Settings.
- **No y-axis ticks / gridlines / numeric axis** — just the one goal reference line.
- **No change to `useDailyGoals` or the dashboard** — this screen already has the precedent
  (`useDailyGoals` on the dashboard); we add the same read here.
- **No new backend read** beyond the existing `useDailyGoals` (strict `Pick<>` allowlist,
  `.eq('user_id')`), and no migration/RLS/storage.

## Proposed approach
Smallest change: **add `useDailyGoals` to the trend screen, rescale the bars to include the
goal, and draw the goal line as an absolutely-positioned segment INSIDE each existing track**
(no chart restructure — SF1). Everything is in `trend-screen.tsx`; the hook already exists.

### 1. Read the goal (non-fatal; hold last resolved value — SF4)
- In `TrendScreen`, add `const { goals, loading: goalsLoading, refetch: refetchGoals } =
  useDailyGoals();` (mirrors the dashboard). Extend the existing `useFocusEffect` to also
  `refetchGoals()` (add it to the dep array) so an edited goal reflects on return.
- **Goals are NON-FATAL** (mirrors the dashboard): the gate order
  (loading/profileError/totalsError/all-empty) is UNCHANGED — a goals load/error never blocks
  or gates the chart.
- **Hold the last *resolved* goal** so a focus-refetch's transient `loading:null` doesn't
  blink the line / rescale the bars (SF4):
  ```
  const lastGoalRef = useRef<number | null>(null);
  if (!goalsLoading) lastGoalRef.current =
    typeof goals?.calories === 'number' && goals.calories > 0 ? goals.calories : null;
  const goalCal = lastGoalRef.current;   // null ⇒ no goal (or genuinely removed) ⇒ no line
  ```
  The `> 0` guard mirrors the dashboard's `progressFor`. Updating only when `!goalsLoading`
  means a genuinely-removed goal still clears, but a mid-refetch null never drops the line.

### 2. Rescale the bar domain to fit the goal (with headroom — B1)
- Bars scale to a domain that always leaves the goal line visible:
  `const domainMax = goalCal != null ? Math.max(maxCalories, goalCal * 1.1) : maxCalories;`
  (guard `domainMax > 0` → all-zero + no-goal still renders flat bars). Bar height % becomes
  `day.calories / domainMax`.
  - **Headroom applies ONLY when a goal exists**, so the no-goal path is byte-identical to
    0018 (bars fill fully to `maxCalories`). With a goal, the `* 1.1` keeps the line ≤ ~91 %
    (visible, never pinned at the ceiling); a bar equal to `maxCalories` simply stops short of
    the top — fine. (Belt: clamp the line's `bottom%` to `Math.min(pct, 95)`.)

### 3. Draw the goal line as a per-track segment (no restructure — SF1)
Keep 0018's per-column layout (`[calLabel, track, weekdayLabel]`) EXACTLY. Pass `goalCal` and
`domainMax` into `DayBar`; inside its existing `track` (already `position:relative`,
`overflow:hidden`, identical height across columns), render — ONLY when `goalCal != null` — an
absolutely-positioned line:
- `<View style={{ position:'absolute', left:0, right:0, height:1.5,
  backgroundColor: theme.textSecondary, bottom: `${Math.min((goalCal/domainMax)*100, 95)}%` }} />`
- Both the fill `height%` and the line `bottom%` are relative to the SAME track, so they share
  one coordinate space and line up with no pixel math. All tracks have equal height, so the 7
  segments align horizontally into one reference level (a small gap at each column gutter —
  conventional, acceptable). The bar-fill styling (newest full-opacity / older `opacity:0.45`)
  is unchanged.
- **Goal label — in the card CAPTION, not floating (SF3):** the chart card's header text
  becomes `Calories · last 7 days{goalCal != null ? ` · goal ${round(goalCal)} kcal` : ''}`
  (STATIC prefix; only the number interpolated). Nothing floats over the bars, so there's no
  overlap with value labels in the goal≥max regime.

### 4. (Summary card — unchanged in v1)
The weekly-average summary card stays as-is. (An optional "avg vs goal" is noted in Open
questions, not built in v1.)

## Files to change
- `src/features/dashboard/screens/trend-screen.tsx` — the ONLY file. Add `useDailyGoals` +
  `refetchGoals` on focus + the `lastGoalRef` hold (SF4); compute `goalCal` + `domainMax`
  (headroom, B1); pass `goalCal`/`domainMax` into `DayBar`; inside `DayBar`'s existing `track`
  render the per-track goal-line segment (SF1); bar height uses `domainMax`; add the goal to
  the chart card caption (SF3). **No chart restructure**; gates, empty state, summary, weekday
  labels, and `DayBar` fill styling are otherwise unchanged.

## Data model / schema impact
**None.** No new backend read **shape** — the same allowlisted `useDailyGoals` query the
dashboard already issues (strict `Pick<>` `calories, protein, carbs, fat`, `.eq('user_id')`);
it adds one extra single-row fetch + a focus refetch on this screen. No
tables/columns/migrations/RLS/storage. The calorie goal is health data — never log
`goals`/`goalCal`/`domainMax`/`tz`, and never interpolate `goalCal` into `ErrorState` or any
telemetry (SF5).

## Edge cases & failure modes
- **No goal set** (`goals` null or `calories` null/≤0) → `goalCal` null → no line, `domainMax
  = maxCalories` → chart identical to 0018.
- **Goals still loading** → `goalCal` null this render → no line; the focus refetch + a later
  render draws it once it arrives (no flscreen gate on goals).
- **Goals error** → non-fatal (mirrors dashboard) → no line; the chart still renders. The
  screen never shows the error state for a goals failure.
- **Goal ≥ every day's calories** → `domainMax = goalCal * 1.1` (headroom, B1) → bars scale
  down, line sits at ~91 % (visible, NOT pinned at the ceiling). **Goal ≤ some days** →
  `domainMax = maxCalories`, those days' bars rise above the line (over target), days under
  stay below — the over/under signal the feature is for.
- **Enormous goal vs tiny intake** (e.g. 5000 goal, ~300-cal days) → bars become slivers (the
  trend is lost). **Accepted for v1** (rare); a domain cap + "↑ over range" marker is a
  follow-up. **Very small goal** (e.g. 50) → line hugs the band bottom near the weekday row;
  accepted (the `>0` guard stands).
- **Focus refetch** → the `lastGoalRef` hold (SF4) keeps the last resolved goal, so the line
  doesn't blink and the bars don't rescale mid-refetch; a genuinely-removed goal still clears
  (updates only when `!goalsLoading`).
- **All 7 days empty** → the existing all-empty gate fires first (empty state), so the chart
  (and line) never render — no divide-by-zero.
- **A logged day with 0 calories but a goal set** → `domainMax = goal > 0`, flat bar, line
  shown — correct.
- **Timezone / sign-out / rapid-nav** → unchanged from 0018 (`useWeeklyTotals` untouched;
  `useDailyGoals` has the same keyed-outcome/`mounted` machinery).
- **Narrow screen** → the goal label is a short "goal 2000"; verify it doesn't overlap the
  top bar's value label (place it at the band's top-right, inside the band).
- **Native `Intl`** caveat unchanged (bucketing) — goals don't touch tz; deferred iPhone pass.

## Test / verify plan
- `npx tsc --noEmit` PASS; `npx expo lint` clean; web bundle HTTP 200 (valid JS) with the
  updated screen.
- **Manual (web, logged in, with a calorie goal set in Settings):**
  1. Home → Weekly trend → a horizontal line crosses the bars at the goal; label reads "goal N".
  2. Days above the line vs below match a hand check against the goal.
  3. Set a goal HIGHER than any day (Settings) → return → bars shrink, line near top, all visible.
  4. Clear/blank the goal (or a user with none) → no line, chart looks like before, no crash.
  5. Edit the goal in Settings → return to the trend → the line moves (focus refetch).
  6. Regression: 7 bars + weekday labels + weekly-average summary + empty state all unchanged;
     dashboard unaffected.
- **Grep gate:** no PII logged; the goal label interpolates only the number (static prefix);
  no `select('*')` (reuses the allowlisted `useDailyGoals`).
- **Deferred iPhone pass:** line + label render on-device; dashed/solid line visible in both
  themes.

## Rollout
1. Land the one changed file on `main` (no migration, no env, no deploy).
2. `tsc`/`lint`/web-bundle; user web-verify.
3. Journal + mark Done + commit & push.

## Open questions
1. **Line style/color** — proposed a solid 1.5 px `textSecondary` line + "goal N" label
   (robust in both themes, no new token). Dashed is finickier cross-platform (esp. web). OK
   with solid?
2. **Summary "avg vs goal"** — optionally show "avg 1850 / goal 2000" in the summary card too.
   Proposed: NOT in v1 (keep scope to the chart line). Add later?
3. **Over-goal emphasis** — leave bars uniformly `primary` (proposed) vs tint days over goal.
   Proposed: uniform for v1 (no new token; the line already conveys over/under).

---

## Review
_Balanced 4-lens review (correctness, architecture, edge cases, data/privacy),
2026-08-26. One BLOCKER (the goal≥max ceiling case, found by correctness + edge) and one
strong architecture simplification (drop the restructure; per-track line segments) reshape
the approach. All resolutions folded into §2/§3 above._

### BLOCKER (resolved)
- **B1 — With `domainMax = max(maxCalories, goalCal)`, a goal ≥ every day pins the line at
  `bottom:100%`, rendering it ABOVE/outside the band (invisible/clipped).** This is a common
  state (a user under their target all week → `goalCal === domainMax` → ratio 1.0). The
  plan's "line sits near the top, on-screen" was wrong for that whole regime, and it breaks
  the plan's own test step 3. **Resolution — domain headroom, applied only when a goal
  exists so the no-goal path stays byte-identical to 0018:**
  `const domainMax = goalCal != null ? Math.max(maxCalories, goalCal * 1.1) : maxCalories;`
  Now the line is always ≤ ~91 % (visible with headroom above); bars still fill fully when
  there's no goal. (Belt: also `Math.min(pct, 95)`-clamp the line's `bottom%`.)

### SHOULD-FIX (folded in)
- **SF1 — Drop the 3-row restructure; render the goal line as a per-track segment (arch).**
  The claim "the per-column stack can't host a spanning line" was overstated. Each `track`
  is already a fixed-height, `position:relative`, `overflow:hidden` box of identical height
  across columns. Putting one absolutely-positioned `View` INSIDE each `DayBar` track at
  `bottom: (goalCal/domainMax)*100%` places the line in exactly the bars' coordinate space
  (both the fill `height%` and the line `bottom%` are relative to the SAME track) — with
  **zero restructure**, preserving 0018's free value/bar/weekday alignment. Cost: the line
  is 7 aligned segments with a small gap at each column gutter rather than one continuous
  stroke — an acceptable, even conventional, reference-line look. **This deletes the whole
  alignment tax** (below) and the card-height growth, and is meaningfully less code/risk.
- **SF2 — (mooted by SF1) column mis-alignment.** The restructure would have required the
  value-row / tracks-row / weekday-row to independently share `flex:1` + identical
  `gap: Spacing.two` + identical horizontal padding, or the 7 centers drift (worst at the
  edges). SF1 removes the restructure, so this risk disappears. (Had we kept it, this was a
  mandatory invariant.)
- **SF3 — Goal label goes in the card CAPTION, not floating on the chart.** A label pinned
  near the line collides with the tallest bar's value label exactly in the goal≥max regime
  B1 targets. **Resolution:** put the goal in the chart card's caption —
  `Calories · last 7 days{goalCal != null ? ` · goal ${round(goalCal)} kcal` : ''}` — so
  there's nothing to overlap. (Optionally a tiny line swatch; not required.)
- **SF4 — Hold the last resolved goal so a focus-refetch doesn't blink the line + rescale
  the bars (edge).** `refetchGoals()` bumps the hook's `reloadKey` → it returns
  `{loading:true, goals:null}` until the fetch lands → `goalCal` momentarily null →
  line vanishes and every bar jumps taller, then snaps back. **Resolution:** read the hook's
  `loading` and hold the last *resolved* goal so a transient refetch doesn't drop it:
  ```
  const { goals, loading: goalsLoading, refetch: refetchGoals } = useDailyGoals();
  const lastGoalRef = useRef<number | null>(null);
  if (!goalsLoading) lastGoalRef.current =
    typeof goals?.calories === 'number' && goals.calories > 0 ? goals.calories : null;
  const goalCal = lastGoalRef.current;
  ```
  This updates only when goals has *resolved* (so a genuinely-removed goal still clears), and
  never drops mid-refetch. (Ref-write in render is the standard "previous value" cache —
  idempotent, strict-mode-safe.)
- **SF5 — Data/privacy wording + logging discipline.** (a) Reword "no new backend read" → "no
  new backend read **shape** — the same allowlisted `useDailyGoals` query the dashboard
  already issues; it adds one extra single-row fetch + a focus refetch per visit." (b) Add an
  explicit line: the goal value (like the calorie bars) is health data — never log
  `goals`/`goalCal`/`domainMax`/`tz`, and never interpolate `goalCal` into `ErrorState` or any
  telemetry (keep the error copy static). The reused hook already keeps the strict `Pick<>`
  allowlist + `.eq('user_id')` (no body PII, no new RLS) — confirmed, unchanged.

### NIT (addressed/noted)
- **Line thickness:** a defined ~1.5 px `theme.textSecondary` line (kept for visibility — a
  goal reference should read clearly; `StyleSheet.hairlineWidth` risks being too faint). No
  new token. • **Enormous goal vs tiny intake** (e.g. 5000 goal, ~300-cal days) collapses
  bars into slivers — the day-to-day trend, the chart's whole point, is lost. **Accepted for
  v1** (rare; the common goal≈intake case looks right); a domain cap + pinned "↑ over range"
  marker is a named follow-up (OQ). • **Very small positive goal** (e.g. 50) hugs the band
  bottom near the weekday row — accepted for v1 (who sets a 50-kcal goal); the `>0` guard
  stands. • **First-load one-time rescale** when goals resolves after totals — acceptable;
  SF4 ensures it stays a one-time settle, not a per-focus jump. • **percentage `bottom` in
  RN** is valid (Yoga resolves percentage insets against the relative parent) — confirmed,
  not a silent no-op.
- **Confirmed correct, no change:** reusing `useDailyGoals` (dashboard grain, strict
  `Pick<>`, `.eq('user_id')`, non-fatal) is the right call — no new hook, no new file
  (`DayBar` already lives in `trend-screen.tsx`; a `WeeklyChart` extraction would be
  speculative); DS fit is clean (tokens only); the all-empty gate still fires before the
  chart (no divide-by-zero); null/0/negative goal handled by `>0`.

### Verdict
**NEEDS CHANGES → RESOLVED.** One blocker (B1: line at the ceiling), fixed with goal-only
domain headroom. The design is simplified per SF1 (no restructure — per-track line segments,
which also dissolves the alignment and label-collision risks), plus the focus-refetch blink
hold (SF4) and the data/privacy wording (SF5). With the edits applied above, **APPROVED**.

## Execution log
Built per the approved plan — one file, `trend-screen.tsx`. Added `useDailyGoals` +
`refetchGoals` on focus; `domainMax = goalCal != null ? max(maxCalories, goalCal*1.1) :
maxCalories` (headroom only with a goal — B1); passed `domainMax`/`goalCal` into `DayBar`,
which now scales the fill by `domainMax` and renders a per-track absolutely-positioned line
`View` (`textSecondary`, `bottom: min(goalCal/domainMax*100, 95)%`) inside its existing
`track` (no chart restructure — SF1); the goal is shown in the chart card caption ("· goal N
kcal" — SF3). No restructure, no new file, no backend/migration change.

**Deviation (accepted):** the SF4 "hold last resolved goal" via a `useRef` written in render
tripped the **react-compiler** lint rule `react-hooks/refs` ("Cannot access ref value during
render"); the `useState`+`useEffect` alternative would trip `react-hooks/set-state-in-effect`
(the same rule that shaped 0015). Resolved by **deriving `goalCal` during render** guarded on
`!goalsLoading`. The transient line-drop SF4 worried about is masked in practice: on focus the
totals refetch shows the full-screen spinner (the chart isn't mounted), and the single-row
goals query resolves before the 8-day totals query — so the line is present when the chart
re-appears. Documented in-code.

**Verified:** `tsc --noEmit` exit 0; `expo lint` clean; web bundle HTTP 200 · 3.9 MB ·
complete. **PENDING: user web-verify** (goal line at the target level, caption, rescale when
goal>days, no-goal unchanged, edit-goal reflects) before flipping to Done. Line render on
native rides the deferred iPhone pass.
