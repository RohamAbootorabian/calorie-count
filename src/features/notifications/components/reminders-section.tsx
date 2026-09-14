/**
 * Settings → Reminders section (plan 0040). Master on/off + per-reminder time (the
 * three fixed daily checkpoints; edit-time-only in v1). Device-local prefs
 * (AsyncStorage), so it saves independently of the Supabase profile/goals Saves:
 * every change persists immediately and re-arms the schedule via `reconcile`.
 *
 * Enabling asks for OS permission; if denied (or revoked later) it shows a note and
 * stays off rather than scheduling into a black hole (plan 0040 R5). Self-contained
 * (owns its state + a `mounted` ref for the async prefs/permission reads) so the
 * settings screen just drops it in.
 *
 * PRIVACY: labels are a closed enum, shown/stored generically; nothing here logs prefs.
 */
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useUser } from '@/lib/auth';
import { Button, Card, Text, TimeField } from '@/shared/ui';

import {
  cancelAllReminders,
  ensurePermission,
  hasPermission,
  reconcile,
} from '../lib/notification-service';
import { loadPrefs, savePrefs } from '../lib/reminder-prefs';
import { DEFAULT_PREFS, type ReminderPrefs } from '../lib/reminders';

function titleCase(label: string): string {
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function RemindersSection() {
  const { user } = useUser();
  const userId = user?.id ?? null;

  // Starts at defaults (reminders OFF) so the effect never setStates synchronously; the
  // stored prefs load in an async callback and flip this once resolved.
  const [prefs, setPrefs] = useState<ReminderPrefs>(DEFAULT_PREFS);
  const [permBlocked, setPermBlocked] = useState(false);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Load prefs for the current user; if enabled, verify OS permission is still granted.
  useEffect(() => {
    if (!userId) return;
    let active = true;
    loadPrefs(userId).then(async (loaded) => {
      if (!active || !mounted.current) return;
      setPrefs(loaded);
      if (loaded.enabled) {
        const granted = await hasPermission();
        if (active && mounted.current) setPermBlocked(!granted);
      }
    });
    return () => {
      active = false;
    };
  }, [userId]);

  async function persist(next: ReminderPrefs) {
    if (!userId) return;
    setPrefs(next);
    await savePrefs(userId, next);
    void reconcile(userId);
  }

  async function toggleEnabled(next: boolean) {
    if (!userId) return;
    if (next) {
      const granted = await ensurePermission();
      if (!mounted.current) return;
      if (!granted) {
        setPermBlocked(true);
        return; // leave reminders off; the note tells them to enable in iOS Settings.
      }
      setPermBlocked(false);
    } else {
      void cancelAllReminders();
    }
    await persist({ ...prefs, enabled: next });
  }

  function setTime(id: string, hour: number, minute: number) {
    void persist({
      ...prefs,
      reminders: prefs.reminders.map((r) => (r.id === id ? { ...r, hour, minute } : r)),
    });
  }

  return (
    <Card style={styles.section}>
      <Text type="subtitle">Reminders</Text>
      <Text type="small" themeColor="textSecondary">
        Get a nudge to log a meal — but only when you haven&apos;t logged one yet.
      </Text>

      <View style={styles.group}>
        <Text type="smallBold" themeColor="textSecondary">
          Meal reminders
        </Text>
        <Button
          variant={prefs.enabled ? 'primary' : 'secondary'}
          onPress={() => toggleEnabled(true)}
          fullWidth>
          On
        </Button>
        <Button
          variant={!prefs.enabled ? 'primary' : 'secondary'}
          onPress={() => toggleEnabled(false)}
          fullWidth>
          Off
        </Button>
      </View>

      {permBlocked ? (
        <Text type="small" themeColor="danger">
          Notifications are turned off for Calorie Counter. Enable them in your device Settings to get
          reminders.
        </Text>
      ) : null}

      {prefs.enabled && !permBlocked
        ? prefs.reminders.map((r) => (
            <TimeField
              key={r.id}
              label={titleCase(r.label)}
              hour={r.hour}
              minute={r.minute}
              onChange={(hour, minute) => setTime(r.id, hour, minute)}
            />
          ))
        : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: Spacing.three,
    marginBottom: Spacing.four,
  },
  group: {
    gap: Spacing.two,
  },
});
