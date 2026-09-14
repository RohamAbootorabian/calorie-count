/**
 * Reminder prefs persistence (plan 0040) — DEVICE-LOCAL, in AsyncStorage, keyed by
 * user id. Notifications are inherently per-device, so prefs never sync to Supabase
 * (a schedule set on the phone shouldn't arm on a second device). Keying by userId
 * isolates accounts on a shared device.
 *
 * Load is FAIL-SAFE: a missing key, corrupt JSON, or a shape mismatch returns the
 * defaults (reminders OFF) — never throws. On sign-out we cancel notifications
 * (notification-service) but intentionally KEEP the stored prefs for re-login
 * convenience (generic labels + times only — no health PII; see reminders.ts R9).
 *
 * PRIVACY: never log the prefs or the error (plan 0040 R10).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  DEFAULT_PREFS,
  type Reminder,
  type ReminderLabel,
  type ReminderPrefs,
} from './reminders';

const KEY_PREFIX = 'reminder-prefs:v1:';

function keyFor(userId: string): string {
  return `${KEY_PREFIX}${userId}`;
}

const VALID_LABELS: ReminderLabel[] = ['breakfast', 'lunch', 'dinner'];

/** Narrow an unknown parsed value to a valid Reminder, or null. */
function toReminder(v: unknown): Reminder | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  const { id, hour, minute, label } = r;
  if (typeof id !== 'string') return null;
  if (typeof hour !== 'number' || !Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  if (typeof minute !== 'number' || !Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  if (typeof label !== 'string' || !VALID_LABELS.includes(label as ReminderLabel)) return null;
  return { id, hour, minute, label: label as ReminderLabel };
}

/** Narrow an unknown parsed value to valid prefs, or null (→ caller falls back to defaults). */
function toPrefs(v: unknown): ReminderPrefs | null {
  if (!v || typeof v !== 'object') return null;
  const p = v as Record<string, unknown>;
  if (typeof p.enabled !== 'boolean' || !Array.isArray(p.reminders)) return null;
  const reminders: Reminder[] = [];
  for (const item of p.reminders) {
    const r = toReminder(item);
    if (!r) return null;
    reminders.push(r);
  }
  if (reminders.length === 0) return null;
  return { enabled: p.enabled, reminders };
}

/** Read prefs for `userId`; defaults (OFF) on absence/corruption. Never throws. */
export async function loadPrefs(userId: string): Promise<ReminderPrefs> {
  try {
    const raw = await AsyncStorage.getItem(keyFor(userId));
    if (!raw) return DEFAULT_PREFS;
    return toPrefs(JSON.parse(raw) as unknown) ?? DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}

/** Persist prefs for `userId`. Best-effort; never throws. */
export async function savePrefs(userId: string, prefs: ReminderPrefs): Promise<void> {
  try {
    await AsyncStorage.setItem(keyFor(userId), JSON.stringify(prefs));
  } catch {
    // Swallow — a failed pref write only means the schedule isn't remembered next launch.
  }
}
