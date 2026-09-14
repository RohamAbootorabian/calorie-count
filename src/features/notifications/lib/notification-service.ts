/**
 * Thin `expo-notifications` wrapper for smart LOCAL meal reminders (plan 0040).
 * LOCAL only — no push tokens, no server. "Smart" is achieved by scheduling
 * single-fire DATE triggers and RECONCILING them (cancel + re-arm) at three moments:
 * app foreground, after a successful meal save, and when settings change. Because the
 * only way to log a meal is inside the app, every log is a code point where we cancel
 * that window's pending reminder — so a reminder fires iff no meal was logged in its
 * window by its time.
 *
 * WEB: every entry point no-ops (`Platform.OS === 'web'`), AND the top-level handler
 * registration is web-guarded — in-function guards don't protect import-time code,
 * which runs on web (plan 0040 R2). This keeps `expo export --platform web` clean.
 *
 * CONCURRENCY (R1/B1): `reconcile` is serialized behind a promise chain so overlapping
 * triggers (foreground racing an after-save) can't double-schedule.
 *
 * LEAK-SAFETY (R6): a failed cancel ABORTS scheduling (never schedule a fresh set over
 * an uncleared old one → drift toward iOS's 64-pending cap). We cancel ONLY our own
 * notifications, matched by `content.data.kind` (never cancelAllScheduledNotificationsAsync).
 *
 * PRIVACY (R9/R10): the body carries only a fixed string + the reminder's closed-enum
 * label; `data` carries only `{ kind }` — never a dish name, allergen, condition, time,
 * or eaten_at. Nothing here logs the error, the meals, or any metric.
 */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/database';

import { loadPrefs } from './reminder-prefs';
import {
  isWindowSatisfied,
  localMinutesOfDay,
  nextOccurrence,
  normalizeReminders,
  startOfLocalDay,
  type Reminder,
} from './reminders';

const KIND = 'meal-reminder';
const isWeb = Platform.OS === 'web';

// Foreground presentation: a banner in the list, no sound/badge. SDK 56 field names
// (shouldShowBanner/shouldShowList replace the deprecated shouldShowAlert — R3).
// Top-level, so web-guarded (R2) — this line runs at import time.
if (!isWeb) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

/** Only the column reconcile reads — typed allowlist so a widening is a compile error (R11). */
type MealTimeRow = Pick<Database['public']['Tables']['meal_logs']['Row'], 'eaten_at'>;
const SELECT_COLUMNS = 'eaten_at';

/** Ask for (or confirm) notification permission. Returns whether it's granted. */
export async function ensurePermission(): Promise<boolean> {
  if (isWeb) return false;
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    if (!current.canAskAgain) return false;
    const req = await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowBadge: false, allowSound: false },
    });
    return req.granted;
  } catch {
    return false;
  }
}

/** Whether notifications are currently granted at the OS level (R5 — detect revoke). */
export async function hasPermission(): Promise<boolean> {
  if (isWeb) return false;
  try {
    return (await Notifications.getPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

/** Cancel ONLY our reminders (matched by data.kind). Throws on failure so the caller
 *  can abort scheduling (R6). */
async function cancelOurs(): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  for (const n of scheduled) {
    if ((n.content.data as { kind?: string } | null)?.kind === KIND) {
      await Notifications.cancelScheduledNotificationAsync(n.identifier);
    }
  }
}

/** Public: cancel our reminders, swallowing errors (sign-out / disable). */
export async function cancelAllReminders(): Promise<void> {
  if (isWeb) return;
  try {
    await cancelOurs();
  } catch {
    // best-effort
  }
}

async function scheduleOne(r: Reminder, date: Date): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Calorie Counter',
      body: `Time to log your ${r.label} 🍽️`,
      data: { kind: KIND },
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date },
  });
}

/** Query today's meal times (device-local) for the owner. Owner-filtered, single
 *  column. Returns null on failure (→ reconcile leaves the existing schedule intact). */
async function todaysMealMinutes(userId: string): Promise<number[] | null> {
  const sinceIso = startOfLocalDay(new Date()).toISOString();
  const { data, error } = await supabase
    .from('meal_logs')
    .select(SELECT_COLUMNS)
    .eq('user_id', userId) // mandatory in-code owner filter (defense-in-depth + index).
    .gte('eaten_at', sinceIso);
  if (error || data == null) return null;
  return (data as unknown as MealTimeRow[]).map((row) => localMinutesOfDay(new Date(row.eaten_at)));
}

/** The un-serialized reconcile body. */
async function doReconcile(userId: string): Promise<void> {
  if (isWeb) return;

  const prefs = await loadPrefs(userId);
  if (!prefs.enabled) {
    await cancelAllReminders();
    return;
  }
  // Don't schedule into a black hole if permission was revoked after enabling (R5).
  if (!(await hasPermission())) {
    await cancelAllReminders();
    return;
  }

  const mealMinutes = await todaysMealMinutes(userId);
  if (mealMinutes == null) return; // query failed — leave the current schedule untouched.

  const sorted = normalizeReminders(prefs.reminders);
  const now = new Date();
  const desired = sorted.map((r, i) => ({
    reminder: r,
    date: nextOccurrence(r, now, isWindowSatisfied(sorted, i, mealMinutes)),
  }));

  // Cancel-then-schedule. A failed cancel ABORTS (don't stack a fresh set — R6).
  try {
    await cancelOurs();
  } catch {
    return;
  }
  for (const { reminder, date } of desired) {
    await scheduleOne(reminder, date);
  }
}

// Serialize reconcile so overlapping triggers never double-schedule (R1/B1).
let chain: Promise<void> = Promise.resolve();

/** Re-arm reminders for `userId`. Serialized + best-effort (never rejects). */
export function reconcile(userId: string): Promise<void> {
  if (isWeb) return Promise.resolve();
  chain = chain.then(() => doReconcile(userId)).catch(() => {
    // Swallow — reminders must never surface an error to the UI (R10: no arg logging).
  });
  return chain;
}
