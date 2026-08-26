# Plan: Weekly calorie trend view

- **Status**: ~~Draft~~ → ~~In Review~~ → ~~Approved~~ → ~~In Progress~~ → **Done**
- **Created**: 2026-08-04
- **Plan #**: 0018

## Problem / Goal
The daily dashboard (plan 0014) shows **today's** totals only. A user can't see whether
they're trending up or down across the week — the single most-requested "am I on track?"
signal. This adds a **7-day trend**: a simple bar chart of daily calories for the last
7 calendar days (in the user's timezone), plus a small weekly summary (average calories +
average macros), reachable from the Home tab.

It **reuses plan 0014's exact machinery**: the same `meal_logs` read shape, the same
timezone resolution, and the same `Intl` same-formatter-string-compare bucketing — just
widened from a 48 h "today" window to a ~8-day window bucketed into 7 days. **Pure client,
read-only, no backend/migration, no new dependency.**

**"Done" =** from the Home (dashboard) screen, a "Weekly trend" affordance opens a new
screen showing **7 vertical bars** (one per local calendar day, oldest→newest, labelled by
weekday) whose heights are that day's total calories, with the newest day highlighted; a
summary row shows **average daily calories** and **average P/C/F** over the days that have
data; days with no meals render as an empty (zero-height) bar; loading/error/empty states
mirror the dashboard; `tsc`/`lint`/web-bundle green; user web-verifies.

## Non-goals
- **No per-day macro chart / stacked bars.** The bars encode **calories only**. Macros
  appear only as the aggregate weekly **average** (reusing the dashboard's `MetricBar`
  look). Rationale: there is **no per-macro color token** today (`primary` is the only
  series color; see 0014/design system), so a 3-series stacked chart would force new
  tokens — out of scope. Per-macro trend is a named follow-up.
- **No charting library.** Built from RN `View`s exactly like the dashboard's `Bar`
  (track + fill), so **no `react-native-svg` / victory / chart-kit** dependency is added.
- **No date-range picker / no scrolling history / no month view.** Exactly the last
  **7 calendar days** ending today. Longer ranges + pagination are a follow-up.
- **No goal overlay line** on the chart (a "target" marker) in v1 — keep it to the bars +
  summary. (Named follow-up; `useDailyGoals` could feed it later.)
- **No new tab.** A 5th `NativeTabs` tab needs a committed tab-icon PNG and is a permanent
  IA change; v1 uses a **root `Stack.Screen` presented over the tabs** (the `meal-edit`
  precedent), reached from a Home button.
- **No new backend read pattern.** Same `meal_logs` columns, same `.eq('user_id')`
  defense-in-depth, same privacy allowlist. No RPC, no migration, no storage.
- **No tap-a-bar-for-that-day's-meals drill-down** in v1 (named follow-up).

## Proposed approach
Smallest change that fully solves it: **one hook + one screen + one route + one link.**
The hook is a direct widening of `use-daily-totals.tsx`; the screen mirrors
`dashboard-screen.tsx`'s gates and DS usage; the chart reuses the `Bar` idiom.

### 1. `useWeeklyTotals` — `src/features/dashboard/lib/use-weekly-totals.tsx` (NEW)
Co-located under `features/dashboard/` (same `meal_logs`/tz sub-domain — SF4; NOT a new
`features/trends/` folder). A near-clone of `use-daily-totals.tsx`, same structure
(keyed-outcome machinery, `mounted` ref, `.eq('user_id')`, typed `Pick<>` allowlist
`SELECT_COLUMNS = 'eaten_at, total_calories, total_protein, total_carbs, total_fat'` **kept
textually adjacent to the `MealRow` `Pick<>` with the "keep in sync — over-fetch is not
caught by the `as unknown as` cast" comment carried verbatim**). It imports the shared
`makeDayFormatter` (the `en-CA`/tz/`try-catch`-UTC-fallback builder, extracted from
`use-daily-totals.tsx` to a shared spot both hooks import — SF4). Differences from 0014:
- **Window:** fetch `.gte('eaten_at', sinceIso)` with `WINDOW_MS = 8 * 24 h`. Rationale
  (corrected per review): keys AND rows use the *same* active tz, so the worst case is
  6 full days + one ≤25 h (DST) partial day ≈ 170 h; 8 days (192 h) covers it with margin.
  (Do NOT shrink it — the old "±14 h offset" framing was wrong.) Still **tz-independent at
  fetch time** (a tz change re-buckets already-fetched rows, no refetch), keyed
  `[userId, reloadKey]` only.
- **Keys + labels from the noon-UTC seed via UTC accessors ONLY (B1/SF1):** in the
  `useMemo([rows, tz])` (SF2 — keys+labels recompute with tz, never hoisted): format `now`
  with the tz formatter → today's `YYYY-MM-DD`; parse to `[y,m,d]`; `seed = new
  Date(Date.UTC(y, m-1, d, 12))` (noon UTC, DST-proof). For `i = 6…0`, `d_i =
  new Date(seed); d_i.setUTCDate(seed.getUTCDate() - i)`, then:
  - `key = d_i.toISOString().slice(0,10)` — byte-identical padded `YYYY-MM-DD`, matching the
    `en-CA` bucket string (never `` `${y}-${m}-${d}` ``).
  - `weekdayLabel = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d_i.getUTCDay()]` — static
    array, **no second formatter, no locale, no tz** (kills the invalid-tz crash + the
    extreme-zone drift). → an ordered list of 7 keys/labels (oldest→newest).
- **Bucket rows:** for each fetched row, `tzFmt.format(new Date(eaten_at))` → a key; sum
  into the matching bucket. Rows outside the 7 keys (cushion overshoot, incl. future clock
  skew) are ignored. The tz formatter is used ONLY here and to compute today's seed date.
- **Return shape:**
  ```ts
  export type DayTotals = { key: string; weekdayLabel: string; calories: number;
    protein: number; carbs: number; fat: number; mealCount: number };
  export type WeeklyTotalsStatus = { loading: boolean; days: DayTotals[]; // length 7, oldest→newest
    error: boolean; refetch: () => void };
  ```
- **Error parity (SF5):** the `.then(({data, error}))` sets `kind:'error'` when
  `error || data == null` (a null `data` is NOT a falsely-empty week), with **no**
  `console.*(error)` — never log the error object / row / metric / tz (static string only).
- **Signature:** `useWeeklyTotals(tz: string)` — tz owned by the screen (single
  `useProfile()`), exactly like `useDailyTotals`.

### 2. `TrendScreen` — `src/features/dashboard/screens/trend-screen.tsx` (NEW)
Mirrors `dashboard-screen.tsx`: owns the single `useProfile()`, resolves
`tz = profile?.timezone?.trim() || getDeviceTimezone() || 'UTC'`, calls
`useWeeklyTotals(tz)`. Gates in the same order: loading → `ActivityIndicator`;
profileError → Retry; totalsError → Retry (`refetch`); all-7-empty → a friendly empty
state ("No meals in the last 7 days"). `useFocusEffect(refetch)` (skip-first-focus is not
needed — this screen mounts fresh on navigation, unlike the always-mounted Home tab; a
plain `useFocusEffect(refetch)` is fine and refetches when returning to it).
- **Chart (small LOCAL component, not a shared `Bar` — SF3):** a `Card` (`@/shared/ui`)
  containing a fixed-height row (e.g. 160 px) of 7 columns (`flex:1`, `gap: Spacing.two`).
  Each column = a vertical track `View` (`theme.backgroundElement`, `Radius.sm`, `flex:1`,
  `justifyContent:'flex-end'`) with a fill `View` whose **height %** =
  `day.calories / maxCalories` (guard `maxCalories > 0` → all-zero renders flat empty bars),
  `backgroundColor: theme.primary`, `Radius.sm`. **Highlight (decided):** the newest day
  (last) uses full-opacity `primary`; older days use `primary` at **`opacity: 0.45`** so
  "today" reads as the anchor — no new token, no `backgroundSelected`. Under each bar: the
  `weekdayLabel` (`Text type="small" themeColor="textSecondary"`) and the calorie value
  (`Text type="smallBold"`; dim for zero-meal days). These bars are height-%, unlike the
  dashboard's width-% `Bar` (which is module-private anyway), so they're implemented locally.
- **Summary row (plain `Text`, NOT `MetricBar` — SF3):** a second `Card` "Weekly average" —
  average daily **calories** (`Text type="subtitle"`) computed over **days that have ≥1
  meal** (empty days excluded so a mid-week start isn't diluted; label states it, e.g. "avg
  over 5 logged days"; 0 logged days → "—", never `NaN`), and three compact average macros
  as **plain `Text` rows** (e.g. "Protein · 96 g avg"), `primary`/`textSecondary`. NOT
  `MetricBar` — that renders goal-progress and would show empty bars with no goal. No goal
  comparison in v1.
- **DS usage:** import `{ Card, Text, Button }` from `@/shared/ui`; tokens from
  `@/constants/theme`; `useTheme()` for colors. Wrap in the shared **`Screen`** primitive
  with `scroll` (the summary + chart may exceed a short viewport) — this screen is presented
  over the tabs with a header, so `Screen`'s clamp + safe-area handling fits (no local
  Screen wrapper needed, unlike the Home tab).

### 3. Route — `src/app/trends.tsx` (NEW) + registration in `src/app/_layout.tsx`
- `src/app/trends.tsx` — a thin re-export: `export { default } from
  '@/features/trends/screens/trend-screen';` (mirrors `(app)/index.tsx`).
- In `_layout.tsx`, add **inside the signed-in + onboarded guarded block** (next to
  `meal-edit`): `<Stack.Screen name="trends" options={{ headerShown: true, title: 'Weekly
  Trend' }} />`. Presented over the tabs with a back header — same pattern as `meal-edit`,
  so it inherits the auth/onboarding guard for free.

### 4. Entry point — a button on the dashboard (`dashboard-screen.tsx`)
- Add a `Button` (or a pressable "Weekly trend →" row) near the totals that calls
  `router.push('/trends')`. Minimal, additive; does not touch the totals logic. Placed
  after the macros card.

## Files to change
- `src/features/dashboard/lib/use-weekly-totals.tsx` — **new.** 7-day bucketed totals hook
  (widened clone of `use-daily-totals.tsx`, co-located — SF4).
- `src/features/dashboard/screens/trend-screen.tsx` — **new.** The trend screen: 7-bar
  calorie chart (local component) + plain-Text weekly-average summary + loading/error/empty
  gates.
- `src/features/dashboard/lib/use-daily-totals.tsx` — **edit.** Extract `makeDayFormatter`
  to a shared spot (see next) and import it back; behavior unchanged.
- `src/features/dashboard/lib/day-formatter.ts` (or similar shared lib) — **new.** The pure
  `makeDayFormatter` builder (`en-CA`/tz/`try-catch`-UTC-fallback), imported by both hooks
  (SF4 — the one genuinely shared piece; the keyed-outcome/`.eq`/`Pick<>` machinery stays
  cloned inline).
- `src/app/trends.tsx` — **new.** Thin route re-export of the trend screen.
- `src/app/_layout.tsx` — register `<Stack.Screen name="trends" options={{ headerShown:
  true, title: 'Weekly Trend' }} />` inside the signed-in+onboarded guarded block (next to
  `meal-edit`).
- `src/features/dashboard/screens/dashboard-screen.tsx` — add a "Weekly trend" button that
  `router.push('/trends')` (additive; totals logic untouched).

## Data model / schema impact
**None.** No tables, columns, migrations, RLS, or storage. Reuses the existing `meal_logs`
read (same typed `Pick<>` allowlist, same `.eq('user_id')` + the `meal_logs_user_eaten_idx`
index) over an 8-day window.

## Edge cases & failure modes
- **All 7 days empty** (new user / inactive week) → empty state, no divide-by-zero (guard
  `maxCalories > 0`; average over 0 logged days shows "—", not `NaN`).
- **Partial week** (started mid-week) → empty days render as flat zero bars; the average is
  over **logged** days only, labelled as such.
- **Timezone change** (user edits profile tz) → already-fetched rows **re-bucket** via the
  `useMemo(rows, tz)` with no refetch (0014 behavior preserved).
- **Invalid IANA tz** → `try/catch` at formatter construction falls back to `UTC` (0014
  behavior).
- **Native `Intl` timeZone silently ignored (Hermes/no full-ICU)** → same known caveat as
  0014/0013; day bucketing may use device-local zone on-device. **Deferred to the iPhone
  pass** (web has full Intl and is the verify surface). Called out, not fixed here.
- **DST boundary within the 7 days** → handled by calendar-math key generation at UTC-noon
  (no 24 h-ms drift) + the 8-day fetch cushion.
- **A day with meals but 0 calories** (edge data) → zero-height bar but counts as a logged
  day for the average denominator (mealCount>0). Acceptable.
- **Huge single day** (one outlier) → bars scale to `maxCalories`, so a spike flattens the
  others; acceptable for v1 (a fixed/goal-based scale is a follow-up).
- **Sign-out mid-fetch** → the keyed-outcome + `mounted` ref drop the stale answer (0014
  machinery preserved).
- **Rapid navigate in/out** → `useFocusEffect(refetch)` re-runs; keyed outcomes prevent a
  stale user's data showing.
- **Web wide screen** → `Screen`'s `MaxContentWidth` clamp keeps the chart centered.

## Test / verify plan
- `npx tsc --noEmit` PASS; `npx expo lint` clean; web bundle HTTP 200 (valid JS, no error
  envelope) including the new screen/hook.
- **Manual (web, logged in):**
  1. Home → tap "Weekly trend" → the trend screen opens with a header + back.
  2. 7 bars render, oldest→newest, weekday-labelled; today is the highlighted last bar;
     bar heights match the days you have meals on (cross-check a couple against History).
  3. A day with no meals shows a flat/empty bar; the summary average is over logged days
     only and matches a hand calc.
  4. Pull/return-to-screen refetches (add a meal in another tab, come back → updates).
  5. Empty account (or a 7-day gap) → empty state, no crash, no `NaN`.
  6. Regression: dashboard today-totals, History, Edit, capture flow all unchanged; the new
     button doesn't shift the dashboard layout.
- **Grep gate:** the hook/screen log no PII (no dish/eaten_at/row dumps); locale is
  hardcoded `en-CA` (never device/Persian); no `select('*')`.
- **Deferred iPhone pass:** native `Intl` tz honored for 7-day bucketing; bars/labels
  render correctly on-device; back gesture works.

## Rollout
1. Land the four new/changed files on `main` (no migration, no env, no deploy).
2. `tsc`/`lint`/web-bundle; user web-verify.
3. Journal + mark Done + commit & push. Native tz/bucketing rides the deferred iPhone pass.

## Open questions
1. **Entry point placement** — a `Button` after the macros card on Home (proposed) vs a
   header button vs a compact inline mini-preview on the dashboard. Proposed: simple Button
   for v1. OK?
2. **Bar highlight style** — newest day full `primary`, older days dimmed `primary`
   (proposed) vs all-uniform `primary`. Cosmetic; proposed for scannability.
3. **Average denominator** — over **logged days only** (proposed, avoids diluting a partial
   week) vs over all 7. Proposed: logged-days, with an explicit label.
4. **Calories-only bars** confirmed for v1 (macros = aggregate average only), given no
   per-macro color token exists. Agreed?

---

## Review
_Balanced 4-lens review (correctness, architecture, edge cases, data/privacy),
2026-08-04. Findings consolidated + deduped. One BLOCKER and a cluster of correctness/edge
findings collapse into **one decision** — generate the 7 day-keys AND weekday labels from
the noon-UTC seed via **UTC accessors only** (never a second tz formatter). All resolutions
folded into the plan above._

### BLOCKER (resolved)
- **B1 — The weekday-label formatter is unguarded → invalid-tz crash, and (separately)
  drifts for extreme zones.** The plan derived `weekdayLabel` from "the same en-CA/tz
  formatter family." A *second* `Intl.DateTimeFormat({ timeZone: tz, weekday:'short' })`
  built without 0014's `try/catch` throws a `RangeError` on an invalid IANA tz and crashes
  the screen (edge lens). Worse, applying a *tz* formatter to the `Date.UTC(y,m-1,d,12)`
  seed re-shifts the calendar day for zones past ±12 (Line Is./Samoa/Baker) → the label and
  key disagree with the tz-bucketed rows, so that day's bar silently reads empty and is
  mislabeled (correctness + edge lenses). **Resolution — one fix kills all of it:** derive
  BOTH the key and the weekday from the noon-UTC seed using UTC accessors only —
  `key = seed.toISOString().slice(0,10)` (byte-identical padded `YYYY-MM-DD`, matching the
  `en-CA` bucket string), `weekdayLabel = ['Sun','Mon',…][seed.getUTCDay()]` (static array,
  no locale, no formatter). The tz formatter is used ONLY to (a) compute today's seed date
  and (b) bucket each row. No second formatter exists, so nothing to crash and nothing to
  drift.

### SHOULD-FIX (folded in)
- **SF1 — Keys must be byte-identical to the `en-CA` bucket output.** Building keys as
  `` `${y}-${m}-${d}` `` yields `2026-8-7` vs the formatter's `2026-08-07` → zero matches →
  all bars empty. Use `seed.toISOString().slice(0,10)` (or a `timeZone:'UTC'` `en-CA`
  formatter) so padding matches exactly (correctness lens).
- **SF2 — Recompute keys + labels INSIDE the tz-dependent memo.** 0014 re-buckets rows in a
  `useMemo(rows, tz)` but only computes one `todayStr`. Here the 7 keys and labels are also
  tz-derived; if they're hoisted/computed once, a late `profile.timezone` change re-buckets
  rows into stale keys → bars under wrong labels. Require key+label generation inside the
  `[rows, tz]` memo (edge lens).
- **SF3 — The "reuse `Bar`/`MetricBar`/`progressFor`" story is not achievable as written.**
  All three are **module-private** inside `dashboard-screen.tsx` (not exported, not in
  `shared/ui`). And `MetricBar` renders *progress toward a goal* (`progressFor` →
  `hasGoal:false` ⇒ empty bar) — reusing it for a goal-less average yields three empty bars.
  **Resolution:** (a) the weekly-average macros are **plain `Text` rows** (label + "Ng
  avg"), NOT `MetricBar`; (b) the 7 vertical chart bars are a small **local** component
  (they're height-%, not the dashboard's width-% `Bar` — different enough that sharing adds
  no value); (c) drop all "reuse the MetricBar look" language (architecture lens).
- **SF4 — Don't spin up a cross-feature clone: co-locate under `features/dashboard/`.** A
  new `features/trends/` folder that clones ~80 lines of `features/dashboard/` hook
  machinery is the one arrangement to avoid (duplication *across* a feature boundary, hardest
  to later DRY). **Resolution:** put `use-weekly-totals.tsx` + `trend-screen.tsx` under
  **`features/dashboard/`** (same `meal_logs`/tz sub-domain, reached from the dashboard).
  Extract only the pure `makeDayFormatter` (the `en-CA`/tz/UTC-fallback builder) to a shared
  spot both hooks import — the one genuinely-shared, self-contained piece; keep the
  keyed-outcome/`.eq('user_id')`/`Pick<>` machinery cloned inline (abstracting it now would
  hide the security-critical filter reviewers read inline) (architecture lens).
- **SF5 — Preserve 0014's `error || data == null` → error.** In the cloned `.then(({data,
  error}))`, a null `data` must set `kind:'error'`, NOT default to an empty (falsely
  "all-7-empty") week (correctness lens).

### NIT (addressed/noted)
- **Native Hermes/full-ICU caveat now covers keys + labels + buckets** — with the
  seed-derived weekday (getUTCDay), all three degrade *self-consistently* to device-local on
  native (buckets, keys, labels agree); the deferred iPhone pass verifies tz is honored
  (edge lens). • **Logging:** the error outcome sets `kind:'error'` with **no**
  `console.*(error)` — never log the Postgrest `error` object, the row, the metric, or the
  tz (static string only), mirroring 0014 (data lens). • **Carry the `SELECT_COLUMNS`↔`Pick<>`
  sync comment verbatim** and keep them textually adjacent — the `as unknown as MealRow[]`
  cast means tsc won't catch a drifted string; the comment is the only guard (data lens). •
  **8-day window rationale corrected:** keys and rows use the *same* active tz, so worst case
  is 6 full days + one ≤25 h partial ≈ 170 h; 8 days (192 h) covers it — fix the doc's
  "±14 h" wording so nobody shrinks the window (correctness lens). • **Highlight style
  decided:** newest day = full `primary`; older days = `primary` at ~0.45 opacity (one
  choice — drop the `backgroundSelected` alternative). • **`useFocusEffect(refetch)`
  double-fetches on mount** and flips the chart to a spinner on refocus — pre-existing 0014
  cost, **accepted** for v1 (no skip-first-focus; not the always-mounted Home tab). •
  **Future-dated rows** (clock skew) fetched then dropped as cushion-overshoot — intended,
  acknowledged. • **All-logged-days-0-cal** → flat bars + "avg 0 over N days", not the empty
  gate — verify the copy doesn't read as broken. • **Narrow-screen fit** (7 bars + 4-digit
  labels @320px) — verify no clip.
- **Confirmed correct, no change (esp. data/privacy):** typed `Pick<>` allowlist excludes
  every sensitive `meal_logs` column (`dish_name`/`assumptions`/`quality_*`/`confidence`/
  `image_path`/`verified`); explicit `.eq('user_id')` + `meal_logs_user_eaten_idx` index;
  raw `eaten_at` never leaves the hook (only bucket key + aggregates); 8-day single indexed
  query is bounded, not runaway; auth-null handling + keyed-outcome/`mounted` stale-drop
  match 0014; no secret/RPC/storage/migration; raw RN Views (no chart lib) and root
  `Stack.Screen`-over-tabs (meal-edit precedent) + calories-only bars are all the right,
  minimal calls; no off-by-one (i=6…0 → 7 bars incl. today); average NaN-guarded.

### Verdict
**NEEDS CHANGES → RESOLVED.** One blocker (B1: unguarded/ drifting weekday formatter),
resolved together with the correctness/edge cluster by the single decision to derive keys
+ labels from the noon-UTC seed via UTC accessors only. Architecture reuse story corrected
(co-locate under `features/dashboard/`, summary = plain Text, extract only
`makeDayFormatter`). With the edits applied above, **APPROVED** for execution.

## Execution log
Built exactly per the approved plan. Files:
- `features/dashboard/lib/day-formatter.ts` (NEW) — extracted the shared `makeDayFormatter`
  (`en-CA`/tz/try-catch-UTC-fallback); `use-daily-totals.tsx` now imports it (behavior
  unchanged, its local copy removed).
- `features/dashboard/lib/use-weekly-totals.tsx` (NEW) — widened clone of 0014: 8-day
  window; keys + weekday labels from a noon-UTC seed via UTC accessors only
  (`toISOString().slice(0,10)` + `WEEKDAY_LABELS[getUTCDay()]`, no second formatter — B1/SF1);
  keys+labels regenerated inside the `useMemo([rows,tz])` (SF2); same `.eq('user_id')` +
  `Pick<>` allowlist + `error||data==null → error` (SF4/SF5); returns `DayTotals[]` (7,
  oldest→newest).
- `features/dashboard/screens/trend-screen.tsx` (NEW) — mirrors the dashboard gates; a LOCAL
  7-bar chart (height-%, `primary`, newest full-opacity / older `opacity:0.45` — SF3) + a
  plain-`Text` weekly-average summary (calories + P/C/F avg over LOGGED days only, labelled);
  uses the shared `Screen scroll` primitive.
- `app/trends.tsx` (NEW) + `_layout.tsx` — `<Stack.Screen name="trends">` inside the
  signed-in+onboarded guard, next to `meal-edit`.
- `dashboard-screen.tsx` — a `Button variant="secondary"` "Weekly trend →" after the macros
  card → `router.push('/trends')`.

**Deviation (minor):** plan §3 line still named the re-export target `features/trends/...`;
implemented per SF4 as `@/features/dashboard/screens/trend-screen` (co-located). No behavior
change.

**Verified:** `tsc --noEmit` exit 0; `expo lint` clean; web bundle HTTP 200 · 3.9 MB ·
complete (sourcemap tail); **user web-verified** (7 bars + weekly averages render, dashboard
regression clean). DONE. Native `Intl` tz bucketing rides the deferred iPhone pass.
