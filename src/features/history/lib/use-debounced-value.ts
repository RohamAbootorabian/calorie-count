/**
 * Debounce a rapidly-changing value (plan 0033) — used for the History search box so
 * we fire one server query after the user pauses, not one per keystroke. Initialised
 * to the current value (the first paint queries immediately, no blank delay), and the
 * pending timer is cleared on every change / unmount.
 */
import { useEffect, useState } from 'react';

export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);

  return debounced;
}
