# Plan: Daily/weekly "today" rolls over at midnight (and on resume) without a refetch

- **Status**: **Draft** → In Review → Approved → In Progress → Done
- **Plan #**: 0023
- **Created**: 2026-09-02

## Problem / Goal
"Today" is frozen. In `use-daily-totals.tsx` and `use-weekly-totals.tsx`, the "today" string is
computed with `new Date()` **inside** a `useMemo(…, [rows, tz])` — but `new Date()` is not a
dependency, so once the memo runs it caches that day until `rows` or `tz` change (i.e. a refetch).
`useFocusEffect` refetches on **navigation** focus, but NOT when the app returns from background or
is simply left open on the screen across midnight. So a user who logs meals in the evening and
reopens the app after midnight still sees yesterday's meals as "today" (the 0022 fix put the
boundary at true local midnight — a higher-traffic "app left open / reopened" hour — which raised
this bug's visibility; it's the documented 0022 follow-up).

**"Done" =** with the app open (or resumed from background) across local midnight, the daily
dashboard and the weekly trend re-bucket to the new day **on their own** — yesterday's meals drop
out of "today", the weekly "isToday" highlight + Saturday-first window advance — within ~a minute
of midnight and immediately on foreground, WITHOUT the user navigating away and back, and WITHOUT a
network refetch (the existing rows already cover the roll). `tsc`/`lint`/web-bundle green; user
verifies. Pure client — no migration, no new dependency, no schema change.

## Non-goals
- **No data-freshness change.** This only re-buckets the ALREADY-fetched rows across the day
  boundary; it does not add a refetch. The 48 h (daily) / 8-day (weekly) windows already contain
  yesterday's + today's rows, so a single midnight roll needs no new fetch. (Refetch-on-foreground
  for long-open sessions is a possible add — OQ1 — not core.)
- **No new timer library / no background task.** A lightweight in-component interval + an
  `AppState` listener, both torn down on unmount. Nothing runs while unmounted.
- **No change to the tz resolution (0022)** or the bucketing math (`makeDayFormatter`, noon-UTC
  seed). We only make the "today" reference reactive.
- **No History-screen change.** History lists meals by their own dates; it doesn't have a frozen
  "today" aggregate. Scope is the two totals hooks.

## Proposed approach
### 1. A shared reactive "current day key" hook (lint-safe under React Compiler)
New `useCurrentDayKey(tz: string): string` (dashboard lib, next to `makeDayFormatter`):
- **Compute the day key during render** — `makeDayFormatter(tz).format(new Date())` — so it's always
  current at render time. (Reuses the exact same formatter the buckets use, so the key is
  byte-identical to the bucket strings — same `en-CA` `YYYY-MM-DD`.)
- A `useReducer`-based `tick` (force-re-render) driven by an `effect` that ONLY registers a
  `setInterval` (~60 s) and an `AppState` `'active'` listener, returning a cleanup that clears both.
  The effect body sets up listeners only — it does NOT call `setState` synchronously, so it does
  not trip `react-hooks/set-state-in-effect` (the rule that bit 0019); the tick fires from the
  interval/AppState callbacks, and the day key is re-derived in the ensuing render.
- Net: the key updates on foreground (immediately) and at most ~60 s after midnight while open.
  It changes value only when the day actually flips, so a re-render with an unchanged key is inert
  downstream (the memos below are keyed on the string).

### 2. Feed the reactive day key into both totals hooks
- `use-daily-totals.tsx`: `const todayKey = useCurrentDayKey(tz);` In the bucket memo, use
  `todayKey` in place of `fmt.format(new Date())`, and **add `todayKey` to the memo deps**
  (`[rows, tz, todayKey]`). `fmt` is still built for bucketing each row; only the "today"
  comparison switches to the reactive key. When the key flips, the memo re-buckets the existing
  rows → today's totals become the new day's (0 until a meal is logged), no refetch.
- `use-weekly-totals.tsx`: same — the 7-day window is seeded from "today". Replace the in-memo
  `fmt.format(new Date())` seed with `todayKey`, add it to the memo deps. The Saturday-first order
  + `isToday` flag (0021) then advance correctly when the day rolls.

## Files to change
- `src/features/dashboard/lib/use-current-day-key.tsx` — **new.** `useCurrentDayKey(tz)`:
  render-computed day key + interval + `AppState` `'active'` tick; lint-safe (no setState in the
  effect body).
- `src/features/dashboard/lib/use-daily-totals.tsx` — consume `todayKey`; use it as "today" in the
  memo; add to deps.
- `src/features/dashboard/lib/use-weekly-totals.tsx` — consume `todayKey`; use it as the seed;
  add to deps.

## Data model / schema impact
**None.** Pure client, no fetch change, no migration, no new dependency (`AppState`/`useReducer`
are RN/React built-ins).

## Edge cases & failure modes
- **App left FOREGROUND across midnight** → the ~60 s interval re-renders; the key flips; memos
  re-bucket. Worst-case lag ≤ interval.
- **App resumed from BACKGROUND after midnight** (the user's exact case) → `AppState` `'active'`
  ticks immediately on foreground → re-bucket at once.
- **Interval while backgrounded** → JS timers are throttled/paused in the background (OS-dependent);
  that's fine — the `AppState` `'active'` tick covers the resume, so we don't rely on the timer
  firing while backgrounded.
- **Rows too old after a very long open session** → re-bucket uses already-fetched rows; across a
  single midnight the 48 h/8-day window still contains yesterday's rows, so the roll is correct. A
  multi-day-open session could show a stale window until the next focus refetch — acceptable
  (OQ1 covers an optional foreground refetch).
- **tz arrives late / changes** → `useCurrentDayKey` recomputes on the next render (tz is read in
  render); the memos already depend on `tz` too.
- **DST / invalid tz / Hermes-ICU** → unchanged; the key uses the same `makeDayFormatter` path, so
  it inherits the existing behavior (and stays consistent with the row buckets).
- **Key doesn't actually change** (same day) → the reducer still re-renders every ~60 s, but the
  memo's string dep is unchanged → no re-bucket work, no visible churn. Cheap.
- **Both screens mounted** → each totals hook runs its own timer; negligible. (Could hoist to one
  shared hook later; not needed.)
- **Unmount** → interval cleared + `AppState` subscription removed in the effect cleanup; no leak,
  no setState-after-unmount (the tick only fires while mounted).

## Test / verify plan
- `npx tsc --noEmit` PASS; `npx expo lint` clean (watch the `react-hooks/set-state-in-effect` /
  `react-hooks/refs` rules — the whole design is shaped to avoid them); web bundle / full `expo
  export` (trend is code-split) green.
- **Manual — the real repro:**
  1. Log a meal in the evening; leave the dashboard open (or background the app). After local
     midnight, bring it to foreground (or wait ≤1 min if left open) → "today" resets to 0, the
     evening meal is gone from today. (Before: it lingered until a navigate-away-and-back.)
  2. Weekly trend across midnight → the Saturday-first window + `isToday` highlight advance a day.
  3. Fake-clock check (web): set the OS clock just before midnight, open the app, cross midnight →
     watch it roll within the interval without touching the app.
  4. Regression: normal same-day logging still updates on focus (0021/0022 unaffected); no extra
     network requests fire on the roll (rebucket-only).
- **Grep gate:** no metric/tz/day logged; no `select('*')`; the hook adds no fetch.

## Rollout
Pure client, no migration/deploy/secret. Land on `main`; `tsc`/`lint`/bundle; user verifies the
midnight roll. Journal + mark Done + commit & push.

## Open questions
1. **Also refetch on foreground?** For a session left open for DAYS, re-bucket alone can't surface
   rows logged on another device meanwhile. Adding an `AppState` `'active'` → `refetch()` in the
   two screens (mirroring `useFocusEffect`) would fix freshness too, at the cost of a network call
   per foreground. Proposed: keep core as rebucket-only (fixes the reported bug); add
   foreground-refetch only if wanted. Decide in review.
2. **Interval length** — 60 s proposed (≤1 min lag past midnight, negligible cost). Shorter/longer?
3. **Hoist the timer** to one app-level `useCurrentDayKey` shared via context vs. per-hook — per-hook
   is simpler and the screens rarely coexist; proposed per-hook. OK?

---

## Review
<!-- Filled by /review-plan. -->

## Execution log
<!-- Filled during execution. -->
