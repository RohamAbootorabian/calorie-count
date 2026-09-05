# Plan: Monthly plan review — four rings (calories/protein/carbs/fat) on the Trend screen

- **Status**: ~~Draft~~ → ~~In Review~~ → **Approved** → In Progress → Done
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

### 1. Extract the ring UI + a shared `PlanRingsCard` (SF1)
`MetricRing` + the pure-`View` `ProgressRing` currently live file-local in `trend-screen.tsx`
(0021). Extract them into `src/features/dashboard/screens/metric-ring.tsx` (dashboard-local, not
`shared/ui` — consistent with 0021), moving `RING_SIZE`/`RING_THICKNESS`/`formatPercent` **and** the
card-layout styles (`rings`/`ringsLoading`). In the SAME module, add a shared **`PlanRingsCard`**:
```
PlanRingsCard({ title, subtitle?, loading?, error?, goalsMissing, metrics, emptyNote? })
```
rendering `title/subtitle` then one of: `loading` spinner · `error` note · `goalsMissing` "set your
goals" hint · `emptyNote` (e.g. "No meals logged this month yet") · the four `MetricRing`s. Used by
BOTH the weekly and monthly cards so the gate JSX isn't duplicated. Weekly passes no `loading`/`error`
(its gating is the screen structure, §4); monthly passes its non-fatal ones. **SF4:** lower the
extracted `MetricRing` subtext `minimumFontScale` to ~0.5 so a 6-digit monthly `consumed/target`
fits; reuse the single `formatPercent` (`999%+` cap). No visual change to the weekly rings.

### 2. Share the per-metric ratio logic in a neutral file (SF2)
New `src/features/dashboard/lib/plan-progress.ts` exports `planMetrics(consumed, goals, elapsed)` (the
four-metric `{ percent, consumed, target }` mapping via `guardedRatio(value, goal*elapsed)`) **and**
the `MetricProgress` type. `week-plan-progress.ts` imports `planMetrics` (keeps deriving its own
Saturday-based `elapsed`/`consumed`, then calls it) and re-exports/uses `MetricProgress`; the monthly
path imports from `plan-progress.ts`. One source of truth for "consumed ÷ (goal × elapsed)"; the
monthly path never imports "week…".

### 3. `useMonthlyTotals(tz)` — month-to-date consumed + elapsed
New hook mirroring `useWeeklyTotals`'s lifecycle (keyed `[userId, reloadKey]`, `mounted` ref,
strict `Pick<>` allowlist — `eaten_at,total_calories,total_protein,total_carbs,total_fat`, in-code
`.eq('user_id', userId)`, never `select('*')`, never logs a row/metric/tz):
- **Window:** fetch `eaten_at >= now − ~33 days` (tz-independent). The earliest instant still "this
  month" is the 1st at 00:00 local — at most `(elapsed−1)` days + a tz offset before now; with a
  max `elapsed` of 31 that's ≤ ~31 days, so ~33 days (with a cushion > the ≤14 h tz span) is
  provably enough. The window is tz-independent → never refetches on tz change.
- **Live boundary (0023):** `const todayKey = useCurrentDayKey(tz)`; derive `elapsed =
  Number(todayKey.slice(8,10))` (day-of-month, explicit slice — not a locale parse) and the month
  prefix `todayKey.slice(0,7)` (`YYYY-MM`). Bucket in a `useMemo([rows, tz, todayKey])`: sum
  `calories/protein/carbs/fat` over rows whose `makeDayFormatter(tz).format(eaten_at)` `startsWith`
  the current `YYYY-MM` (all logged rows are ≤ today because `eaten_at` is `now()`-defaulted +
  immutable — pin this in a comment; optionally add `&& formatted <= todayKey` as belt-and-suspenders
  for a future "edit meal time"). Fetch-effect deps stay `[userId, reloadKey]` (no midnight refetch —
  SF pattern from 0023).
- **SF5 (freshness + sign-out gating — copy, don't paraphrase):** the `Outcome` carries `userId` +
  `reloadKey`; derive `consumed` ONLY when the outcome matches the current `(userId, reloadKey)`
  (else zeroed/loading), exactly like `useWeeklyTotals`'s two-place guard. On `userId == null` return
  zeroed `consumed` + `loading:false` so sign-out clears the prior user's month-to-date.
- Returns `{ loading, error, refetch, consumed: { calories, protein, carbs, fat }, elapsed,
  mealCount }`. `elapsed` is ≥ 1 (day-of-month), so `goal × elapsed` is never 0.

### 4. Render both rings cards on the Trend screen — restructured so monthly always shows (B1)
`trend-screen.tsx`: call `useMonthlyTotals(tz)` + `useDailyGoals()` (already present); compute
`const monthly = planMetrics(monthTotals.consumed, goals, monthTotals.elapsed)`.
- **Restructure (B1):** keep the *profile* gates full-screen (`profileLoading`/weekly `loading`
  spinner; `profileError` Retry — tz is load-bearing for BOTH cards). Then render ONE `<Screen
  scroll>` whose body is:
  - the WEEKLY section — when `loggedDays.length === 0`, an INLINE "No meals in the last 7 days"
    card (NOT a full-screen return); else the bars card + the weekly `PlanRingsCard` + the weekly
    average card (the average stays only in the non-empty branch → no divide-by-zero).
  - the MONTHLY `PlanRingsCard` — rendered UNCONDITIONALLY after the weekly section (title "This
    month's plan · N day{s}", `subtitle` optional; `loading={monthlyLoading}`,
    `error={monthlyError}`, `goalsMissing={!goalsLoading && goals == null}`,
    `emptyNote` when `monthTotals.mealCount === 0`, else `metrics={monthly}`).
- **SF3:** `monthlyLoading`/`monthlyError` are passed ONLY to the monthly `PlanRingsCard` — NEVER
  added to the screen's top `if (profileLoading || loading)` / `if (error)` gates (a grep/review
  check enforces this).
- Weekly-*totals*-error (`if (error)`) may stay a full-screen Retry (rare genuine load failure);
  documented as acceptable — the B1 case is the common empty-week one.
- Add `refetchMonthly` to the screen's `useFocusEffect` (alongside `refetch`/`refetchGoals`).

## Files to change
- `src/features/dashboard/screens/metric-ring.tsx` — **new.** Extracted `MetricRing` +
  `ProgressRing` + `RING_SIZE`/`RING_THICKNESS`/`formatPercent` + the `rings`/`ringsLoading` card
  styles, PLUS the shared **`PlanRingsCard`** (SF1). `minimumFontScale` lowered to ~0.5 (SF4).
- `src/features/dashboard/lib/plan-progress.ts` — **new (SF2).** `planMetrics(consumed, goals,
  elapsed)` + `MetricProgress` type.
- `src/features/dashboard/lib/week-plan-progress.ts` — import `planMetrics`/`MetricProgress` from
  `plan-progress.ts`; keep the Saturday-based `elapsed`/`consumed` derivation, call `planMetrics`.
- `src/features/dashboard/lib/use-monthly-totals.tsx` — **new.** Month-to-date consumed + elapsed,
  mirroring `useWeeklyTotals` (wider window, live `todayKey`, strict `Pick<>` allowlist, explicit
  `(userId, reloadKey)` freshness gate + `userId==null → zeroed` per SF5).
- `src/features/dashboard/screens/trend-screen.tsx` — remove the now-extracted ring code + styles;
  restructure so both `PlanRingsCard`s render under one `<Screen>` with the weekly-empty state INLINE
  and the monthly card UNCONDITIONAL (B1); `useMonthlyTotals` + `refetchMonthly` on focus; keep
  monthly gates OUT of the top gate (SF3); import `MetricProgress` from `plan-progress.ts`.

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
1. **Empty-month copy** — RESOLVED (review): show **"No meals logged this month yet"** when
   `mealCount === 0` (the B1 fix surfaces the card to users with no recent meals, so this reads
   better than four 0% rings).
2. **Extraction home** — RESOLVED: `dashboard/screens/metric-ring.tsx` (dashboard-local, mirrors
   `meal-editor-form.tsx`).
3. **Window size** — RESOLVED: ~33 days (provably ≥ a 31-day month-to-date; endpoints share the tz
   so the offset doesn't add; +≤1h DST). Do not shrink.
4. **`useOwnedMealRows(windowMs)` follow-up** — daily/weekly/monthly now share ~80% fetch
   boilerplate; a shared owner-scoped rows core (bucketing per-hook) is the eventual DRY target.
   NOT built here (premature for one new caller); tracked as a follow-up.

---

## Review
_Balanced 4-lens review (correctness, architecture, edge, data/privacy), 2026-09-05. **One
BLOCKER** (edge + correctness, independently) + several should-fixes. All folded below._

### Verdict
**NEEDS CHANGES → RESOLVED → APPROVED.** One blocker: the weekly early-returns (esp. the all-7-empty
capture prompt) sit ABOVE the monthly card, hiding it in exactly the multi-week-gap case the monthly
view is for. Resolved by restructuring the screen so the monthly card always renders after the
profile gates. The month-to-date math, ~33-day window, rollover, `elapsed` (day-of-month, always
≥1 → no divide-by-zero), byte-identical `YYYY-MM` prefix match, and the `planMetrics` extraction were
all confirmed correct; `eaten_at` is `now()`-defaulted + immutable, so "all rows ≤ today" holds.

### BLOCKER (resolved)
- **B1 — The weekly empty/early-returns hide the monthly card.** `trend-screen.tsx` returns the
  full-screen "No meals in the last 7 days" prompt (and profile/totals error/loading) BEFORE any
  card renders; the monthly card as planned (in the returned JSX below the weekly rings) is
  unreachable for a user with month-to-date meals but a ≥7-day recent gap. **Resolution:** restructure
  so the monthly card is a sibling that renders regardless of `loggedDays.length`. Keep the *profile*
  gates full-screen (tz is load-bearing for BOTH cards); convert the **all-7-empty** branch to an
  INLINE weekly-only empty card inside the main `<Screen scroll>`, and render the monthly
  `PlanRingsCard` after it unconditionally. The weekly average card (which divides by
  `loggedDays.length`) stays only in the non-empty branch (no NaN). Weekly-*totals*-error may remain a
  full-screen Retry (rare, and it's a genuine weekly load failure) — documented, not the common case
  the blocker is about.

### SHOULD-FIX (folded in)
- **SF1 — Extract a shared `PlanRingsCard`, don't duplicate the gate JSX (architecture).** Both cards
  are `title + (goalsLoading spinner | goals==null hint | 4 MetricRings)`; monthly adds an error/empty
  slot. **Resolution:** a `PlanRingsCard({ title, subtitle, loading?, error?, goalsMissing, metrics,
  emptyNote? })` co-located with `metric-ring.tsx`, rendered for BOTH weekly and monthly; the
  card-layout styles (`rings`/`ringsLoading`) move into it with the ring styles. Weekly passes no
  `loading`/`error` (its gating is the screen structure); monthly passes its non-fatal ones.
- **SF2 — Put `planMetrics` + `MetricProgress` in a neutral `plan-progress.ts` (architecture).** Not
  `week-plan-progress.ts` — the monthly path importing "week…" re-couples the two views. **Resolution:**
  new `dashboard/lib/plan-progress.ts` exports `planMetrics(consumed, goals, elapsed)` +
  `MetricProgress`; `week-plan-progress.ts` and the monthly path both import it; update trend-screen's
  `MetricProgress` import.
- **SF3 — Monthly loading/error MUST stay out of the screen's top gate (edge).** If `monthlyLoading`/
  `monthlyError` leaked into `if (profileLoading || loading)` / `if (error)`, a slow/failing monthly
  fetch would blank/kill the whole screen (and spinner-flash on every focus, since `refetchMonthly`
  bumps its reload key). **Resolution:** handle them ONLY inside the monthly `PlanRingsCard`; add a
  review/grep check that `monthlyLoading`/`monthlyError` never appear in the two top-level gates.
- **SF4 — Ring subtext must fit MONTHLY magnitudes (edge).** The 0021 `ringSub`
  (`adjustsFontSizeToFit minimumFontScale={0.6}`) was tuned for ≤7-day sums; monthly `target =
  goal × elapsed` reaches ~31× daily (6-digit `consumed/target`), which can truncate. **Resolution:**
  in the extracted `MetricRing`, lower `minimumFontScale` to ~0.5 (helps both) and verify the longest
  realistic monthly string fits; reuse the SINGLE extracted `formatPercent` (`999%+` cap) — do not
  leave an uncapped copy.
- **SF5 — Spell out the freshness + sign-out gating in `useMonthlyTotals`, don't paraphrase (data).**
  **Resolution:** the `Outcome` carries `userId` + `reloadKey`; `consumed` is derived ONLY when the
  outcome matches the current `(userId, reloadKey)` (else zeroed/loading) — copy `useWeeklyTotals`'s
  exact two-place guard (row selection + returned status). On `userId == null` return zeroed
  `consumed` + `loading:false` so sign-out clears the prior user's month-to-date (don't hold it).

### NIT (addressed/noted)
- **Empty-month copy:** since the B1 fix surfaces the monthly card to users with no recent meals, show
  a friendly **"No meals logged this month yet"** when the monthly `mealCount === 0` (the hook already
  returns `mealCount`) instead of four 0% rings — resolves OQ1 that way. • **Belt-and-suspenders:** the
  bucket may add `formatted <= todayKey` (guards a future-dated row), not required today because
  `eaten_at` is `now()`-defaulted + immutable (initial_schema + the update RPC never sets it) — pin
  this invariant in a comment so a future "edit meal time" feature revisits it. • **Duplicate live-clock
  timers:** weekly + monthly each call `useCurrentDayKey(tz)` → two 60 s intervals + two AppState
  listeners on this screen; harmless — accept it (hoisting one `useCurrentDayKey` in the screen and
  passing `todayKey` into both hooks would change the shipped weekly hook's signature; not worth it). •
  **`useOwnedMealRows(windowMs)` follow-up:** daily/weekly/monthly now share ~80% fetch boilerplate; a
  shared owner-scoped rows core (bucketing stays per-hook) is the eventual DRY target — noted, NOT built
  now (generalizing three tz/DST/compiler-hardened hooks for one new caller is premature). • Parse
  `elapsed` via `Number(todayKey.slice(8,10))` and the prefix via `todayKey.slice(0,7)` (explicit
  slices, not a locale parse). • Confirm `formatPercent`/`RING_SIZE`/`RING_THICKNESS` have no users
  outside the ring components before moving (verified: only within `MetricRing`/`ProgressRing`/styles).

### Confirmed correct (no change)
`elapsed = day-of-month of todayKey` (inclusive, ≥1); month-to-date = rows whose tz-date
`startsWith(YYYY-MM)` (all rows ≤ today via `now()`/immutable `eaten_at`); ~33-day window provably
covers a 31-day month-to-date (endpoints share the tz so the offset doesn't add; +≤1h DST); rollover
re-buckets via `todayKey` with no refetch (0023 pattern); `planMetrics` extraction is behavior-
preserving for weekly (guards stay upstream; only the 4-metric mapping moves); React-Compiler-safe if
it mirrors 0023 (memo `[rows, tz, todayKey]`, ref read only in the `.then`); NaN-guarded via
`guardedRatio` (+ `elapsed ≥ 1`); year is in the prefix (no same-month-last-year bleed); lighter
monthly hook (sum + elapsed, no per-day buckets) is a genuine simplification; same-screen (not a new
route) + dashboard-local ring are consistent with 0021.

## Execution log
<!-- Filled during execution. -->
