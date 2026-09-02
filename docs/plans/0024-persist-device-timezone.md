# Plan: Persist the device timezone (heal the stored 'UTC' default) — DB honesty

- **Status**: ~~Draft~~ → ~~In Review~~ → ~~Approved~~ → ~~In Progress~~ → **Done** (user verify pending)
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
- **No behavior change FOR THE STATIONARY COMMON CASE.** Bucketing is already correct via
  `resolveTimezone` (0022); if this write never lands (offline), the app is still correct.
  **Caveat (SF1):** for a user who first launches while TRAVELING or who later relocates, persisting
  a concrete zone flips the resolver from "follow the current device zone" (its behavior for a
  stored `'UTC'`) to "the stored zone is authoritative" — so their day boundary pins to the healed
  zone until they re-tap Settings → "Use device timezone". This is the SAME behavior a manual heal
  already produces and matches 0022's approved "a real stored zone wins" model — accepted as
  intended, not a regression from any designed behavior.
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
authenticated session, covering new + existing users uniformly). The hook gets a doc header
matching the sibling hooks; the call site gets a one-line comment so a DB write in a layout isn't a
surprise (SF2).

- On mount (**once per mount, idempotent thereafter** — a `healedFor` ref keyed on `userId` is
  defensive; the `[userId]` effect dep + the `.eq('timezone','UTC')` idempotency are the real
  guarantees, so a StrictMode-dev double-invoke or remount just re-fires a harmless 0-row UPDATE):
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
- **Concurrent devices** → **first-write-wins**: once one device heals to a non-UTC value, the
  other's `.eq('timezone','UTC')` matches 0 rows → no-op (no flip-flop between two devices in
  different zones). Single column, no corruption.
- **Traveler / relocation (SF1)** → after the heal, the stored zone is authoritative; the day
  boundary pins to it until the user re-heals in Settings. Accepted (same as a manual heal).
- **Heal bumps `profiles.updated_at`** (via `set_updated_at`) → harmless (Settings isn't mounted at
  heal time; a later load re-seeds cleanly).
- **Missing `profiles` row** (rare; `handle_new_user` swallows insert errors) → the bare UPDATE
  matches 0 rows → no-op, no crash, no row created; the resolver still buckets by device;
  `useProfile` self-heals the row on a Settings save.
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
_Balanced 4-lens review (correctness, architecture, edge, data/privacy), 2026-09-02. **No
BLOCKERs.** The notable finding is a framing correction (this DOES change behavior for travelers);
folded below._

### Verdict
**APPROVED.** Zero blockers. Correctness confirmed: new users are still `'UTC'` when `(app)` first
mounts post-onboarding (signup trigger inserts `id` only; onboarding writes only `goals`), so the
heal fires for new + existing; the conditional single-column UPDATE is idempotent + owner-scoped +
cannot clobber `display_name`/`units`; no stale-then-healed wrong-bucket (the resolver returns the
device zone for a stored `'UTC'` this session anyway); lint-clean (no setState, no ref-in-render).
Data/privacy: stores nothing the manual Settings heal doesn't already, owner-scoped double-locked
(`.eq('id')` + RLS `WITH CHECK`), no new PII surface, log-free.

### SHOULD-FIX (folded in)
- **SF1 — "No behavior change" is inaccurate for travelers (edge); reframe + accept explicitly.**
  Post-0022, a stored `'UTC'` makes `resolveTimezone` ALWAYS follow the current device zone (a
  traveler's "today" follows where they are). Once the heal writes a concrete zone, the resolver's
  first branch honors the STORED zone and stops device-following — so a user who first launches
  while traveling, or later relocates, is pinned to the healed zone until they re-tap Settings →
  "Use device timezone". **Resolution:** this is the SAME behavior a manual heal already produces
  and is consistent with 0022's approved "a real stored zone is authoritative" model — accept it
  explicitly (stored zone authoritative; relocation → re-heal in Settings), and correct the
  non-goal from "no behavior change" to "no behavior change for the stationary common case; for
  travelers it flips device-follow → stored-zone-authoritative." (Surfaced to the user; proceeding
  under the persist choice.)
- **SF2 — A DB write mounted in a layout must be self-explaining (architecture).** `(app)/_layout.tsx`
  "just renders AppTabs"; a side-effecting hook there will surprise readers. **Resolution:** a
  one-line comment at the call site (`// Best-effort once-per-session heal of the stored 'UTC'
  default → real device zone (plan 0024).`) + a doc header on `use-timezone-heal` matching the
  sibling hooks' style.

### NIT (addressed/noted)
- `healedFor` keys on `userId` (not a boolean) — already specified; it's DEFENSIVE, not
  load-bearing (the `[userId]` effect dep + the `.eq('timezone','UTC')` idempotency are the real
  guarantees). Trim the "account switch within one mount" justification — it can't happen (sign-out
  flips the gate → `(app)` unmounts → fresh mount for B). • Reword "once per session" → **"once per
  mount, idempotent thereafter"** (a remount/StrictMode-dev-double-invoke re-fires a harmless
  0-row UPDATE). • Concurrent devices = **first-write-wins** (not "last-write-wins"): once one device
  heals, the other's `.eq('timezone','UTC')` matches 0 rows — better (no flip-flop); fix the
  edge-table wording. • The heal bumps `profiles.updated_at` via `set_updated_at` — harmless
  (Settings isn't mounted at heal time; a later load re-seeds). • **Missing `profiles` row** (rare —
  `handle_new_user` swallows insert errors) → the bare UPDATE matches 0 rows → no-op (won't create
  the row); the resolver still buckets by device; `useProfile` self-heals on a Settings save.
  Acceptable. • **No-log:** ship the empty `.then(()=>{}, ()=>{})` verbatim, no `console`/telemetry;
  grep gate asserts no logger in `use-timezone-heal.tsx`. • The two-arg `.then(onOk, onErr)` is
  REQUIRED (executes the PostgREST builder + swallows both a rejected promise and a resolved
  `{error}`); a plain `.then(()=>{})` would leak the rejection (dev redbox). • `.tsx` vs `.ts`: the
  hook renders no JSX so `.ts` is marginally more correct, but `.tsx` matches some siblings — either
  fine.

### Confirmed correct (no change)
Single-column conditional UPDATE over an upsert (no read, no clobber, idempotent) is the right,
simplest shape — do NOT share the Settings upsert. Fire-and-forget with zero render-visible state
correctly needs no mounted-ref (that discipline exists only to guard setState-after-unmount).
Single heal-on-load covers new + existing (no second onboarding write path). `DB_DEFAULT_TIMEZONE`
export is the clean DRY sentinel. `(app)/_layout.tsx` is the correct once-per-session mount point
(persists across tab switches + deep links; unmounts on sign-out).

## Execution log
_Executed 2026-09-02. Landed to the approved plan (both should-fixes) — no deviations._

**Files.**
- `auth/lib/profile-form.ts` — promoted `DB_DEFAULT_TIMEZONE` to `export` (shared sentinel; no
  logic change).
- `auth/lib/use-timezone-heal.tsx` (**new**) — `useTimezoneHeal()`: once-per-mount (`healedFor`
  ref keyed on `userId`, defensive), skips when no `userId` / no device zone / device is
  `DB_DEFAULT_TIMEZONE`; else a fire-and-forget conditional UPDATE
  `.update({ timezone: device }).eq('id', userId).eq('timezone', DB_DEFAULT_TIMEZONE)` with a
  two-arg `.then(()=>{}, ()=>{})` (executes the builder + swallows both a rejected promise and a
  resolved `{error}`). Doc header + no-log (SF2/privacy).
- `app/(app)/_layout.tsx` — calls `useTimezoneHeal()` with a one-line explaining comment (SF2);
  renders `<AppTabs />` unchanged.

**Deviations.** None.

**Verification.** `npx tsc --noEmit` exit 0. `npx expo lint` exit 0. Full `npx expo export
--platform web` exit 0 with `useTimezoneHeal` in the compiled bundle. Grep gate: no `console.*` in
the hook; it's a single-column `.update()` (not an upsert). **User verify pending** — sign in on a
`'UTC'` account, land on Home, open Settings → timezone shows the real device zone (was "UTC"),
with `display_name`/`units` unchanged; re-open → no repeat write.
