/**
 * One-time device-timezone heal (plan 0024). Behavior is already correct — the
 * daily/weekly buckets resolve a stored `'UTC'` to the device zone via
 * `resolveTimezone` (0022) — but the STORED `profiles.timezone` stays the DB
 * default `'UTC'` until the user manually taps Settings → "Use device timezone",
 * so Settings shows the wrong zone. This heals that value automatically.
 *
 * Mounted once in the authenticated area (`(app)/_layout.tsx`), so it runs once per
 * signed-in session and covers BOTH new (post-onboarding) and existing accounts.
 *
 * Behavior note (0024 review SF1): persisting a concrete zone flips the resolver
 * from "follow the current device zone" (its behavior for a stored `'UTC'`) to
 * "the stored zone is authoritative" — a traveler is then pinned to the healed
 * zone until they re-heal in Settings. Accepted (same as a manual heal).
 *
 * Best-effort: a single-column conditional UPDATE (never an upsert → can't clobber
 * `display_name`/`units`), scoped to the caller's own still-default row, fire-and-
 * forget, rejection swallowed. PRIVACY: never log the tz or the error.
 */
import { useEffect, useRef } from 'react';

import { useUser } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

import { DB_DEFAULT_TIMEZONE, getDeviceTimezone } from './profile-form';

export function useTimezoneHeal(): void {
  const { user } = useUser();
  const userId = user?.id ?? null;
  // Defensive only — the `[userId]` dep + the `.eq('timezone', DB_DEFAULT_TIMEZONE)`
  // idempotency are the real guarantees; a remount just re-fires a harmless 0-row UPDATE.
  const healedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!userId || healedFor.current === userId) return;
    const device = getDeviceTimezone();
    // Nothing to heal if Intl gave us nothing, or the device is genuinely UTC.
    if (!device || device === DB_DEFAULT_TIMEZONE) return;
    healedFor.current = userId;

    // Heal ONLY a still-default row, touching ONLY the timezone column. Owner-scoped
    // by `.eq('id')` on top of the `profiles_update` RLS (WITH CHECK auth.uid() = id).
    // The two-arg `.then` executes the builder AND swallows a rejected promise; a
    // resolved `{ error }` is dropped by the empty onFulfilled. Never logs.
    void supabase
      .from('profiles')
      .update({ timezone: device })
      .eq('id', userId)
      .eq('timezone', DB_DEFAULT_TIMEZONE)
      .then(
        () => {},
        () => {},
      );
  }, [userId]);
}
