# Plan: Daily totals dashboard (Home tab)

- **Status**: ~~Draft~~ → ~~In Review~~ → ~~Approved~~ → ~~In Progress~~ → **Done** (user web-verified 2026-06-24)
- **Created**: 2026-06-24
- **Plan #**: 0014

## Problem / Goal
The **Home tab** (`src/app/(app)/index.tsx`) is still the **Expo starter** screen
("Welcome to Expo", dev-menu hints) — the app's landing surface shows nothing about
the user's day. Meanwhile we already store everything needed: per-meal totals in
`meal_logs` (`total_calories/protein/carbs/fat`, `eaten_at`) and per-user daily
**targets** in `goals` (`calories/protein/carbs/fat`, set at onboarding / editable
in Settings).

**Goal:** replace the starter Home screen with a **daily dashboard** that shows
**today's** consumed calories + macros (protein/carbs/fat) aggregated from
`meal_logs`, against the user's `goals`, with a simple progress read (consumed /
goal / remaining). "Today" is bounded by the user's **timezone** (`profiles.timezone`),
not UTC. "Done" = Home shows today's calories (consumed vs goal + remaining) and the
three macros vs their goals; it updates when you return to the tab after logging a
meal; it degrades gracefully when there are no meals today or no goals row;
`tsc` + `lint` green; user web-verifies.

This is the app's **first aggregate-read surface** (History was the first row-read);
the `useDailyTotals` + tz-bucketing pattern is reusable by a future weekly view.

## Non-goals
- **No weekly / historical charts or trends** — today only. (A "this week" view is a
  later plan.)
- **No quality nutrients on the dashboard** (sugar/salt/fiber) and **no quality
  score** — calories + P/C/F only this pass. (`meal_logs` has them; out of scope.)
- **No goal editing here** — Settings already owns the `goals` editor; the dashboard
  is read-only.
- **No new "today's meals" list** — that's History's job; the dashboard shows
  *totals*, optionally a meal count, not rows.
- **No realtime subscription** — refetch on tab focus is enough (see approach).
- **No DB migration / RPC** — aggregation is done client-side over a bounded fetch
  (see "Why no RPC").
- **No timezone picker / DST library** — we use `Intl` with the stored IANA tz; no
  `date-fns-tz`/`luxon` dependency.

## Proposed approach
**One fetch-and-sum hook + one read of `goals` + a dashboard screen; Home becomes a
thin re-export (mirrors `history.tsx`). No backend work.**

### 1. `useDailyGoals()` — `src/features/dashboard/lib/use-daily-goals.tsx` (dashboard-local, NARROW)
**Changed from the first draft (review BLOCKER — data #1 + arch).** Do **NOT** extract
Settings' `useGoalsRow` and do **NOT** reuse it: that hook does `select('*')`, which
pulls the user's **body PII** (`age/sex/height_cm/weight_kg/activity_level/weight_goal`)
that Settings legitimately edits but the **Home landing surface renders none of**.
Sharing it would widen health-PII exposure on the first screen AND risk regressing
Settings' one-shot-no-refetch contract.

Instead, a **dashboard-scoped reader** that selects ONLY the four target columns:
- `select('calories, protein, carbs, fat')` paired with a `Pick<GoalsRow, 'calories'
  | 'protein' | 'carbs' | 'fat'>` type (one `SELECT_COLUMNS` const + matching `Pick<>`,
  a "keep in sync" comment — mirrors `useMealHistory`'s compile-time allowlist so
  over-fetch can't silently creep in). The select string must contain **none** of
  `age|sex|height_cm|weight_kg|activity_level|weight_goal`.
- `.eq('user_id', userId).maybeSingle()` — **mandatory in-code owner filter** retained
  (defense-in-depth, not just RLS). `mounted`/`active` guards keyed to `(userId,
  reloadKey)`. Returns `{ loading, goals: <Pick> | null, error, refetch }` — **exposes
  `refetch`** so editing goals in Settings → returning to Home reflects the new target
  (refetched on focus alongside totals; see §3).
- Settings is **left untouched** (zero regression risk).

### 2. `useDailyTotals(tz)` — `src/features/dashboard/lib/use-daily-totals.tsx`
Fetch the last 48 h of meals (tz-independent) and bucket+sum to "today" as a
**reactive function of `tz`**. **tz is a PARAMETER, not read internally** (review
BLOCKER edge #1 + arch): the screen owns the single `useProfile()` and passes the
**resolved** tz down — this (a) kills a second profile fetch, (b) makes the hook
pure/testable, and (c) lets the bucket recompute when tz arrives.

- **Bounded fetch (tz-independent, so it never needs to refetch on tz change):**
  `.eq('user_id', userId)` (mandatory in-code owner filter) + `.gte('eaten_at',
  new Date(Date.now() − 48*3600*1000).toISOString())` (exact call — `.toISOString()`
  yields a `Z`/UTC string PostgREST compares unambiguously against the `timestamptz`).
  Select a strict `Pick<>` allowlist — one `SELECT_COLUMNS` const + matching type
  (`eaten_at, total_calories, total_protein, total_carbs, total_fat`); **none of**
  `confidence|quality_factors|assumptions|verified|dish_name|image_path`. Uses the
  existing `meal_logs_user_eaten_idx`. **Why 48 h is provably enough:** a calendar day
  is ≤25 h (DST) and tz offsets span ≤14 h, so the oldest instant that can still be
  "today" somewhere is ~39 h before now — 48 h covers it with margin.
- **Bucket+sum in a `useMemo` keyed on `(rawRows, tz)`** — NOT at fetch time. This is
  the fix for the ordering bug: the 48 h rows are fetched once (keyed to `(userId,
  reloadKey)`), but "which of them are *today*" is recomputed whenever `tz` changes,
  so a late-arriving `profile.timezone` re-buckets the already-fetched rows with **no
  refetch and no stale totals**.
  - Build **one** formatter, inside a try/catch at **construction**:
    `new Intl.DateTimeFormat('en-CA', { timeZone: tz, year:'numeric', month:'2-digit',
    day:'2-digit' })`. An invalid IANA string throws a `RangeError` at construction →
    fall back (caller already resolved tz → device → `'UTC'`, but guard here too so a
    bad zone never crashes the Home landing surface). **Locale is hardcoded `'en-CA'`**
    (→ `YYYY-MM-DD`) and must NEVER fall back to the device/Persian locale (would break
    string-equality and emit non-Latin digits).
  - `todayStr = fmt.format(new Date())`; a meal is today iff
    `fmt.format(new Date(eaten_at)) === todayStr`. Same-formatter date-string compare
    sidesteps all offset/DST math.
  - Sum `total_*` over the today bucket → `{ calories, protein, carbs, fat, mealCount }`.
  - ⚠️ **Native caveat (deferred iPhone pass):** on Hermes without full-ICU, the
    `timeZone` option can be **silently ignored** (no throw → the catch won't fire),
    bucketing by device-local instead of `tz`. Web has full Intl, so web-verify is
    valid; the native pass MUST confirm `timeZone` is honored (a wrong-but-silent
    bucket, not a crash). Documented in Edge cases.
- **Lifecycle:** `mounted` ref + per-attempt `active` flag, fetch outcome keyed to
  `(userId, reloadKey)` (verbatim from `useMealHistory`). Expose `{ loading, totals,
  error, refetch }` where `totals` is the memoized bucket.
- **PII:** never log a row, a metric, the tz, or the Postgrest error object — a static
  structural string only (e.g. `'daily-totals: fetch-error'`).

### 3. Dashboard screen — `src/features/dashboard/screens/dashboard-screen.tsx`
- Consumes `useProfile()` (single instance — for tz + greeting name), resolves the
  tz **in the screen** (`profile?.timezone?.trim() || getDeviceTimezone() || 'UTC'`),
  and passes it into `useDailyTotals(tz)`; also `useDailyGoals()`.
  - **`getDeviceTimezone` import:** resolve the fallback in the **screen** (which
    already depends on `auth` via `useProfile`), so `dashboard/lib` doesn't reach into
    `auth/lib`. (If it ever needs sharing, relocate the helper to `src/lib/` — out of
    scope here.)
- **Gate order (define precedence so 3 independent errors can't make a confusing
  partial screen):** `profileLoading || totalsLoading → spinner`; then **profile
  error** (no tz → don't show confident wrong totals) → Retry; then **totals error**
  → Retry; goals error is non-fatal → render totals, treat as "no goals." Overall
  `loading = profileLoading || totalsLoading`.
- **One shared guarded helper (review BLOCKER — correctness #6):** define a single
  pure `progressFor(consumed, goal): { fraction: number; remaining: number; over:
  number; hasGoal: boolean }` used by **all four** metrics (calories + P/C/F):
  `hasGoal = goal > 0` (covers 0/negative/NaN); `fraction = hasGoal ?
  Math.min(consumed/goal, 1) : 0`; `remaining = hasGoal ? Math.max(goal − consumed,
  0) : 0`; `over = hasGoal ? Math.max(consumed − goal, 0) : 0`. No metric divides
  inline — prevents `Infinity`/`NaN` bar widths when any goal is 0/missing.
- **Calories:** primary card — "1,240 / 2,100 kcal" + remaining ("860 left") + a bar
  (`fraction`); over-goal → 100% bar + "over by N". If `!hasGoal`, show just consumed
  ("1,240 kcal today") + the Settings hint (no "/ 0").
- **Macros:** three compact bars — Protein / Carbs / Fat — each "consumed / goal g"
  via the same helper.
- **Empty/edge precedence:** no meals today → zeros + "No meals logged today — snap one
  from Capture." No goals → "Set your goals in Settings" hint instead of progress.
  Both true (new user) → show the **no-meals** line as the primary empty state plus the
  goals hint (don't render a confusing all-zero progress UI).
- **Refresh on focus:** `useFocusEffect(useCallback(() => { if (userId) { refetch();
  refetchGoals(); } }, [userId, refetch, refetchGoals]))` — both `refetch`s are
  `useCallback`-stable (`setReloadKey((k) => k+1)`), so no render storm; reads
  `userId` at call time. Focus also fires on first mount → one redundant-but-cheap
  bounded query (harmless, note it). Keep a manual header Refresh button (web), like
  History.
- Reuse `Card`, `Text`, theme tokens (`Spacing`, `Radius`, `Colors`); the bar is two
  stacked `View`s (track + `{ width: \`${fraction*100}%\` }` fill) — no new dep.
- **Number formatting:** round for display; for calorie thousands-separators pass an
  **explicit** locale to `toLocaleString` — decide `'en-US'` (Latin digits) vs the
  user's Persian locale (Eastern-Arabic digits) intentionally (see Open questions).

### 4. Wire Home → dashboard
- `src/app/(app)/index.tsx` becomes a **thin re-export**:
  `export { default } from '@/features/dashboard/screens/dashboard-screen';`
  (exactly like `history.tsx`). Deletes all starter content.
- Tab label stays **"Home"** (`app-tabs.tsx` `name="index"` → "Home"); no route/tab
  change, so no `app-tabs.web.tsx` edit needed (unlike 0012). **Verify** both tab
  files still only reference `index` (no label/href change required).

## Files to change
- `src/features/dashboard/lib/use-daily-goals.tsx` — **new.** Dashboard-scoped goals
  reader, NARROW `Pick<>` (4 target columns only), `.eq('user_id')`, `refetch`.
- `src/features/dashboard/lib/use-daily-totals.tsx` — **new.** Bounded 48 h fetch +
  `useMemo(rows, tz)` bucket + sum; tz as a param.
- `src/features/dashboard/screens/dashboard-screen.tsx` — **new.** The dashboard UI;
  owns the single `useProfile()`, resolves tz, holds the `progressFor` helper + bars.
- `src/app/(app)/index.tsx` — replace starter content with the thin re-export
  (`export { default } from '@/features/dashboard/screens/dashboard-screen';`).
- **NOT changing** `settings-screen.tsx` (no `useGoalsRow` extraction — review).
- **No `today.ts`** — the bucket is ~3 lines inside `useDailyTotals`'s `useMemo`;
  `progressFor` lives in the screen module. (Extract later only if a weekly view
  actually needs them + a unit test.)

## Data model / schema impact
**None.** `meal_logs` (`total_*`, `eaten_at`, `user_id`) and `goals`
(`calories/protein/carbs/fat`, `user_id`) already exist with **verified** owner-scoped
RLS SELECT: `meal_logs_select` (`auth.uid() = user_id`,
`20260619102510_initial_schema.sql:171`) and `goals_select` (`auth.uid() = user_id`,
same file `:157`); index `meal_logs_user_eaten_idx (user_id, eaten_at desc)` (`:76`)
backs the bounded read. `profiles.timezone` already exists (`NOT NULL string`). No
migration, no RPC, no policy change.

**Why no RPC / DB aggregate:** a Postgres `sum(...) where date_trunc('day', eaten_at
at time zone tz) = …` would be elegant but needs a migration + a `Functions` entry +
RLS reasoning. For a single user's ~1 day of meals the client sum over a 48 h
bounded read is trivial and keeps this a pure-client change. Revisit only if a user
can accumulate enough daily meals that the bounded read is large (it can't,
realistically). Noted in Open questions.

## Edge cases & failure modes
- **tz not ready while profile loads (BLOCKER, fixed):** `useProfile` first renders
  `{loading, profile:null}`, then re-renders with tz. Because tz is a **param** and the
  bucket is a `useMemo(rows, tz)`, the late tz **re-buckets** the fetched rows with no
  refetch. The screen also gates `loading = profileLoading || totalsLoading`, so no
  totals render under a fallback tz before the real one arrives.
- **No `goals` row** (e.g. legacy/edge): show totals, hide progress, "Set goals in
  Settings" hint — never divide by a missing/zero goal.
- **Goal value 0 / negative / NaN:** `progressFor` treats `goal > 0` as the only
  "has target" case → no divide-by-zero / Infinity for any metric incl. calories.
- **`profile.timezone` blank string `''`** (it's `NOT NULL string`, so blank is the
  realistic empty — guard `!tz.trim()`, not just `== null`): fall back to
  `getDeviceTimezone()` → `'UTC'`. Invalid stored tz → `Intl.DateTimeFormat` throws a
  `RangeError` at **construction** → caught, fall back (never crash the Home landing).
- **Native Hermes silent-ignore of `timeZone`:** can bucket by device-local without
  throwing (catch won't fire) → wrong "today" silently. Web is unaffected; the
  deferred iPhone pass must verify `timeZone` is honored.
- **Meal `eaten_at` in the future (clock skew):** no `.lte` upper bound; a future-but-
  still-today-local row counts (fine); a row dated *tomorrow* local is naturally
  excluded by the date-string compare — intended, not a bug (note during verify).
- **No meals today / empty history:** zeros + Capture hint; bars at 0%.
- **Meal `eaten_at` near midnight / DST transition:** handled by same-formatter
  date-string compare (no offset math) — a meal at 11:50 PM local counts today, one
  at 12:10 AM counts tomorrow, regardless of DST.
- **Over goal:** bar clamps to 100%; show "over by N" — remaining never negative.
- **Offline / fetch error:** error gate with Retry (don't assume a shape); the tz
  bucket still works on cached… (no cache here — just show Retry).
- **Sign-out mid-fetch / tab blur during fetch:** `mounted`/`active` guards drop late
  setState (verbatim from `useProfile`).
- **`useFocusEffect` refetch storms:** refetch on focus only (not on every render);
  the effect's callback is stable; a fast tab-toggle just re-runs a cheap bounded
  query. Don't refetch if `!userId`.
- **Large same-day count:** 48 h read is still bounded; client sum is O(n) over a
  realistically tiny n.
- **Number formatting:** round for display; use `toLocaleString()` for thousands
  separators on calories; guard `NaN` from a bad row (shouldn't happen — columns are
  `not null`).

## Test / verify plan
- `npx tsc --noEmit` — PASS. `npx expo lint` — clean.
- Web bundle compiles (HTTP 200) on `npx expo start --web --port 8081`.
- **Manual (web, logged in):**
  1. Home shows today's calories (consumed / goal / remaining) + P/C/F vs goals.
  2. Log a meal via Capture → return to Home → totals increase (focus refetch).
  3. A day with no meals → zeros + "No meals logged today" (no crash, no NaN).
  4. (If feasible) temporarily blank the profile tz → still renders (device/UTC
     fallback); a meal logged "today" still counts.
  5. Over-goal case (or a low goal) → bar clamps, "over by N" shows, no negative; a
     goal of 0 → no "/ 0", no NaN bar.
  6. Edit a goal in Settings → return to Home → the target updates (focus refetch).
  7. **Grep gate (PII/over-fetch):** the two new selects contain none of
     `confidence|quality_factors|assumptions|verified|dish_name|image_path` (totals)
     or `age|sex|height_cm|weight_kg|activity_level|weight_goal` (goals); no
     `console.*` logs a metric/tz/row.
- **Sanity:** confirm the today-bucket matches History — the meals counted today on
  the dashboard are exactly the History rows whose time is today in the same tz.
- DST is handled by construction (same-formatter compare); no manual DST step (not
  web-testable). Native tz-honoring rides the deferred iPhone pass.

## Rollout
Pure client change. No migration/secret/Edge deploy. Order: land `useGoals` extract +
`useDailyTotals` + dashboard + Home re-export; `tsc`/`lint`/web-bundle; user
web-verify; Journal + mark Done + commit & push. Real-device pass rides the deferred
0007/0012/0013 iPhone bundle.

## Open questions
1. **Progress visual** — simple track+fill bars (proposed, no dep) vs a circular
   calorie ring (nicer, needs `react-native-svg` or an arc hack). Recommend bars for
   v1; ring as a cosmetic follow-up. OK?
2. **Show quality nutrients / score?** Proposed non-goal for v1 — confirm we keep it
   to calories + P/C/F.
3. ~~**Extract `useGoals` vs duplicate**~~ — **CLOSED** (review): dashboard-local
   NARROW reader (4 target columns), Settings untouched — avoids the `select('*')`
   body-PII leak onto Home and any Settings regression.
4. ~~**48 h read vs RPC**~~ — **CLOSED** (review): bounded client read, no migration
   (both reviewers endorsed; the 48 h bound is provably enough).
5. **Greeting/name** — show "Good morning, {display_name}"? Minor; can omit if it
   complicates the empty/loading states.
6. **Number locale** — `toLocaleString('en-US')` (Latin digits) vs the user's Persian
   locale (Eastern-Arabic digits, ۱٬۲۴۰). Pick one explicitly; recommend matching the
   app's Persian preference if the rest of the numeric UI does, else `'en-US'`.

---

## Review
_Balanced 4-lens review (correctness, architecture, edge, data/privacy), 2026-06-24.
Consolidated + deduped; the plan body above is edited to resolve every blocker.
RLS for both reads verified present. Verdict below._

### BLOCKER (all resolved in the plan above)
- **B1 — tz arrives after the fetch and the bucket never recomputes.** (edge + arch)
  `useProfile` renders `null` tz first, then the real tz; the `(userId, reloadKey)`
  fetch keying (copied from `useMealHistory`) doesn't react to a *second* async input
  (tz), so totals could be bucketed under the UTC/device fallback and never corrected.
  **Resolution:** tz is now a **parameter** (`useDailyTotals(tz)`); the bucket+sum is a
  `useMemo(rows, tz)` (not fetch-time), so a late tz re-buckets the fetched rows with
  no refetch; the screen gates `loading = profileLoading || totalsLoading`. This also
  removes the **double profile fetch** (the hook no longer calls `useProfile`).
- **B2 — divide-by-zero / NaN drift across the four metrics.** (correctness + edge)
  Prose-only 0-goal handling would let the calories card render "/ 0" and a macro bar
  compute an `Infinity` width. **Resolution:** one required pure
  `progressFor(consumed, goal)` helper (`hasGoal = goal > 0`; guarded
  fraction/remaining/over) used by **all four** metrics; no inline division.
- **B3 — `useGoals` extraction leaks body-PII onto Home.** (data) Settings'
  `useGoalsRow` does `select('*')` (age/sex/height/weight); extracting it verbatim
  would pull that health-PII into the landing screen that renders none of it, and risk
  regressing Settings' one-shot contract. **Resolution:** dropped the extraction —
  dashboard-local `useDailyGoals` selects ONLY the 4 target columns (typed `Pick<>`,
  in-code `.eq('user_id')`); Settings left untouched.

### SHOULD-FIX (folded in)
- **Native Hermes can silently ignore `Intl` `timeZone`** (correctness) → bucket by
  device-local without throwing. Documented; web-verify is valid, native pass must
  confirm tz is honored.
- **Build the formatter once, try/catch at construction** (edge) — invalid IANA throws
  a `RangeError` at construction, not per-`.format()`. Resolved in §2.
- **Pin exact calls/types** (correctness + data): `.toISOString()` for the 48 h bound;
  `SELECT_COLUMNS` const + matching `Pick<>` (compile-time allowlist) for BOTH new
  selects; grep gate added to the verify plan.
- **Goals staleness on focus** (correctness + arch): decided — `useDailyGoals` exposes
  `refetch`; the screen refetches goals **and** totals on focus, so a Settings edit
  reflects on Home. Settings' own contract is untouched (separate reader).
- **Error-gate precedence** (edge + correctness): profile-loading/totals-loading →
  spinner; profile error → Retry (no confident wrong totals); totals error → Retry;
  goals error non-fatal. Empty-state precedence (no-meals vs no-goals) defined.
- **`getDeviceTimezone` cross-feature import** (arch): tz fallback resolved in the
  **screen** (already an `auth` consumer), not in `dashboard/lib`.

### NIT (addressed / noted)
- Dropped the speculative `today.ts`; bucket inline, `progressFor` in the screen
  module (arch). • 48 h justification stated as ≤25 h day + ≤14 h offset ≈ 39 h ≤ 48 h
  (correctness). • `profile.timezone` guarded on **blank string** (`!tz.trim()`), not
  just null (it's `NOT NULL`). • Future-dated rows: tomorrow-local naturally excluded
  by the date-string compare — intended, noted for verify. • Number locale: pass an
  explicit locale to `toLocaleString` (OQ6). • Focus-on-mount fires one redundant cheap
  bounded query — harmless, noted (optional in-flight guard).

### Verdict
**APPROVED** — 3 blockers resolved by concrete plan edits (B1 tz-as-param + memo
re-bucket; B2 shared `progressFor`; B3 narrow dashboard-local goals reader). RLS for
`meal_logs` + `goals` verified present (no migration). Should-fix/nits folded in. Ready
to execute. OQ1 (bars vs ring), OQ2 (no quality nutrients), OQ5 (greeting), OQ6 (digit
locale) are cosmetic/scope confirmations, not blockers.

## Execution log
**2026-06-24 — built + user web-verified. DONE.** No design deviations from the
approved (post-review) plan.

**Added:**
- `src/features/dashboard/lib/use-daily-goals.tsx` — dashboard-scoped NARROW goals
  reader: `select('calories, protein, carbs, fat')` typed as `Pick<>` (no body PII),
  in-code `.eq('user_id')`, `(userId, reloadKey)` keying, `refetch`. Settings untouched.
- `src/features/dashboard/lib/use-daily-totals.tsx` — `useDailyTotals(tz)`: 48 h bounded
  `.gte('eaten_at', toISOString())` fetch (strict `Pick<>` allowlist), bucket+sum in a
  `useMemo(rows, tz)` via one hardcoded-`en-CA` `Intl.DateTimeFormat` (try/catch at
  construction → UTC fallback), so a late tz re-buckets with no refetch.
- `src/features/dashboard/screens/dashboard-screen.tsx` — owns the single `useProfile()`,
  resolves tz (stored → device → UTC), passes it to `useDailyTotals`; one guarded
  `progressFor(consumed, goal)` (`goal > 0` only) for all four metrics; calorie card +
  three macro `Bar`s (two stacked Views, no svg); gate order
  profile-loading/totals-loading → profile error → totals error → render; no-meals +
  no-goals empty states; `useFocusEffect` refetches totals + goals.
- `src/app/(app)/index.tsx` — replaced the Expo starter with the thin re-export
  (mirrors `history.tsx`). Tab stays `/`, label "Home" — no `app-tabs*` change needed.

**Choices within plan intent:** numbers render as plain `Math.round` integers (matches
History; sidesteps OQ6 digit-locale — no `toLocaleString`). The `Bar` fill width is a
`DimensionValue`-cast `${pct}%` string. Greeting shows `Hi, {display_name}` when set,
else "Today" (OQ5 — kept minimal). No `today.ts`, no Settings edit (per review).

**Verified:** `npx tsc --noEmit` PASS; `npx expo lint` clean (0 problems); web bundle
compiles (`expo-router/entry.bundle?platform=web` → HTTP 200, ~7.9 MB, zero `*Error`).
**User web-verified 2026-06-24.** **Plan 0014 DONE.** Native tz-honoring (Hermes Intl)
rides the deferred 0007/0012/0013 iPhone pass. Open follow-ups: weekly/trend view,
calorie ring (OQ1), quality nutrients on dashboard (OQ2).
