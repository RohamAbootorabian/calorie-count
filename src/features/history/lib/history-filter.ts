/**
 * Pure helpers for the History search + date filter (plan 0033). No UI, no I/O,
 * no logging (the search term is a dish name — health-adjacent PII; never log it).
 *
 * Date bounds use DEVICE-LOCAL day boundaries (a deliberate, documented divergence
 * from the dashboards' profile-tz bucketing — fine for a filter, not a ledger). The
 * `DateField` picker emits noon-local Dates, so local getters here are DST-safe.
 */

export type DatePreset = 'all' | 'today' | '7d' | '30d' | 'custom';

/** The screen's filter state. `from`/`to` are meaningful only when `preset==='custom'`. */
export type HistoryFilter = {
  search: string;
  preset: DatePreset;
  from: Date | null;
  to: Date | null;
};

/** Resolved query bounds (ISO), either side null = unbounded. */
export type ResolvedRange = { fromIso: string | null; toIso: string | null };

/**
 * Escape a search term for a PostgREST `ilike` pattern used as `%term%`:
 *  - escape `\` FIRST, then `%` and `_` (so LIKE treats them literally),
 *  - STRIP `*` (PostgREST aliases `*` → `%` at URL-parse time, above the SQL layer,
 *    so a backslash can't neutralize it).
 * Returns '' for a blank/whitespace-only term (→ caller omits the ilike entirely).
 * The term is sent as a BOUND value by supabase-js — never concatenated SQL.
 */
export function escapeIlike(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  return trimmed
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_')
    .replace(/\*/g, '');
}

/** Local start of `d`'s calendar day (00:00:00.000). */
function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

/** Local end of `d`'s calendar day (23:59:59.999) — inclusive upper bound for `.lte`. */
function endOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

function isValidDate(d: Date | null): d is Date {
  return d != null && !Number.isNaN(d.getTime());
}

/**
 * Turn a filter into ISO query bounds. Presets set only a day-granular LOWER bound
 * (`toIso` stays null — `eaten_at` is already ≤ now, future-guarded — which also keeps
 * the derived filter key stable within a day, avoiding a refetch loop). Custom uses
 * start-of-`from`-day … end-of-`to`-day (auto-swapping an inverted range).
 */
export function resolveRange(filter: HistoryFilter, today: Date = new Date()): ResolvedRange {
  switch (filter.preset) {
    case 'all':
      return { fromIso: null, toIso: null };
    case 'today':
      return { fromIso: startOfLocalDay(today).toISOString(), toIso: null };
    case '7d': {
      const from = startOfLocalDay(today);
      from.setDate(from.getDate() - 6); // today + the 6 prior days.
      return { fromIso: from.toISOString(), toIso: null };
    }
    case '30d': {
      const from = startOfLocalDay(today);
      from.setDate(from.getDate() - 29);
      return { fromIso: from.toISOString(), toIso: null };
    }
    case 'custom': {
      let lo = isValidDate(filter.from) ? filter.from : null;
      let hi = isValidDate(filter.to) ? filter.to : null;
      if (lo && hi && lo.getTime() > hi.getTime()) [lo, hi] = [hi, lo]; // auto-swap.
      return {
        fromIso: lo ? startOfLocalDay(lo).toISOString() : null,
        toIso: hi ? endOfLocalDay(hi).toISOString() : null,
      };
    }
  }
}

/**
 * A stable string identifying the effective query (owner-independent). Day-granular +
 * the escaped term, so it doesn't churn across renders within a day. Used as the
 * outcome key + effect signature so a stale debounced result never renders.
 */
export function filterKey(filter: HistoryFilter): string {
  const { fromIso, toIso } = resolveRange(filter);
  return `${escapeIlike(filter.search)}|${fromIso ?? ''}|${toIso ?? ''}`;
}

/** True when the filter would narrow the full newest-first list (drives empty-state copy). */
export function isFilterActive(filter: HistoryFilter): boolean {
  return escapeIlike(filter.search) !== '' || filter.preset !== 'all';
}
