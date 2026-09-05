/**
 * Date field (plan 0028) — NATIVE: a tappable field that opens the platform calendar
 * (`@react-native-community/datetimepicker`, `mode="date"`). Emits ONLY a valid
 * NOON-LOCAL `Date` of the chosen day (the noon time component keeps the tz buckets on
 * the intended calendar day; see plan 0028). Web has its own `.web.tsx` fallback so the
 * web bundle never imports this native module.
 *
 * PRIVACY: renders the date as plain text; never logs it.
 */
import DateTimePicker from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

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
  const hasError = !!error;

  return (
    <View style={styles.container}>
      {label ? (
        <Text type="smallBold" themeColor="textSecondary" style={styles.label}>
          {label}
        </Text>
      ) : null}

      <Pressable
        onPress={() => setOpen(true)}
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

      {open ? (
        <DateTimePicker
          value={Number.isNaN(value.getTime()) ? new Date() : value}
          mode="date"
          display={Platform.OS === 'ios' ? 'inline' : 'default'}
          maximumDate={maximumDate}
          // v9 API: `onValueChange` (a day was picked) + `onDismiss` (closed) replace the
          // deprecated `onChange`.
          onValueChange={(_event, picked) => {
            setOpen(false);
            if (picked) onChange(noonLocal(picked));
          }}
          onDismiss={() => setOpen(false)}
        />
      ) : null}

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
});
