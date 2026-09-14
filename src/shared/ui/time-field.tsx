/**
 * Time field (plan 0040) — NATIVE: a tappable field that opens the platform time
 * picker (`@react-native-community/datetimepicker`, `mode="time"`) in a CENTERED modal
 * card, mirroring `DateField`. Emits the chosen `hour`/`minute` (device-local, 24h).
 * Web has its own `.web.tsx` fallback so the web bundle never imports this native module.
 *
 * A `draft` tracks the in-progress pick; "Done" commits it, backdrop/"Cancel" discards.
 * PRIVACY: renders the time as plain text; never logs it.
 */
import DateTimePicker from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, View } from 'react-native';

import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { Text } from './text';

export type TimeFieldProps = {
  label?: string;
  hour: number;
  minute: number;
  onChange: (hour: number, minute: number) => void;
  error?: string;
};

/** `HH:MM` (24h, locale-free). */
export function formatHm(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** A Date on today's calendar day at h:m (the picker needs a Date value). */
function dateAt(hour: number, minute: number): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0);
}

export function TimeField({ label, hour, minute, onChange, error }: TimeFieldProps) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Date | null>(null);
  const hasError = !!error;

  function openPicker() {
    setDraft(dateAt(hour, minute));
    setOpen(true);
  }
  function cancel() {
    setOpen(false);
    setDraft(null);
  }
  function confirm() {
    if (draft) onChange(draft.getHours(), draft.getMinutes());
    setOpen(false);
    setDraft(null);
  }

  return (
    <View style={styles.container}>
      {label ? (
        <Text type="smallBold" themeColor="textSecondary" style={styles.label}>
          {label}
        </Text>
      ) : null}

      <Pressable
        onPress={openPicker}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={[
          styles.field,
          { borderColor: hasError ? theme.danger : theme.border, backgroundColor: theme.background },
        ]}
      >
        <Text type="default" style={{ color: theme.text }}>
          {formatHm(hour, minute)}
        </Text>
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={cancel}
        accessibilityViewIsModal
      >
        <Pressable style={styles.backdrop} onPress={cancel} accessibilityRole="button">
          <Pressable style={[styles.card, { backgroundColor: theme.background }]} onPress={() => {}}>
            {label ? (
              <Text type="subtitle" style={[styles.cardTitle, { color: theme.text }]}>
                {label}
              </Text>
            ) : null}

            <DateTimePicker
              value={draft ?? dateAt(hour, minute)}
              mode="time"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              accentColor={theme.primary}
              onValueChange={(_event, picked) => {
                if (picked) setDraft(picked);
              }}
              onDismiss={cancel}
            />

            <View style={styles.actions}>
              <Pressable onPress={cancel} accessibilityRole="button" hitSlop={Spacing.two}>
                <Text type="default" style={{ color: theme.textSecondary }}>
                  Cancel
                </Text>
              </Pressable>
              <Pressable onPress={confirm} accessibilityRole="button" hitSlop={Spacing.two}>
                <Text type="default" style={{ color: theme.primary, fontWeight: '700' }}>
                  Done
                </Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {error ? (
        <Text
          type="small"
          numberOfLines={1}
          style={[styles.helper, { color: theme.danger }]}
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignSelf: 'stretch' },
  label: { marginBottom: Spacing.one },
  field: {
    minHeight: 48,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.three,
    justifyContent: 'center',
  },
  helper: { minHeight: 20, marginTop: Spacing.one },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.four,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    borderRadius: Radius.lg,
    padding: Spacing.four,
  },
  cardTitle: { marginBottom: Spacing.two, textAlign: 'center' },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Spacing.five,
    marginTop: Spacing.two,
  },
});
