/**
 * Mounts the reminder reconcile lifecycle ONCE in the signed-in area (plan 0040),
 * alongside `useTimezoneHeal` in `(app)/_layout`. It re-arms reminders on:
 *   - mount / user change (`[userId]` dep),
 *   - app foreground (AppState → 'active' ONLY — 'change' also fires for iOS
 *     'inactive' from the app-switcher/sheets/calls, which we ignore; mirrors
 *     `use-current-day-key`).
 * After a successful meal save, the capture/edit screens call `reconcile(userId)`
 * directly so the just-satisfied window's reminder is cancelled immediately.
 *
 * Holds NO state and calls only the fire-and-forget async `reconcile`/`cancelAllReminders`
 * (never setState in the effect) — clean under React Compiler / strict react-hooks.
 * On sign-out (`userId` null) it cancels our scheduled reminders.
 */
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { useUser } from '@/lib/auth';

import { cancelAllReminders, reconcile } from './notification-service';

export function useReminders(): void {
  const { user } = useUser();
  const userId = user?.id ?? null;

  useEffect(() => {
    if (!userId) {
      void cancelAllReminders(); // signed out — drop any pending reminders.
      return;
    }
    void reconcile(userId); // on mount / account switch.
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') void reconcile(userId);
    });
    return () => {
      sub.remove(); // EmitterSubscription (RN 0.85 has no static removeEventListener).
    };
  }, [userId]);
}
