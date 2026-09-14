/**
 * Time field (plan 0040) — WEB fallback. A text `Input` (`HH:MM`, 24h) with strict
 * parsing; the native `.tsx` (time picker) is device-only, so web never imports the
 * native module. Emits `hour`/`minute` only on a valid parse; an invalid/partial value
 * keeps the last valid time and shows an inline error.
 */
import { useState } from 'react';

import { Input } from './input';

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

/** Strict `HH:MM` → {hour, minute}, or null. */
function parseHm(text: string): { hour: number; minute: number } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

export function TimeField({ label, hour, minute, onChange, error }: TimeFieldProps) {
  const [text, setText] = useState(() => formatHm(hour, minute));
  const [localError, setLocalError] = useState<string>();

  return (
    <Input
      label={label}
      value={text}
      onChangeText={(next) => {
        setText(next);
        const parsed = parseHm(next);
        if (parsed) {
          setLocalError(undefined);
          onChange(parsed.hour, parsed.minute);
        } else {
          setLocalError('Use the format HH:MM (24h).');
        }
      }}
      error={localError ?? error}
      placeholder="HH:MM"
      autoCapitalize="none"
      autoCorrect={false}
      keyboardType="numbers-and-punctuation"
    />
  );
}
