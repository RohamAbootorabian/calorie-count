/**
 * `YYYY-MM-DD`-in-`tz` day-bucket formatter, shared by the daily-totals (plan 0014)
 * and weekly-totals (plan 0018) hooks — the one genuinely-shared, self-contained
 * piece of their tz machinery.
 *
 * Locale is hardcoded `en-CA` so the output is always zero-padded `YYYY-MM-DD` in
 * Latin digits (never the device/Persian locale, which would break string equality
 * and emit non-Latin digits). Falls back to UTC if the IANA zone string is invalid,
 * so an unknown tz never crashes the caller.
 *
 * NATIVE CAVEAT: on Hermes without full-ICU the `timeZone` option can be silently
 * ignored (no throw) → a device-local bucket; web has full Intl, the iPhone pass verifies.
 */
export function makeDayFormatter(tz: string): Intl.DateTimeFormat {
  const opts: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  };
  try {
    return new Intl.DateTimeFormat('en-CA', { ...opts, timeZone: tz });
  } catch {
    // Invalid IANA zone throws a RangeError at construction — never crash the caller.
    return new Intl.DateTimeFormat('en-CA', { ...opts, timeZone: 'UTC' });
  }
}
