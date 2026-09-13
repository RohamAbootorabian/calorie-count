/**
 * Date field (plan 0028) — NATIVE: a tappable field that opens the platform calendar
 * (`@react-native-community/datetimepicker`, `mode="date"`) inside a CENTERED modal
 * card (design tweak). Emits ONLY a valid NOON-LOCAL `Date` of the chosen day (the noon
 * time component keeps the tz buckets on the intended calendar day; see plan 0028). Web
 * has its own `.web.tsx` fallback so the web bundle never imports this native module.
 *
 * The calendar stays open (a `draft` day tracks taps) so the user can browse months;
 * "Done" commits the draft, a backdrop tap / "Cancel" discards it.
 *
 * PRIVACY: renders the date as plain text; never logs it.
 */
import DateTimePicker from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, View } from 'react-native';

import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { Text } from './text';

export type DateFieldProps = {
  label?: string;
  value: Date;
  onChange: (d: Date) => void;
  maximumDate?: Date;
  error?: string;
};

/** Noon of the local calendar day of `d` — DST-/tz-skew-safe for day bucketing. */
function noonLocal(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0);
}

/** Locale-free `YYYY-MM-DD` in the DEVICE-LOCAL zone (matches the bucket key format). */
export function formatLocalDate(d: Date): string {
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function DateField({ label, value, onChange, maximumDate, error }: DateFieldProps) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  // Draft day tracked while the modal is open; committed on "Done", dropped otherwise.
  const [draft, setDraft] = useState<Date | null>(null);
  const hasError = !!error;

  const safeValue = Number.isNaN(value.getTime()) ? new Date() : value;

  function openPicker() {
    setDraft(safeValue);
    setOpen(true);
  }
  function cancel() {
    setOpen(false);
    setDraft(null);
  }
  function confirm() {
    if (draft) onChange(noonLocal(draft));
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
          {formatLocalDate(value)}
        </Text>
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={cancel} // Android hardware-back.
        accessibilityViewIsModal
      >
        {/* Dark backdrop fills the whole screen; a tap discards the draft. */}
        <Pressable style={styles.backdrop} onPress={cancel} accessibilityRole="button">
          {/* The centered card: its own no-op Pressable swallows taps so they don't
              bubble to the backdrop. */}
          <Pressable
            style={[styles.card, { backgroundColor: theme.background }]}
            onPress={() => {}}
          >
            {label ? (
              <Text type="subtitle" style={[styles.cardTitle, { color: theme.text }]}>
                {label}
              </Text>
            ) : null}

            <DateTimePicker
              value={draft ?? safeValue}
              mode="date"
              display={Platform.OS === 'ios' ? 'inline' : 'default'}
              maximumDate={maximumDate}
              // Tint the iOS calendar (selected day, arrows, highlights) with the app's
              // brand green instead of the platform default blue.
              accentColor={theme.primary}
              // v9 API: `onValueChange` (a day was picked) + `onDismiss` (closed) replace
              // the deprecated `onChange`. We only track the draft; commit is via "Done".
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

      {/* One reserved line so toggling the error never reflows siblings (mirrors Input). */}
      <Text
        type="small"
        themeColor={hasError ? undefined : 'textSecondary'}
        numberOfLines={1}
        style={[styles.helper, hasError && { color: theme.danger }]}
      >
        {error ?? ' '}
      </Text>
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
