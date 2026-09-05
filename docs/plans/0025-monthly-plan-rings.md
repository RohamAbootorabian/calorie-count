# Plan: Monthly plan review — four rings (calories/protein/carbs/fat) on the Trend screen

- **Status**: **Draft** → In Review → Approved → In Progress → Done
- **Plan #**: 0025
- **Created**: 2026-09-05

## Problem / Goal
The Trend screen has a weekly plan-progress section (four rings, plan 0021) but no monthly view.
Add a **"This month's plan" section** to the SAME `/trends` screen: four ring charts —
Calories, Protein, Carbs, Fat — showing how much of the recommended daily plan the user has hit
**this calendar month so far** (1st → today):

  percent = consumed(month-to-date) ÷ (daily goal × days elapsed this month)

The real % is in each ring's center (can exceed 100%), the ring fills to a visual 100% cap, and an
over-target ring is colored `danger` — identical conventions to the weekly rings (0021).

**"Done" =** on `/trends`, below the weekly rings, a "This month's plan · N days" card shows four
labeled rings with the correct month-to-date percentages; over-target shows the true number + over
color; no daily goal set → the same graceful "set your goals" hint; the monthly card has its own
loading/empty handling (never blocks the weekly content); `tsc`/`lint`/web-bundle green; user
verifies. Pure client — no migration, no new dependency.

## Non-goals
- **No monthly BAR chart / no per-day monthly breakdown.** Four rings only (as requested). A
  30-bar daily chart is a possible later follow-up.
- **No month navigation** (prev/next month). Current month only.
- **No new dependency / no schema change.** Reads the existing `meal_logs` (same columns the
  weekly hook already selects); rings reuse the pure-View donut (0021).
- **No re-fetch of the weekly data for monthly.** A dedicated `useMonthlyTotals` fetch (a wider
  window than 8 days), so the two sections stay independent.
- **No change to the weekly section, the goal line, or the bars** beyond extracting the shared ring
  component.

## Proposed approach
Mirror the weekly plan-rings design (0021), reusing as much as possible.

### 1. Extract the ring UI into a shared dashboard component
`MetricRing` + the pure-`View` `ProgressRing` currently live file-local in `trend-screen.tsx`
(0021). Extract them into a shared dashboard-feature module (e.g.
`src/features/dashboard/screens/metric-ring.tsx`) so BOTH the weekly and the new monthly card
render identical rings. (Dashboard-local, not `shared/ui` — consistent with 0021's resolution.)
`RING_SIZE`/`RING_THICKNESS`/`formatPercent` move with it (or into a small shared module the screen
imports). No visual change to the weekly rings.

### 2. Share the per-metric ratio logic
`week-plan-progress.ts` computes `{ calories, protein, carbs, fat }` `MetricProgress` from a summed
`consumed` + `goal × elapsed` via `guardedRatio`. Extract that inner mapping into a shared
`planMetrics(consumed, goals, elapsed)` (same file or a sibling) used by BOTH `weekPlanProgress`
and the new monthly path — one source of truth for "consumed ÷ (goal × elapsed)". `weekPlanProgress`
keeps deriving its own `elapsed`/`consumed` (Saturday-based); monthly derives its own (below).

### 3. `useMonthlyTotals(tz)` — month-to-date consumed + elapsed
New hook mirroring `useWeeklyTotals`'s lifecycle (keyed `[userId, reloadKey]`, `mounted` ref,
strict `Pick<>` allowlist — `eaten_at,total_calories,total_protein,total_carbs,total_fat`, in-code
`.eq('user_id', userId)`, never `select('*')`, never logs a row/metric/tz):
- **Window:** fetch `eaten_at >= now − ~33 days` (tz-independent). The earliest instant still "this
  month" is the 1st at 00:00 local — at most `(elapsed−1)` days + a tz offset before now; with a
  max `elapsed` of 31 that's ≤ ~31 days, so ~33 days (with a cushion > the ≤14 h tz span) is
  provably enough. The window is tz-independent → never refetches on tz change.
- **Live boundary (0023):** `const todayKey = useCurrentDayKey(tz)`; derive `elapsed = day-of-month
  of todayKey` (the `DD` of `YYYY-MM-DD`) and the current month prefix `YYYY-MM`. Bucket in a
  `useMemo([rows, tz, todayKey])`: sum `calories/protein/carbs/fat` over rows whose
  `makeDayFormatter(tz).format(eaten_at)` starts with the current `YYYY-MM` (all logged rows are ≤
  today, so "this month" = month-to-date). Fetch-effect deps stay `[userId, reloadKey]` (no
  midnight refetch — SF pattern from 0023).
- Returns `{ loading, error, refetch, consumed: { calories, protein, carbs, fat }, elapsed,
  mealCount }`. `elapsed` is ≥ 1 (day-of-month), so `goal × elapsed` is never 0.

### 4. Render the monthly card on the Trend screen
`trend-screen.tsx`: call `useMonthlyTotals(tz)` + `useDailyGoals()` (already present). Compute
`const monthly = planMetrics(monthTotals.consumed, goals, monthTotals.elapsed)`. Below the weekly
rings card, add a `<Card>`:
- Title "This month's plan · N day{s}" (N = `elapsed`).
- **Its own gates (non-fatal — never block the weekly content):** monthly loading → a small
  spinner in the card; monthly error → a muted "Couldn't load this month" (no Retry needed, or a
  small one); `!goalsLoading && goals == null` → the same "Set your goals" hint as weekly; else the
  four `MetricRing`s.
- Add `refetchMonthly` to the screen's `useFocusEffect` (alongside `refetch`/`refetchGoals`).

## Files to change
- `src/features/dashboard/screens/metric-ring.tsx` — **new.** Extracted `MetricRing` +
  `ProgressRing` + `RING_SIZE`/`RING_THICKNESS`/`formatPercent` (moved verbatim from
  `trend-screen.tsx`; no behavior change).
- `src/features/dashboard/lib/week-plan-progress.ts` — extract a shared `planMetrics(consumed,
  goals, elapsed)`; `weekPlanProgress` calls it. (Export it for the monthly path.)
- `src/features/dashboard/lib/use-monthly-totals.tsx` — **new.** Month-to-date consumed + elapsed,
  mirroring `useWeeklyTotals` (wider window, live `todayKey`, strict allowlist).
- `src/features/dashboard/screens/trend-screen.tsx` — import the extracted ring; render the monthly
  card (own loading/empty/no-goal gates); `useMonthlyTotals`; `refetchMonthly` on focus. Remove the
  now-extracted ring code.

## Data model / schema impact
**None.** No migration/column/RPC. One additional read of `meal_logs` (a ~33-day window, strict
`Pick<>` allowlist, `.eq('user_id')` + RLS). No storage change.

## Edge cases & failure modes
- **No daily goals** → each metric `percent` is `null` → rings show "—"; the card shows the "set
  your goals" hint (gated on `!goalsLoading && goals == null`, mirroring weekly SF3).
- **No meals this month** → `consumed` all 0 → four 0% rings under "N days". (Optional: a friendlier
  "No meals logged this month yet" — decide in review; weekly shows an empty state at the screen
  level, but monthly is a sub-card so 0% rings are acceptable.)
- **Over-target** (e.g. 130% protein) → center shows the real %, ring fills to the 100% cap, `danger`
  color — same as weekly.
- **1st of the month** → `elapsed = 1`; rings are today-vs-a-one-day plan (goal × 1). Correct.
- **Month rolls over at midnight** → `useCurrentDayKey` flips `todayKey` → the memo recomputes:
  `elapsed` resets to 1 and the month prefix advances → month-to-date resets (only new-month rows
  count). The ~33-day window still holds the new month's early rows. No refetch needed for the roll.
- **Monthly fetch fails / slow** → the card shows its own error/spinner; the weekly section + goal
  line are unaffected (monthly is non-fatal, not in the screen's top gate).
- **DST / invalid tz / Hermes-ICU** → inherited from `makeDayFormatter`/`resolveTimezone`; the month
  prefix + day-of-month use the same locale-free path as the other hooks.
- **Cost** → one extra ~33-day `meal_logs` read per Trend open + on focus; bounded, user-scoped,
  allowlisted. Negligible.

## Test / verify plan
- `npx tsc --noEmit` PASS; `npx expo lint` clean; full `npx expo export --platform web` green
  (trend is code-split → export is the authoritative check, per 0021/0023).
- **Manual (web/device, logged in):**
  1. `/trends` → below the weekly rings, a "This month's plan · N days" card with four rings; N =
     today's day-of-month. Cross-check one metric by hand: `month-to-date consumed ÷ (goal ×
     day-of-month)`.
  2. Over a target this month → that ring > 100% with the over color.
  3. No goals → the hint (no NaN). No meals this month → 0% rings (or the empty copy if chosen).
  4. Regression: weekly rings + bars + goal line unchanged (the extracted ring renders identically);
     dashboard/History/edit untouched.
- **Grep gate:** no metric/goal/tz logged in the new hook; no `select('*')`; the new fetch uses the
  `Pick<>` allowlist; ring a11y label static.

## Rollout
Pure client, no migration/deploy/secret. Land on `main`; `tsc`/`lint`/export; user verifies the
monthly card. Journal + mark Done + commit & push.

## Open questions
1. **Empty-month copy** — 0% rings vs. a "No meals logged this month yet" note. Proposed: 0% rings
   (it's a sub-card; simplest, consistent). OK?
2. **Extraction home** — `dashboard/screens/metric-ring.tsx` (proposed) vs. a `components/` dir.
   Dashboard-local per 0021; proposed a screens-sibling file (mirrors `meal-editor-form.tsx`).
3. **Window size** — ~33 days proposed (provably ≥ a 31-day month-to-date + tz cushion). OK?

---

## Review
<!-- Filled by /review-plan. -->

## Execution log
<!-- Filled during execution. -->
