# Plan: Extract `useOwnedMealRows` (DRY the three totals hooks' fetch)

- **Status**: ~~Draft~~ → ~~In Review~~ → ~~Approved~~ → ~~In Progress~~ → **Done**
- **Created**: 2026-09-14
- **Plan #**: 0038

## Problem / Goal
`useDailyTotals` (48 h), `useWeeklyTotals` (8 d), and `useMonthlyTotals` (33 d) each carry the SAME
fetch + lifecycle scaffolding: the `MealRow` allowlist + `SELECT_COLUMNS`, `userId`, `reloadKey`/
`refetch`, the `(userId, reloadKey)`-keyed `outcome`, the `mounted` ref, the identical
`from('meal_logs').select(...).eq('user_id', userId).gte('eaten_at', now-window)` query, and the
`rows` freshness derivation. Only the WINDOW and the AGGREGATION differ. This is the load-bearing
security/lifecycle code (the `.eq('user_id')` filter, the sign-out `mounted` guard, the stale-answer
key) copied three times — a change or bug fix must touch all three.

Extract a shared `useOwnedMealRows(windowMs)` that owns the fetch + lifecycle and returns the raw
rows; each period hook keeps only its own aggregation. **Pure refactor — no behavior/UI change.**

## Non-goals
- No change to the aggregation logic (today-bucket / 7-day buckets / month aggregate), the window
  sizes, the tz/`todayKey` reactivity, or any hook's public return shape (their consumers are
  untouched).
- No change to `use-daily-goals.tsx` (a different query/shape — not a totals hook).
- No query/RLS/schema change; the `.eq('user_id')` + `Pick<>` allowlist are preserved verbatim.

## Proposed approach
New `src/features/dashboard/lib/use-owned-meal-rows.tsx`:
```
export type OwnedMealRow = Pick<Database['public']['Tables']['meal_logs']['Row'],
  'eaten_at' | 'total_calories' | 'total_protein' | 'total_carbs' | 'total_fat'>;
export type OwnedMealRowsStatus = {
  rows: OwnedMealRow[] | null;   // freshest OK rows for the current (user, attempt), else null
  loading: boolean;              // true until the first resolve for the current user
  error: boolean;                // the current attempt failed
  refetch: () => void;
};
export function useOwnedMealRows(windowMs: number): OwnedMealRowsStatus { … }
```
It contains the EXACT fetch effect + `outcome` + `mounted` + `rows`-freshness + status derivation
that the three hooks share today, with `WINDOW_MS` replaced by the `windowMs` param (added to the
fetch effect's dep array — a per-call literal constant, so refetch behavior is identical). Owns the
`MealRow`/`SELECT_COLUMNS` definitions (the three copies collapse to one).

### Each period hook becomes thin
`useDailyTotals(tz)`:
```
const { rows, loading, error, refetch } = useOwnedMealRows(WINDOW_MS); // 48h
const todayKey = useCurrentDayKey(tz);
const totals = useMemo(() => rows ? <today bucket> : ZERO, [rows, tz, todayKey]);
return { loading, error, refetch, totals };   // rows null while loading/error → totals=ZERO
```
`useWeeklyTotals(tz)` and `useMonthlyTotals(tz)` follow the same shape (their existing aggregation
`useMemo`s move over verbatim; monthly keeps its `elapsed` derived from `todayKey`). Each keeps its
own `WINDOW_MS`, `ZERO`/`EMPTY_DAYS`/`zeroWeeks` empties, and public status type.

**Equivalence:** `rows` is non-null EXACTLY when the old code's status memo returned "fresh ok", so
the aggregate is ZERO/EMPTY precisely while loading/error — identical to today's explicit
ZERO-on-loading returns. `loading`/`error`/`refetch` map one-to-one.

## Files to change
- `src/features/dashboard/lib/use-owned-meal-rows.tsx` — NEW shared fetch hook.
- `src/features/dashboard/lib/use-daily-totals.tsx` — use it; keep the today bucket + return shape.
- `src/features/dashboard/lib/use-weekly-totals.tsx` — use it; keep the 7-day buckets + return shape.
- `src/features/dashboard/lib/use-monthly-totals.tsx` — use it; keep `aggregateMonth`/`elapsed` + shape.

## Data model / schema impact
None. Same query, same `.eq('user_id')`, same `Pick<>` allowlist.

## Edge cases & failure modes
- **Security/privacy preserved:** the `.eq('user_id', userId)` owner filter and the strict `Pick<>`
  allowlist move verbatim into the one hook (now a SINGLE source, harder to get wrong); no `select('*')`.
- **Sign-out mid-fetch:** the `mounted` ref + per-attempt `active` flag + `(userId, reloadKey)` key
  move verbatim → the late-`setState` guard and stale-answer drop are unchanged.
- **tz / midnight reactivity:** unchanged — `tz`/`todayKey` stay in each period hook's aggregation
  `useMemo`; the fetch never keys on tz (as today).
- **`windowMs` in the effect deps:** callers pass a module-constant literal, so it never changes →
  no extra refetch vs today.
- **React Compiler / strict hooks:** the shared hook keeps the same `useCallback`/`useMemo`/`useRef`
  structure it's extracted from — no new dep-array surface.

## Test / verify plan
- `npx tsc --noEmit` → 0; `npx expo lint` → 0; `npx expo export --platform web` → success.
- Manual smoke: Daily/Weekly/Monthly rings + charts show identical numbers; pull-to-refresh/refetch,
  a late tz, and midnight rollover all behave as before; sign-out mid-load doesn't warn.

## Rollout
Pure client refactor. No migration/secret/deploy. Commit to `main`; reload.

## Open questions
None.

---

## Review
Two focused reviewers (equivalence+security+lifecycle, architecture). **Verdict: APPROVED — no
blockers.** All three hooks are byte-identical in the fetch/lifecycle/`rows`-derivation block; the
consolidation makes the `.eq('user_id')` filter + `Pick<>` allowlist a single source (strictly safer).

### Must implement exactly (SHOULD-FIX)
- **Signed-out contract (equivalence SF1):** the shared hook must map
  `fresh = outcome?.userId === userId && outcome.reloadKey === reloadKey`,
  `rows = fresh?.kind === 'ok' ? fresh.rows : null`, `loading = !!userId && !fresh`,
  `error = !!userId && fresh?.kind === 'error'`. So **signed-out ⇒ `{rows:null, loading:false,
  error:false}`** (not perpetual loading) — matches every hook's current `if (!userId) return
  {loading:false,…}`.
- **Monthly rollover (equivalence SF2):** monthly's `elapsed` + the empty `zeroWeeks(todayKey)`
  branch derive from `todayKey`, NOT `rows`, and must recompute on midnight/month rollover even while
  loading/error — keep `todayKey`/`elapsed` in the relevant deps (the `agg` memo already keys on
  `todayKey`; `elapsed` is computed each render).
- **Non-goal:** `use-meal-history.tsx` is a `meal_logs` reader but **considered-and-excluded**
  (different columns, `ilike`/date-range filters, `HISTORY_LIMIT`, `filterKey`, `loading` vs
  `refetching`). `use-daily-goals.tsx` excluded (different table/shape).

### NIT (folded in)
- Return `rows` by reference (the raw `outcome.rows`), not a re-mapped copy, so each caller's
  aggregation `useMemo([rows, tz, todayKey])` stays stable.
- The shared hook returns a plain object literal (no `useMemo` wrapper — compiler-redundant; field
  identities are already stable). `month-weeks.ts`'s `MonthRow` stays its own structural type
  (`aggregateMonth` accepts `OwnedMealRow[]` structurally) — not touched.
- Do NOT dedup the three separate `meal_logs` reads into one shared fetch/cache — that would change
  network/refetch semantics (out of pure-refactor scope). Each period hook keeps its OWN
  `useOwnedMealRows` instance (independent `mounted`/`outcome`, no cross-talk).

## Execution log
Implemented per the approved plan + resolutions.
- `src/features/dashboard/lib/use-owned-meal-rows.tsx` — NEW: owns `OwnedMealRow`/`SELECT_COLUMNS`
  + the fetch effect (`.eq('user_id')`, `.gte('eaten_at', now-windowMs)`) + `mounted`/`active`/
  `(userId, reloadKey)` outcome; returns `{ rows, loading, error, refetch }` with the exact
  signed-out formulas above (rows by reference, plain-object return).
- `use-daily-totals.tsx` / `use-weekly-totals.tsx` / `use-monthly-totals.tsx` — now call the shared
  hook and keep ONLY their own `WINDOW_MS`, aggregation `useMemo` (tz/`todayKey`), empties, and
  public status shape; monthly keeps `elapsed`/`zeroWeeks(todayKey)` on `todayKey`.
- **Verify:** tsc 0 · expo lint 0 · web export 0.
