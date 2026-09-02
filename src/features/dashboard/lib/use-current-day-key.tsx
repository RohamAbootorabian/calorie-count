/**
 * The current calendar day (`YYYY-MM-DD` in `tz`), kept LIVE (plan 0023). The
 * daily/weekly totals hooks bucket against "today"; without this, "today" is
 * computed once inside their `useMemo` and frozen until a refetch — so the view
 * doesn't roll over at local midnight while the app is open or on resume from
 * background (`useFocusEffect` fires on navigation focus, not on app resume).
 *
 * This returns a day-key that advances immediately on foreground and within ~60 s
 * of midnight while left open. Feeding it into the totals hooks' bucket memo (as a
 * dep) makes the roll a pure re-bucket of the already-fetched rows — no refetch.
 *
 * REACT COMPILER (B1): the key is a `useMemo` keyed on `[tz, tick]`, NOT a bare
 * render expression. A render-computed `new Date()` would be memoized by the
 * compiler on its only reactive input `tz` and never advance on a tick; threading
 * `tick` in as a real dependency forces a fresh `new Date()` read each fire. `tz`
 * stays a dep so a late `profile.timezone` re-syncs with no `setState`-in-effect.
 *
 * LINT-SAFE: the effect body only registers the interval + AppState listener and
 * returns a cleanup; `bump` fires from those CALLBACKS, never synchronously in the
 * effect body (no `react-hooks/set-state-in-effect`); no ref reads in render.
 *
 * PRIVACY: never log the tz or the day key — static strings only.
 */
import { useEffect, useMemo, useReducer } from 'react';
import { AppState } from 'react-native';

import { makeDayFormatter } from './day-formatter';

const TICK_MS = 60_000;

export function useCurrentDayKey(tz: string): string {
  const [tick, bump] = useReducer((n: number) => n + 1, 0);

  // `tick` is a genuine dep so the compiler can't freeze the key on [tz] alone (B1).
  // `void tick` consumes it in-body so exhaustive-deps sees a real use (not a
  // "remove this dep" warning) — the value itself is unused; the read forces a
  // fresh `new Date()` each tick.
  const todayKey = useMemo(() => {
    void tick;
    return makeDayFormatter(tz).format(new Date());
  }, [tz, tick]);

  useEffect(() => {
    const id = setInterval(bump, TICK_MS);
    // Only 'active' — 'change' also fires for iOS 'inactive' (app-switcher, sheets,
    // calls), which we must ignore.
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') bump();
    });
    return () => {
      clearInterval(id);
      sub.remove(); // EmitterSubscription (RN 0.85 has no static removeEventListener).
    };
  }, []);

  return todayKey;
}
