/**
 * Pure time/window helpers for smart meal reminders (plan 0040). NO React, NO
 * expo-notifications, NO AsyncStorage imports — just data → data, so the tricky
 * window/next-occurrence math is isolated and trivially reasoned about.
 *
 * "Smart" = a reminder fires ONLY if no meal was logged in its window today. The
 * window for the i-th (sorted) reminder is `(prevReminderMinutes, thisReminderMinutes]`
 * in DEVICE-LOCAL minutes-of-day; the first reminder's window opens at start-of-day.
 *
 * All time math is DEVICE-LOCAL on purpose: a 9am nudge should fire at 9am wherever
 * the phone is (unlike the dashboard, which buckets "today" by the profile timezone).
 * Using `Date.getHours()`/`getMinutes()` also sidesteps the Hermes/full-ICU `timeZone`
 * caveat that affects the Intl-based day bucketing elsewhere.
 */

/** A closed set of labels (plan 0040 R9 — NEVER user free-text; it renders on the lock screen). */
export type ReminderLabel = 'breakfast' | 'lunch' | 'dinner';

export type Reminder = {
  id: string;
  hour: number; // 0–23, device-local
  minute: number; // 0–59
  label: ReminderLabel;
};

export type ReminderPrefs = {
  enabled: boolean;
  reminders: Reminder[];
};

/** Default: three distinct daily checkpoints, OFF until the user opts in. */
export const DEFAULT_REMINDERS: Reminder[] = [
  { id: 'breakfast', hour: 9, minute: 0, label: 'breakfast' },
  { id: 'lunch', hour: 13, minute: 0, label: 'lunch' },
  { id: 'dinner', hour: 20, minute: 0, label: 'dinner' },
];

export const DEFAULT_PREFS: ReminderPrefs = { enabled: false, reminders: DEFAULT_REMINDERS };

/** Minute-of-day (0–1439) of a reminder. */
export function reminderMinutes(r: Reminder): number {
  return r.hour * 60 + r.minute;
}

/** Minute-of-day (0–1439) of a Date in the DEVICE-LOCAL zone. */
export function localMinutesOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

/** A sorted-by-time copy; then collapse any that share a minute (R4 — an empty
 *  window can never be satisfied and would fire twice at the same minute). */
export function normalizeReminders(reminders: Reminder[]): Reminder[] {
  const sorted = [...reminders].sort((a, b) => reminderMinutes(a) - reminderMinutes(b));
  const seen = new Set<number>();
  const out: Reminder[] = [];
  for (const r of sorted) {
    const m = reminderMinutes(r);
    if (seen.has(m)) continue;
    seen.add(m);
    out.push(r);
  }
  return out;
}

/**
 * True iff any logged-today meal falls in reminder `i`'s window `(prev, this]`.
 * `sorted` MUST be normalized. `mealMinutes` are device-local minutes-of-day of
 * TODAY's meals only.
 */
export function isWindowSatisfied(sorted: Reminder[], i: number, mealMinutes: number[]): boolean {
  const thisMin = reminderMinutes(sorted[i]);
  // First window opens at start-of-day: prev = -1 so a 00:00 meal counts in (−1, this].
  const prevMin = i === 0 ? -1 : reminderMinutes(sorted[i - 1]);
  return mealMinutes.some((m) => m > prevMin && m <= thisMin);
}

/**
 * The concrete `Date` at which reminder `r` should next fire: today at h:m if that
 * is still in the FUTURE and the window is NOT already satisfied; otherwise tomorrow
 * at h:m (always unsatisfied at schedule time — the next foreground re-reconciles).
 * Uses `>` at the exact-minute boundary (a reminder due this very minute rolls to
 * tomorrow rather than firing in the past).
 */
export function nextOccurrence(r: Reminder, now: Date, satisfiedToday: boolean): Date {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), r.hour, r.minute, 0, 0);
  if (!satisfiedToday && today.getTime() > now.getTime()) return today;
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, r.hour, r.minute, 0, 0);
  return tomorrow;
}

/** Start of the device-local day for `now` (used to bound the "today's meals" query). */
export function startOfLocalDay(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
}

/** `HH:MM` (24h, locale-free) for display. */
export function formatHm(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}
