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

/** Human-facing display for a stored timezone value (N3): null/blank → "Not set". */
export function timezoneDisplay(timezone: string | null | undefined): string {
  const tz = timezone?.trim();
  return tz ? tz : 'Not set';
}
