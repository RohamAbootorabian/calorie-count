/**
 * Pure form model for PROFILE-ONLY concerns (plan 0006 SF1): `display_name` and
 * `timezone`. Goal/body validators and unit conversions live in
 * `onboarding-form.ts` (shared with the wizard) — do NOT duplicate them here.
 *
 * No UI, no I/O, no logging (PII discipline N4) — validators return friendly copy
 * and never echo the rejected value.
 */

/** Mirrors the DB `profiles.display_name` check: `char_length(display_name) <= 80`. */
export const DISPLAY_NAME_MAX = 80;

/**
 * Validate the (optional) display name. Empty is allowed (→ stored as null, see
 * `normalizeDisplayName`); only the length cap is enforced client-side (SF4).
 */
export function validateDisplayName(raw: string): string | undefined {
  if (raw.trim().length > DISPLAY_NAME_MAX) {
    return `Name must be ${DISPLAY_NAME_MAX} characters or fewer.`;
  }
  return undefined;
}

/** Coerce a display-name input to its stored form: trimmed, empty → null (SF4). */
export function normalizeDisplayName(raw: string): string | null {
  return raw.trim() || null;
}

/**
 * The device's IANA timezone (e.g. "America/New_York"), or null if `Intl` is
 * unavailable / returns nothing (N3). Used by the "Use device timezone" heal
 * action; never throws.
 */
export function getDeviceTimezone(): string | null {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz || null;
  } catch {
    return null;
  }
}

/**
 * The `profiles.timezone` column default (`20260619102510_initial_schema.sql`:
 * `timezone text not null default 'UTC'`). A stored value equal to this is treated
 * as "never set" by `resolveTimezone` — see the invariant there.
 */
const DB_DEFAULT_TIMEZONE = 'UTC';

/** Can this device's `Intl` actually construct a formatter for `tz`? (Guards the
 *  formatter's silent UTC fallback on an unknown/cross-device zone — plan 0022 SF3.) */
function isConstructableZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the timezone the daily/weekly buckets should use (plan 0022). A stored
 * zone is honored ONLY if it's a real, explicitly-set, constructable IANA zone;
 * otherwise we fall back to the device zone.
 *
 * INVARIANT: a stored value equal to `DB_DEFAULT_TIMEZONE` ('UTC') is treated as
 * "unset" and overridden by the device zone. This is safe because the ONLY writer
 * of a real zone today is the Settings "Use device timezone" heal (which writes the
 * *device* zone) — there is no free-text timezone entry, so a stored 'UTC' is
 * unambiguously the DB default, never a deliberate choice. A user genuinely in UTC
 * has a device zone of 'UTC' too, so the result is still 'UTC' — no misfire. A
 * future "pick your timezone" UI that could persist a literal 'UTC' for a non-UTC
 * user MUST revisit this rule.
 *
 * Pure, no I/O, never logs the value.
 */
export function resolveTimezone(storedTz: string | null | undefined): string {
  const tz = storedTz?.trim();
  if (tz && tz !== DB_DEFAULT_TIMEZONE && isConstructableZone(tz)) return tz;
  return getDeviceTimezone() ?? DB_DEFAULT_TIMEZONE;
}

/** Human-facing display for a stored timezone value (N3): null/blank → "Not set". */
export function timezoneDisplay(timezone: string | null | undefined): string {
  const tz = timezone?.trim();
  return tz ? tz : 'Not set';
}
