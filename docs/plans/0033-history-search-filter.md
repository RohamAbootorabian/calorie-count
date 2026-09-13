# Plan: History search (by dish name) + date filter

- **Status**: ~~Draft~~ → ~~In Review~~ → **Approved** → In Progress → Done
- **Created**: 2026-09-13
- **Plan #**: 0033

## Problem / Goal
As the meal list grows, finding a specific meal is hard. Add to the History screen:
1. A **search box** that matches the dish name across the user's **entire** history (server-side).
2. A **date filter** with both **quick presets** (All / Today / Last 7 days / Last 30 days) **and**
   a **custom From–To range** (via the existing `DateField`).

"Done": typing in the search box (debounced) re-queries and shows only matching meals from all
history; picking a preset or a custom range narrows by `eaten_at`; the two combine (search AND
date); a clear empty state distinguishes "no results for this filter" from "no meals yet".

## Non-goals
- No full-text/fuzzy search — a simple case-insensitive substring (`ilike '%term%'`) on
  `dish_name` is enough for v1.
- No pagination redesign — the existing `HISTORY_LIMIT` (100) newest-first cap stays as the
  per-query bound (now applied to the filtered result).
- No search over item names, notes, or macros — dish name only.
- No new DB column, migration, or RPC. No index change (see Data model).

## Proposed approach
Make `useMealHistory` **filter-driven** and keep the filter UI + state on the screen.

### Pure helpers — new `src/features/history/lib/history-filter.ts`
- `type DatePreset = 'all' | 'today' | '7d' | '30d' | 'custom'`.
- `type HistoryFilter = { search: string; preset: DatePreset; from: Date | null; to: Date | null }`.
- `escapeIlike(term: string): string` — escape PostgREST `ilike` metacharacters (`\`, `%`, `_`) so
  a literal `%` in a dish name isn't a wildcard (also trims). Returns '' for blank.
- `resolveRange(filter, now = new Date()): { fromIso: string | null; toIso: string | null }` —
  turns a preset (or custom from/to) into ISO bounds using **device-local day boundaries**:
  Today → [start of today, now]; 7d → [start of (today−6), now]; 30d → [start of (today−29), now];
  all → [null, null]; custom → [start of `from`, end of `to`] (either side may be null). Guards an
  Invalid Date → treated as null. Pure, no I/O, never logs.
- `filterKey(userId, filter): string` — a stable string for the outcome key + effect deps
  (search term + resolved range), so a stale result from a previous filter never renders.

### Hook — `use-meal-history.tsx`
- Signature becomes `useMealHistory(filter: HistoryFilter)`.
- Build the query: `.eq('user_id', userId)` (unchanged, mandatory) + when `search` non-empty
  `.ilike('dish_name', '%' + escapeIlike(search) + '%')` + `.gte/.lte('eaten_at', …)` from
  `resolveRange` + `.order('eaten_at', desc).limit(HISTORY_LIMIT)`.
- Keep the exact lifecycle discipline (mounted ref, per-attempt `active`, outcome KEYED to
  `(userId, reloadKey, filterKey)`), so debounced/rapid filter changes can't render a stale list.
- The column allowlist (`SELECT_COLUMNS` / `MealCard`) is unchanged.

### Screen — `history-screen.tsx`
- Filter state: `search` (raw), `preset`, `customFrom`, `customTo`. Debounce `search` ~300ms
  (small inline `useDebouncedValue` hook, or a ref+timeout) → the value passed to the hook.
- Build the `HistoryFilter` and pass it to `useMealHistory`.
- UI in the list header: a search `Input` (clearable), a row of preset chips (reusing the
  Button-as-selector pattern), and — only when `preset === 'custom'` — two `DateField`s (From / To).
- Empty state: when a filter is active and 0 rows → "No meals match your search/filters." else the
  existing "No meals logged yet…".
- Keep pull-to-refresh + focus-refetch (they just re-run with the current filter).

## Files to change
- `src/features/history/lib/history-filter.ts` — NEW pure helpers (types, escapeIlike, resolveRange, filterKey).
- `src/features/history/lib/use-meal-history.tsx` — accept + apply the filter; key outcome to filterKey.
- `src/features/history/screens/history-screen.tsx` — filter state + debounce + search/preset/range UI + empty-state copy.

## Data model / schema impact
None. `dish_name` `ilike` runs a sequential scan **within the user's rows** — fine for per-user
volumes at this stage; the `(user_id, eaten_at desc)` index still serves the owner filter + order +
date range. No new index in v1 (revisit only if per-user meal counts get large).

## Edge cases & failure modes
- **Debounce race:** two quick searches — the outcome key `(userId, reloadKey, filterKey)` drops the
  stale one; the in-flight `active` flag + mounted ref guard setState. While a new filter's query is
  in flight the hook reports `loading` (don't render the previous filter's rows as if they matched).
- **`ilike` metacharacters / injection:** the term is a bound parameter (PostgREST), never string-
  concatenated SQL; `escapeIlike` additionally neutralizes `% _ \` so they match literally.
- **Empty search / All preset:** identical query to today (no ilike, no date bounds) — no regression.
- **Custom range inverted (from > to) or half-open:** resolveRange tolerates nulls; if from > to the
  query simply returns nothing (acceptable) — optionally swap; document either way.
- **Timezone:** ranges use device-local day starts (matches the picker's noon-local Dates). A user
  who changed tz sees boundaries in their current device zone — acceptable for a filter (not a
  ledger). Note it; do not over-engineer stored-tz here.
- **At-limit note:** the "showing 100 most recent" footer should reflect that it's 100 most recent
  **matching** meals when a filter is active.
- **Privacy:** the search term is a dish name (health-adjacent) — NEVER logged (hook already logs
  only structural outcomes; keep it that way). No term in analytics.

## Test / verify plan
- `npx tsc --noEmit` → 0; `npx expo lint` → 0; `npx expo export --platform web` → success.
- Manual: search a dish that exists only in an OLD (>100th) meal → it appears (server-side proof).
  Presets narrow correctly; custom From–To narrows correctly; search + date combine; clearing all
  restores the full newest-first list; empty-filter result shows the "no match" copy; pull-to-
  refresh + returning from an edit keep the active filter.

## Rollout
Pure client change. No migration/secret/deploy. Commit to `main`; user reloads (JS-only).

## Open questions
- Inverted custom range (from > to): return nothing vs. auto-swap? (Default: return nothing; cheap
  to swap if preferred.)

---

## Review
Three focused reviewers (correctness/API, edge+privacy, architecture). Strong consensus.
**Verdict: NEEDS CHANGES → 3 blockers + should-fixes resolved → APPROVED.**

### BLOCKER (resolved)
- **B1 — Full-screen `loading`/`error` gate unmounts the filter UI.** The screen returns a centered
  spinner/error before the list; once the hook is filter-driven, every debounced query flips
  `loading`, unmounting the search `Input` mid-type (focus + keyboard lost). → **Resolved:** the
  hook distinguishes **initial load** (`loading`) from **refetch-with-data** (`refetching`) and keeps
  the last rows; the screen shows the full-screen spinner ONLY on the initial load with no filter,
  keeps the pinned filter header mounted otherwise, and renders refetch progress + errors **inline**.
- **B2 — `now` upper bound ⇒ unstable `filterKey` ⇒ refetch loop / stuck loading.** → **Resolved:**
  presets use `toIso = null` (`eaten_at` is already ≤ now, future-guarded); all bounds are
  **day-granular** (start-of-local-day ISO), so the key is stable within a day.
- **B3 — Custom `to` must be inclusive end-of-day (local).** `DateField` emits **noon-local** Dates;
  using the raw value with `.lte('eaten_at', …)` drops meals eaten after noon on the end day. →
  **Resolved:** `resolveRange` builds `from = startOfLocalDay`, `to = endOfLocalDay` via LOCAL
  getters, then `toISOString()`.

### SHOULD-FIX (resolved)
- Effect deps AND the return memo key on **primitive** derived values (`pattern`, `fromIso`,
  `toIso`) / a composite string — never the `filter` object — so no churn/loop.
- `escapeIlike`: escape `\` **first**, then `%`/`_`; also **strip `*`** (PostgREST aliases `*`→`%`).
  The term is a bound PostgREST value (no SQL injection).
- **Whitespace-only search:** the trimmed term drives the query, the "filter active" flag, AND the
  empty-state copy consistently.
- **Inverted custom range (from > to):** auto-swap.
- **Offline/error while filtered:** header stays mounted, error shown inline so the user can clear it.

### NIT (addressed)
- Custom range: switching to `custom` defaults From = 30 days ago, To = today (DateField needs a
  non-null Date); both bounds always present (resolveRange stays null-tolerant internally).
- Debounced value initialized to the current search (immediate first query); the clear (X) resets
  immediately.
- Pinned search + preset chips (wrapping Button row, short labels) live in a fixed View ABOVE the
  FlatList as a STABLE element (never `ListHeaderComponent={() => …}`), so the input never remounts.
- **Privacy:** the term travels in the request URL to PostgREST (unavoidable for server `ilike`);
  never logged, never in analytics, never in a user-facing error string. `resolveRange`/`escapeIlike`
  are pure and silent.
- Footer copy → "100 most recent **matching** meals" when a filter is active.
- Range boundaries use **device-local** day starts (like the picker), a deliberate, documented
  divergence from the dashboards' profile-tz bucketing (fine for a filter, not a ledger).

## Execution log
Implemented per the approved plan + resolutions.
- `src/features/history/lib/history-filter.ts` — NEW: `DatePreset`/`HistoryFilter` types,
  `escapeIlike` (\ first, %/_ escaped, * stripped), `resolveRange` (day-granular local bounds,
  preset `toIso=null`, custom start/end-of-day + auto-swap).
- `src/features/history/lib/use-debounced-value.ts` — NEW: tiny debounce hook (initialised to the
  current value; clears the timer on change/unmount).
- `src/features/history/lib/use-meal-history.tsx` — filter-driven query (ilike + gte/lte + order +
  limit); outcome keyed to `(userId, reloadKey, filterKey)`; exposes `loading` (initial) vs
  `refetching` (with data) and keeps last rows.
- `src/features/history/screens/history-screen.tsx` — pinned filter header (search Input + preset
  chips + conditional From/To DateFields) above the FlatList; full-screen spinner only on initial
  load; inline refetch spinner + inline error; "no match" vs "no meals yet" empty states; footer
  copy updated.
- **Verify:** tsc 0 · expo lint 0 · web export 0.
