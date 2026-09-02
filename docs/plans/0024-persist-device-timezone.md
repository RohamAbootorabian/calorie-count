# Plan: Persist the device timezone (heal the stored 'UTC' default) — DB honesty

- **Status**: **Draft** → In Review → Approved → In Progress → Done
- **Plan #**: 0024
- **Created**: 2026-09-02

## Problem / Goal
Behavior is already correct (0022's `resolveTimezone` treats a stored `'UTC'` as "unset" and buckets
by the device zone), but the STORED value stays `'UTC'` for every account that never tapped
Settings → "Use device timezone". So Settings shows "UTC" for a user who is really in Tehran, and
the DB doesn't reflect reality. This plan makes the stored zone honest — **once, automatically** —
for both new and existing accounts, without changing behavior (the resolver already handles that).

**"Done" =** a signed-in user whose `profiles.timezone` is still the DB default `'UTC'` while their
device reports a real non-UTC zone gets that zone written to `profiles.timezone` automatically
(once per session, best-effort), so Settings shows the real zone; a user genuinely in UTC, or one
who already has a real stored zone (healed manually or by this feature), is left untouched; no other
profile column is affected; `tsc`/`lint`/web-bundle green. Pure client, no migration.

## Non-goals
- **No behavior change.** Bucketing is already correct via `resolveTimezone` (0022). This is DB
  honesty only; if this write never lands (offline), the app is still correct.
- **No onboarding-wizard change.** A single heal-on-load mechanism (below) covers new accounts too
  (post-onboarding they land in `(app)` → the heal runs), so we do NOT add a second write path in
  the onboarding save flow — which avoids the fire-and-forget-vs-`refetch()` and partial-upsert
  clobber hazards the 0022 review flagged.
- **No overwrite of a real stored zone.** Only the literal default `'UTC'` is healed; a
  deliberately/previously-set real zone (incl. the Settings heal) is never touched.
- **No new column / no migration / no read query.** A conditional UPDATE of the existing column.
- **No forced refresh of an open Settings screen.** The healed value shows on the next profile load
  (Settings open / app relaunch); wiring a cross-screen refetch isn't worth it.

## Proposed approach
### A single heal-on-load hook, mounted in the authenticated layout
New `useTimezoneHeal()` (auth lib), called once from `src/app/(app)/_layout.tsx` (the signed-in
area, mounted only when `!!session && !needsOnboarding` — so it runs after onboarding and for every
authenticated session, covering new + existing users uniformly).

- On mount (guarded to run once per signed-in user via a `healedFor` ref):
  - `const device = getDeviceTimezone();`
  - Skip if no `userId`, or `device` is null, or `device === DB_DEFAULT_TIMEZONE` (a genuine-UTC
    device has nothing to heal).
  - Otherwise fire a **conditional UPDATE** — best-effort, not awaited, rejection swallowed, nothing
    logged:
    ```
    supabase.from('profiles')
      .update({ timezone: device })          // touches ONLY the timezone column
      .eq('id', userId)                       // owner-scoped (+ RLS WITH CHECK id = auth.uid())
      .eq('timezone', DB_DEFAULT_TIMEZONE)    // heal ONLY a still-default row
      .then(() => {}, () => {});              // fire-and-forget; never logs the tz/error
    ```
- **Why a conditional UPDATE, not an upsert (0022 review lesson):** it writes a single column, so it
  CANNOT clobber `display_name`/`units` (the partial-upsert-array footgun is impossible here); the
  `.eq('timezone', 'UTC')` predicate makes it idempotent (after the heal, `timezone != 'UTC'` → the
  next session's UPDATE matches no row → no-op) and guarantees it never overwrites a real zone; no
  read is needed to decide.
- **Lint-safe:** the effect only sets a ref and fires the query; no `setState` at all (no
  `react-hooks/set-state-in-effect`), no ref reads in render (no `react-hooks/refs`).
- `DB_DEFAULT_TIMEZONE` is promoted to an exported const in `profile-form.ts` (it exists there
  privately from 0022) so the hook and the resolver share the one sentinel.

## Files to change
- `src/features/auth/lib/profile-form.ts` — export the existing `DB_DEFAULT_TIMEZONE` const (shared
  sentinel; no logic change to `resolveTimezone`/`getDeviceTimezone`).
- `src/features/auth/lib/use-timezone-heal.tsx` — **new.** `useTimezoneHeal()`: once-per-user
  conditional UPDATE of `profiles.timezone` when it's still the default and the device zone is real.
  No-log header.
- `src/app/(app)/_layout.tsx` — call `useTimezoneHeal()` (renders `<AppTabs />` unchanged).

## Data model / schema impact
**None.** No migration/column/RPC. A client UPDATE to the existing `profiles.timezone`, owner-scoped
by `.eq('id', userId)` on top of the `profiles_update` RLS (`WITH CHECK auth.uid() = id`). Only the
`timezone` column is written.

## Edge cases & failure modes
- **Device zone null (`Intl` unavailable)** → skip; nothing to heal, resolver already falls back.
- **Device genuinely UTC** → `device === 'UTC'` → skip (no pointless self-write).
- **Row already has a real zone** (manual heal / prior run) → `.eq('timezone','UTC')` matches nothing
  → no-op. Never overwrites a deliberate zone.
- **Offline / write fails** → swallowed; app stays correct (resolver); retried next session.
- **Account switch within one mount** (sign out → sign in as B) → `healedFor` ref tracks the userId
  it healed, so B is healed too (the effect re-runs on `userId` change).
- **Sign-out mid-write** → fire-and-forget with no `setState`, so no post-unmount state update; the
  request is harmless (owner-scoped, RLS).
- **Concurrent devices** → both may fire the same idempotent UPDATE; last-write-wins with the same
  device-derived value class; no corruption (single column, bounded by nothing but the value).
- **Settings open at heal time** → it won't live-update (reads its own `useProfile`); shows the real
  zone on next load. Acceptable (non-goal).
- **DST / invalid device zone string** → we write whatever `getDeviceTimezone()` (an `Intl`-produced
  IANA zone) returns; the resolver's 0022 `isConstructableZone` guard still protects reads, so even a
  later-unconstructable stored zone degrades safely.

## Test / verify plan
- `npx tsc --noEmit` PASS; `npx expo lint` clean; web bundle / full `expo export` green.
- **Manual (device/web, logged in):**
  1. Fresh account (or one whose `profiles.timezone` is `'UTC'`): sign in, land on Home, then open
     Settings → the timezone now shows the **device zone** (was "UTC"), with no manual tap.
  2. Confirm `display_name`/`units` are unchanged after the heal (no clobber).
  3. A user genuinely in UTC (or a device set to UTC) → stays `'UTC'`, no spurious write.
  4. Re-open the app → no repeated write (idempotent; the row is no longer `'UTC'`).
  5. Regression: daily/weekly buckets still correct (0022/0023 unaffected); Settings "Use device
     timezone" still works.
- **Grep gate:** the tz value is never logged; the write is a single-column UPDATE (not an upsert /
  not an array); no `select('*')`.

## Rollout
Pure client, no migration/deploy/secret. Land on `main`; `tsc`/`lint`/bundle; user verifies Settings
shows the real zone. Journal + mark Done + commit & push.

## Open questions
1. **Hook home** — `(app)/_layout.tsx` (proposed) vs. a specific screen. The layout runs once for the
   whole authenticated area, so it's the natural single mount point. OK?
2. **Refresh an open Settings screen after the heal** — proposed NOT to (eventual on next load).
   Acceptable, or wire a refetch?

---

## Review
<!-- Filled by /review-plan. -->

## Execution log
<!-- Filled during execution. -->
