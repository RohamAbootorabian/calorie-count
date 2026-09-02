# Plan: Daily/weekly "today" rolls over at midnight (and on resume) without a refetch

- **Status**: ~~Draft~~ → ~~In Review~~ → **Approved** → In Progress → Done
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
### 1. A shared reactive "current day key" hook (React-Compiler- and lint-safe)
New `useCurrentDayKey(tz: string): string` (dashboard lib, next to `makeDayFormatter`). File header
carries the no-log discipline (SF4): "never log the tz or the day key — static strings only."

```
const [tick, bump] = useReducer((n: number) => n + 1, 0);
// B1: `tick` MUST be a real dep so React Compiler can't freeze the key on [tz] alone.
const todayKey = useMemo(() => makeDayFormatter(tz).format(new Date()), [tz, tick]);
useEffect(() => {
  const id = setInterval(bump, 60_000);                        // OQ2: ~60 s
  const sub = AppState.addEventListener('change', (next) => {  // SF2: gate on 'active'
    if (next === 'active') bump();
  });
  return () => { clearInterval(id); sub.remove(); };           // SF1: EmitterSubscription.remove()
}, []);
return todayKey;
```

- **B1 (blocker fix):** the key is a `useMemo` keyed on `[tz, tick]`, NOT a bare render expression.
  Under React Compiler a render-computed `new Date()` would be memoized on `[tz]` and never advance
  on a tick; threading `tick` as a genuine dep forces a fresh `new Date()` each fire. `tz` in the
  deps keeps late-tz reactivity (a `useState`-seeded key would need a `setState`-in-effect to
  re-sync on tz — the 0019 lint trap — so the `useMemo` form is chosen). Reuses the exact
  bucket formatter, so the key is byte-identical to the row bucket strings (`en-CA` `YYYY-MM-DD`).
- **Lint-safe:** the effect body only registers the interval + AppState listener and returns a
  cleanup; `bump` fires from the interval/AppState CALLBACKS, never synchronously in the effect body
  → no `react-hooks/set-state-in-effect`; no ref reads in render → no `react-hooks/refs`.
- **SF1 cleanup:** `AppState.addEventListener` returns an `EmitterSubscription`; cleanup calls
  `sub.remove()` (RN 0.85 has no static `removeEventListener` → it would throw on unmount).
- **SF2 gate:** only `state === 'active'` bumps (`'change'` also fires on iOS `inactive`, constantly).
- Net: updates immediately on foreground and ≤~60 s after midnight while left open. A tick on an
  unchanged day re-derives the same string → the string-keyed memos below don't rebucket, and the
  compiler-memoized `displayDays`/`weekPlanProgress` stay inert (no flicker; pure Views). Cheap.

### 2. Feed the reactive day key into both totals hooks
- `use-daily-totals.tsx`: `const todayKey = useCurrentDayKey(tz);` In the bucket memo, use
  `todayKey` in place of `fmt.format(new Date())`, and **add `todayKey` to the BUCKET memo deps
  only** (`[rows, tz, todayKey]`). **SF3: do NOT touch the fetch effect's deps** — they stay exactly
  `[userId, reloadKey]`, so the day flip re-buckets in memory and never triggers a refetch. `fmt` is
  still built for bucketing each row; only the "today" comparison switches to the reactive key.
- `use-weekly-totals.tsx`: same — the 7-day window is seeded from "today". Replace the in-memo
  `fmt.format(new Date())` seed with `todayKey`, add it to the BUCKET memo deps (fetch effect deps
  unchanged, SF3). The Saturday-first order + `isToday` flag (0021) advance correctly when the day
  rolls.

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
1. **Also refetch on foreground?** — RESOLVED (review): **no, deferred.** Rebucket-only fully fixes
   the reported bug at zero network cost; the residual multi-device stale-window class is a rare
   follow-up. If ever adopted, the `AppState`-`'active'`→`refetch()` must be bounded (day-flip-only /
   debounced, null-`userId` early return) to avoid a request storm.
2. **Interval length** — 60 s (≤1 min lag past midnight, negligible cost). Settled.
3. **Hoist the timer** to one shared/context instance vs. per-hook — per-hook (2 cheap
   timers/listeners < the machinery of a context for 2 consumers). Settled. (Note: both totals hooks
   DO run simultaneously when trend is pushed over the tabs — still fine.)

---

## Review
_Balanced 4-lens review (correctness, architecture, edge, data/privacy), 2026-09-02. **One
BLOCKER** (found independently by correctness AND edge) + should-fixes. All folded below._

### Verdict
**NEEDS CHANGES → RESOLVED → APPROVED.** One blocker: under React Compiler (confirmed
`app.json` `experiments.reactCompiler: true`) the render-computed day key would be memoized on
`[tz]` and the tick couldn't advance it — the fix would silently no-op. Resolved by threading the
tick into the key's `useMemo` deps. With that + the AppState-cleanup/gating should-fixes, the
design is correct: the window/rebucket math was confirmed sound (no refetch needed for a single
midnight, no pre-midnight data loss), and the AppState listener is genuinely required (`useFocusEffect`
does not fire on background→foreground resume).

### BLOCKER (resolved)
- **B1 — React Compiler freezes a render-computed `new Date()` key; the fix no-ops.** Computing
  `makeDayFormatter(tz).format(new Date())` in render is memoized by the compiler on its only
  reactive input `tz`; a `tick` re-render returns the cached string, so `todayKey` stays frozen
  exactly like the original bug (and adding a frozen value to the memo deps changes nothing).
  **Resolution:** the tick MUST be a genuine dependency of the key derivation —
  `const todayKey = useMemo(() => makeDayFormatter(tz).format(new Date()), [tz, tick])`, where
  `tick` is a `useReducer` counter bumped from the interval + the AppState `'active'` callback.
  `tz` in the deps keeps late-tz reactivity; `tick` forces a fresh `new Date()` read each fire.
  (Even if the compiler bails on the impure `useMemo` body, it recomputes every render → fresh,
  never frozen — so `[tz, tick]` is safe under every compiler behavior.) A `useState`-seeded-once
  key was rejected: re-syncing it on a tz change needs a `setState`-in-effect (the `set-state-in-effect`
  rule that bit 0019), which the `useMemo` form sidesteps.

### SHOULD-FIX (folded in)
- **SF1 — AppState cleanup is `subscription.remove()`, not `AppState.removeEventListener` (edge).**
  RN 0.85 removed the static remover (gone since 0.72); `AppState.addEventListener('change', fn)`
  returns an `EmitterSubscription` — the effect cleanup calls `sub.remove()`. Using the old static
  API throws on every unmount (red screen). Pinned in §1 since AppState is new to this codebase.
- **SF2 — Gate the handler on `state === 'active'` (edge).** `'change'` fires for
  `active`/`inactive`/`background`; iOS `inactive` fires constantly (app-switcher peek, control
  center, permission/Face-ID sheets, calls). The handler must `if (next === 'active') bump()` — not
  tick on every transition.
- **SF3 — `todayKey` goes ONLY in the bucket `useMemo` deps, NEVER the fetch effect's deps (data).**
  Keep the fetch effect keyed exactly `[userId, reloadKey]`. If `todayKey` leaked into the fetch
  deps, the midnight flip would fire a real (nightly) refetch — breaking the "no-new-fetch"
  guarantee. Execution + grep gate assert the fetch-effect dep arrays are unchanged.
- **SF4 — No-log discipline on the new file (data).** `use-current-day-key.tsx` header states
  "never log the tz or the day key — static strings only"; ship with zero `console.*`; the grep
  gate includes the new file.

### NIT (addressed/noted)
- **OQ1 (foreground refetch) — RESOLVED: deferred, core stays rebucket-only.** Rebucket fully fixes
  the reported single-midnight bug with zero network cost (data + architecture lenses concur); the
  residual "session open across midnight can't populate the new leading day with rows logged
  meanwhile on another device" is a separate staleness class (rare for this single-user app). If
  ever adopted, an AppState-`'active'`→`refetch()` must be BOUNDED (fire only on an actual day flip
  / debounce; early-return on null `userId`) to avoid a request storm on rapid app-switching — noted
  for the follow-up, not built now. • **OQ3 rationale corrected:** `trend` is pushed as a root
  `Stack.Screen` OVER the tabs, so the dashboard stays mounted underneath — both totals hooks (and
  their timers/listeners) ARE live simultaneously while trend is open. Per-hook is still right (2
  cheap timers < the machinery of a shared context for 2 consumers), just not for a "rarely coexist"
  reason. • The ~60 s tick that doesn't change the day re-renders the hook but the day-string memo
  dep is unchanged → no rebucket, and the compiler auto-memoizes `displayDays`/`weekPlanProgress` on
  `[days, goals]` downstream → inert (pure Views, no flicker). Cheap. • One-frame stale flash is
  possible on foreground before the tick lands — self-correcting within a render; don't claim
  paint-synchronous. • Evening-meal-logged-while-open freshness gap is pre-existing (in-app logging
  routes through Capture → focus refetch) and OQ1-scoped — not a new hole. • Optionally skip
  starting the interval while signed out (the totals memos already early-return on `!userId`) —
  minor. • Manual clock jump / DST@02:00 / tz-travel all handled (picked up within one interval; the
  date key is DST-safe via `makeDayFormatter`; a tick now also re-picks-up device-tz travel — a free
  bonus).

### Confirmed correct (no change)
Rebucket-only across a single midnight is sound for BOTH windows: the fetch always happens during
pre-midnight day D, so after the roll today's bucket is correctly 0 and every day the weekly view
needs (D+1 back to D−5) is inside the fetched D−7→D range; yesterday (D) is fully covered — no
refetch needed, no pre-midnight data loss (a today-meal stays until midnight then drops; it never
vanishes early). The noon-UTC seed reconstruction is byte-identical from `todayKey` (same
formatter). `todayKey` in memo deps is value-stable (string `Object.is`). AppState is genuinely
required (focus ≠ resume). Interval AND AppState both needed (background timers are throttled, so
the interval can't cover resume; AppState can't cover foreground-left-open). No fetch race (the
tick never touches the fetch effect or `mounted`/`active` guards).

## Execution log
<!-- Filled during execution. -->
