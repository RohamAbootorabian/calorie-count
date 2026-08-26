# Plan: Fix the daily/weekly timezone — use the device zone, don't sit on the 'UTC' default

- **Status**: **Draft** → In Review → Approved → In Progress → Done
- **Created**: 2026-08-27
- **Plan #**: 0022

## Problem / Goal
The daily dashboard (and the weekly trend) bucket "today" in the **wrong timezone** for almost
every user. `profiles.timezone` is `not null default 'UTC'` (`20260619102510_initial_schema.sql`),
and **nothing writes the device zone**: onboarding upserts only `goals`; the profile row is
created by the signup trigger with the `'UTC'` default; the ONLY way it ever becomes the real
zone is the user manually tapping "Use device timezone" in Settings. Both aggregate screens then
resolve `tz = profile?.timezone?.trim() || getDeviceTimezone() || 'UTC'` — and since the stored
value is the non-blank string `'UTC'`, **`getDeviceTimezone()` is never reached**.

Consequence (confirmed on-device, user in Tehran = UTC+3:30): two meals logged 2026-08-26 19:32
local still counted as "today" at 2026-08-27 00:47 local, because in UTC it was still 21:17 on the
26th. With `tz='UTC'` the daily view rolls over at **03:30 local**, not midnight. Every user not
in UTC has an off-by-their-offset day boundary until they discover the Settings heal.

**"Done" =** a fresh signed-in user's daily/weekly buckets use their **device timezone** with no
manual step; a stored `'UTC'` (the never-set default) is treated as "unset" and falls back to the
device zone; new accounts persist their real device zone at onboarding; the day boundary lands at
the user's real local midnight; `tsc`/`lint`/web-bundle green; user verifies on-device (a meal
from before local midnight drops out of "today" at local midnight, not at 03:30).

## Non-goals
- **No migration / no schema change.** The `'UTC'` default stays; we stop *treating it as an
  explicit choice*. (Changing the column default wouldn't fix existing rows and isn't needed.)
- **No new "pick your timezone" UI.** The Settings "Use device timezone" heal stays as the manual
  override; this plan makes it unnecessary for the common case, not obsolete.
- **NOT the separate "day boundary doesn't roll at midnight without a refetch" bug.** `todayStr`
  is derived inside a `useMemo(…, [rows, tz])` in `use-daily-totals`/`use-weekly-totals`, so a
  screen left open (or resumed from background without a navigation-focus event) across midnight
  won't re-bucket until a refetch. Real, but **separate** — tracked as a follow-up (OQ1), out of
  scope here so this fix stays small and verifiable.
- **No server-side tz use.** Buckets are client-only; there is no report/query that needs the
  stored value, so correctness rides on the client resolver (persistence below is for honesty).
- **No auto-overwrite of a deliberately-chosen zone.** Today `'UTC'` can only mean "DB default /
  never set" (the heal only ever writes the *device* zone), so treating it as unset is safe.

## Proposed approach
Two independent, additive changes — the resolver fixes correctness for **everyone immediately**
(no write, no migration); the onboarding write keeps new accounts honest in the DB.

### 1. Central tz resolver — treat a bare `'UTC'` as "unset" (the correctness fix)
New pure helper `resolveTimezone(storedTz: string | null | undefined): string` (colocate with
`getDeviceTimezone` in `auth/lib/profile-form.ts`):
- Trim `storedTz`. If it's a **real, explicitly-set zone** — non-blank AND not the literal default
  `'UTC'` — use it. Otherwise fall back to `getDeviceTimezone() ?? 'UTC'`.
- Rationale: the stored `'UTC'` is only ever the DB default (never a user's deliberate pick), so
  "stored is `'UTC'`" ≡ "never set" → prefer the device zone. A user genuinely in UTC has a device
  zone of `'UTC'` too, so the result is still `'UTC'` — no misfire.
- Replace the inline `profile?.timezone?.trim() || getDeviceTimezone() || 'UTC'` in
  **`dashboard-screen.tsx`** and **`trend-screen.tsx`** with `resolveTimezone(profile?.timezone)`.
  (These are the only two bucket consumers; Settings uses `getDeviceTimezone` only for the heal
  button, unchanged.)
- Loading behavior preserved: `profile` null → `resolveTimezone(undefined)` → device zone (same as
  today's `|| getDeviceTimezone()`), and the hooks already re-bucket when a late real `tz` arrives.

### 2. Persist the device zone at onboarding (correct-by-construction for new accounts)
In `onboarding-wizard.tsx` `handleSave`, after the `goals` upsert succeeds, **best-effort** upsert
the device zone into `profiles` (mirroring the Settings heal's shape: `upsert({ id: user.id,
timezone }, { onConflict: 'id' })`), only when `getDeviceTimezone()` returns a non-null zone:
- **Non-fatal:** never block onboarding on it — the gate still flips on the goals save; the tz
  write is fire-and-forget (its failure is swallowed, the resolver still makes the app correct).
  Do NOT gate `refetch()`/navigation on it.
- Idempotent (`onConflict: 'id'`), and it only *sets* the real zone — it never writes `'UTC'` over
  a real value (device UTC → writes `'UTC'`, which the resolver treats as unset anyway; harmless).
- PII discipline: the tz is not a body metric, but keep the existing "never log the value" posture.

### Existing accounts
The resolver (step 1) fixes their **behavior** immediately with no write. Their stored `'UTC'`
stays until they visit Settings and heal (unchanged manual path) — acceptable because the app is
already correct for them. An automatic heal-on-load write is deliberately deferred (OQ2).

## Files to change
- `src/features/auth/lib/profile-form.ts` — **new** `resolveTimezone(storedTz)` helper next to
  `getDeviceTimezone`; treats blank/`'UTC'` as unset → device zone → `'UTC'`.
- `src/features/dashboard/screens/dashboard-screen.tsx` — use `resolveTimezone(profile?.timezone)`.
- `src/features/dashboard/screens/trend-screen.tsx` — use `resolveTimezone(profile?.timezone)`.
- `src/features/auth/screens/onboarding-wizard.tsx` — best-effort `profiles` tz upsert after the
  goals save (non-fatal, only when a device zone is available).

## Data model / schema impact
**None.** No migration, no column, no RPC. The `'UTC'` default remains; the client stops treating
it as an explicit choice. New accounts additionally persist their real zone via the existing
`profiles` upsert path (RLS/`WITH CHECK` unchanged — the user writes only their own row).

## Edge cases & failure modes
- **`Intl` unavailable / `getDeviceTimezone()` null** → resolver returns `'UTC'` (today's fallback);
  onboarding tz write is skipped. No crash, no worse than today.
- **User genuinely in UTC** → device zone `'UTC'` → resolver returns `'UTC'` → correct; onboarding
  writes `'UTC'` (a no-op vs. the default).
- **Hermes without full ICU** (native): `getDeviceTimezone()` reads the system zone string via
  `resolvedOptions().timeZone` (returns the real zone even without full ICU); `makeDayFormatter`
  may then ignore the `timeZone` option and bucket device-local — which *is* that zone → still
  correct. (The pre-existing `day-formatter` caveat is unchanged; this fix doesn't worsen it.)
- **Late profile load** → before `profile` arrives, resolver uses the device zone; when the real
  stored zone arrives the hooks re-bucket (existing `useMemo([rows, tz])` behavior).
- **Stored zone is a real non-UTC value** (already healed) → used as-is; resolver is a no-op there.
- **Onboarding tz write fails / offline** → swallowed; onboarding still completes; the resolver
  keeps the app correct; the value can be healed later in Settings.
- **DST** → unaffected; resolution picks the IANA zone, and bucketing already uses same-formatter
  string compare (no offset math).
- **Day boundary still won't roll at midnight without a refetch** (the deferred OQ1 bug) → with the
  correct zone the boundary is now at true local midnight, and refetch-on-focus re-buckets on
  return; the residual "left open across midnight" case is the separate follow-up.

## Test / verify plan
- `npx tsc --noEmit` PASS; `npx expo lint` clean; web bundle HTTP 200 (dashboard + trend still
  bundle; trend is code-split → a full `expo export` if entry.bundle can't confirm, per 0021).
- **Manual (device, the real repro):**
  1. Sign in on an account whose `profiles.timezone` is still `'UTC'` (or a fresh account). Confirm
     "today" now buckets by the device zone — a meal logged before local midnight is NOT counted
     after local midnight (previously it lingered until 03:30 for UTC+3:30).
  2. New account through onboarding → check `profiles.timezone` is the device zone (not `'UTC'`).
  3. Regression: the weekly trend's Sat-first bars + rings (0021) and the goal line (0019) still
     render; Settings "Use device timezone" still works and now shows the real zone for new users.
- **Grep gate:** the tz value is never logged; no `select('*')` added (resolver is pure).

## Rollout
Pure client, no migration, no deploy, no secret. Land on `main`; `tsc`/`lint`/web-bundle;
user device-verify (the real check — the day boundary at local midnight). Journal + mark Done +
commit & push.

## Open questions
1. **Midnight-roll staleness** (`todayStr` frozen in the `[rows, tz]` memo) — proposed as a
   SEPARATE follow-up plan (rebucket on an app-state → foreground resume, or key the memo to the
   current day). Confirm it's out of scope here.
2. **Auto-heal existing stored `'UTC'` → device zone on load** (a one-time best-effort write so
   Settings shows the real zone without manual action) — proposed DEFERRED (the resolver already
   fixes behavior; this is only DB honesty). Add later, or include now?
3. **Onboarding tz write placement** — after the goals upsert in `handleSave` (proposed), vs. its
   own step. Cosmetic; proposed inline + non-fatal.

---

## Review
<!-- Filled by /review-plan. -->

## Execution log
<!-- Filled during execution. -->
