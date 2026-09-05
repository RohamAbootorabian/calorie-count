/**
 * Date field (plan 0028) — WEB fallback. A text `Input` (`YYYY-MM-DD`) with strict
 * parsing; the native `.tsx` (calendar picker) is device-only, so web never imports the
 * native module. Emits ONLY a valid NOON-LOCAL `Date` (parsed from PARTS — NEVER
 * `new Date(str)`, which is UTC-midnight and would land a day early west of UTC, plan
 * 0028 B1/B2). An invalid/partial value does NOT emit (keeps the last valid date) and
 * shows an inline error, so `toSavePayload`'s `toISOString()` can never see an Invalid Date.
 */
import { useState } from 'react';

import { Input } from './input';

export type DateFieldProps = {
  label?: string;
  value: Date;
  onChange: (d: Date) => void;
  maximumDate?: Date;
  error?: string;
};

/** Locale-free `YYYY-MM-DD` in the device-local zone. */
export function formatLocalDate(d: Date): string {
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Strict `YYYY-MM-DD` → noon-local Date, or null (invalid / normalized-overflow). */
function parseLocalDate(text: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim());
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(y, m - 1, d, 12, 0, 0); // noon-local, from parts.
  // Reject overflow-normalized inputs (e.g. 2026-02-31 → Mar 3).
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  return date;
}

export function DateField({ label, value, onChange, error }: DateFieldProps) {
  const [text, setText] = useState(() => formatLocalDate(value));
  const [localError, setLocalError] = useState<string>();

  return (
    <Input
      label={label}
      value={text}
      onChangeText={(next) => {
        setText(next);
        const parsed = parseLocalDate(next);
        if (parsed) {
          setLocalError(undefined);
          onChange(parsed);
        } else {
          setLocalError('Use the format YYYY-MM-DD.');
        }
      }}
      error={localError ?? error}
      placeholder="YYYY-MM-DD"
      autoCapitalize="none"
      autoCorrect={false}
      keyboardType="numbers-and-punctuation"
    />
  );
}
