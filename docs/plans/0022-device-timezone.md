# Plan: Fix the daily/weekly timezone — use the device zone, don't sit on the 'UTC' default

- **Status**: ~~Draft~~ → ~~In Review~~ → **Approved** (revised to resolver-only) → In Progress → Done
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
- **No persistence in this plan (revised).** The resolver fixes behavior for everyone with no
  write; persisting the real zone (auto-write at onboarding + heal existing `'UTC'` rows) is a
  single deferred follow-up (OQ1) — DB honesty, not correctness.
- **Midnight-roll exposure (honesty):** fixing the zone moves the *separate* frozen-boundary bug
  (below) to true local midnight — a higher-traffic "app left open" hour than 03:30 — so more
  users could see a stale "today" until a refetch. That raises the priority of the follow-up; it
  is not introduced or worsened in kind by this fix.
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
**Resolver-only** (revised per review): one pure client change fixes the symptom for **everyone
immediately** — no write, no migration. Persistence (onboarding write + existing-row auto-heal) is
a single deferred follow-up (OQ1), since it's DB-honesty only, not correctness.

### Central tz resolver — treat a bare `'UTC'` as "unset" (the whole fix)
New pure helper `resolveTimezone(storedTz: string | null | undefined): string` (colocate with
`getDeviceTimezone` in `auth/lib/profile-form.ts`):
- Trim `storedTz`. Use it **only if** it's a real, explicitly-set zone — non-blank, not equal to
  the DB default sentinel `DB_DEFAULT_TIMEZONE = 'UTC'` (a named constant tied by comment to
  `20260619102510_initial_schema.sql`), **and** constructable by `Intl.DateTimeFormat` (SF3 —
  wrap in try/catch; a zone this device's `Intl` rejects is treated as unset, avoiding
  `makeDayFormatter`'s silent UTC fallback). Otherwise fall back to `getDeviceTimezone() ?? 'UTC'`
  (`??`, not `||`, SF-NIT).
- **Invariant (documented on the helper):** a stored value equal to the DB default is treated as
  unset because the ONLY writer of a real zone is the Settings heal (which writes the *device*
  zone) — there is no free-text tz entry, so `'UTC'` is unambiguously "never set". A future
  "pick your timezone" UI that could persist a literal `'UTC'` for a non-UTC user must revisit this.
- Rationale: a user genuinely in UTC has a device zone of `'UTC'` too, so the result is still
  `'UTC'` — no misfire.
- Replace the inline `profile?.timezone?.trim() || getDeviceTimezone() || 'UTC'` in
  **`dashboard-screen.tsx`** and **`trend-screen.tsx`** with `resolveTimezone(profile?.timezone)`,
  and **swap** each file's `getDeviceTimezone` import to `resolveTimezone` (SF2 — it's used nowhere
  else in either screen, so leaving the old import fails `expo lint`). These are the only two bucket
  consumers; Settings uses `getDeviceTimezone` only for the heal button, unchanged.
- Loading behavior preserved: `profile` null → `resolveTimezone(undefined)` → device zone (same as
  today's `|| getDeviceTimezone()`), and the hooks already re-bucket when a late real `tz` arrives.

## Files to change
- `src/features/auth/lib/profile-form.ts` — **new** `resolveTimezone(storedTz)` + a
  `DB_DEFAULT_TIMEZONE` constant, next to `getDeviceTimezone`; treats blank/default/`Intl`-invalid
  as unset → device zone → `'UTC'`.
- `src/features/dashboard/screens/dashboard-screen.tsx` — swap the import + use
  `resolveTimezone(profile?.timezone)`.
- `src/features/dashboard/screens/trend-screen.tsx` — swap the import + use
  `resolveTimezone(profile?.timezone)`.

## Data model / schema impact
**None.** No migration, no column, no RPC, **no write** (resolver-only). The `'UTC'` default
remains; the client simply stops treating it as an explicit choice. Persisting the real zone
(onboarding + auto-heal) is the deferred follow-up (OQ1).

## Edge cases & failure modes
- **`Intl` unavailable / `getDeviceTimezone()` null** → resolver returns `'UTC'` (today's fallback).
  No crash, no worse than today.
- **User genuinely in UTC** → device zone `'UTC'` → resolver returns `'UTC'` → correct.
- **Stored zone this device's `Intl` can't construct** (older ICU / cross-device account, SF3) →
  the resolver's try/catch treats it as unset → device zone, avoiding `makeDayFormatter`'s silent
  UTC fallback.
- **Hermes without full ICU** (native): `getDeviceTimezone()` reads the system zone via
  `resolvedOptions().timeZone` (real zone even without full ICU); `makeDayFormatter` may then ignore
  the `timeZone` option and bucket device-local — which *is* that zone → still correct. NOTE: the
  user reproduced the bug on their iPhone (no reset at 00:47), which proves **their** build HONORS
  `timeZone` (else `tz='UTC'` would have bucketed device-local Tehran and reset at midnight) — so
  the fix is observable on that device.
- **Late profile load** → before `profile` arrives, resolver uses the device zone; when the real
  stored zone arrives the hooks re-bucket (existing `useMemo([rows, tz])` behavior).
- **Stored zone is a real, valid non-UTC value** (already healed) → used as-is; resolver is a no-op.
- **Traveling user** (device zone changes) → unset users track the current device zone; healed
  users stay on their stored home zone — deterministic, pre-existing, out of scope.
- **DST** → unaffected; resolution picks the IANA zone, and bucketing already uses same-formatter
  string compare (no offset math).
- **Day boundary still won't roll at midnight without a refetch** (the deferred follow-up bug) →
  with the correct zone the boundary is now at true local midnight, and refetch-on-focus re-buckets
  on return; the residual "left open across midnight" case is the separate follow-up (raised in
  priority — see Non-goals).

## Test / verify plan
- `npx tsc --noEmit` PASS; `npx expo lint` clean; web bundle HTTP 200 (dashboard + trend still
  bundle; trend is code-split → a full `expo export` if entry.bundle can't confirm, per 0021).
- **Manual (device, the real repro — valid here since the user's build honors `timeZone`):**
  1. Sign in on an account whose `profiles.timezone` is still `'UTC'` (or a fresh account). Confirm
     "today" now buckets by the device zone — a meal logged before local midnight is NOT counted
     after local midnight (previously it lingered until 03:30 for UTC+3:30).
  2. Regression: the weekly trend's Sat-first bars + rings (0021) and the goal line (0019) still
     render; Settings "Use device timezone" heal still works (and a healed real zone is still used
     as-is by the resolver).
  3. Web is also a valid verification surface (full ICU).
- **Grep gate:** the tz value is never logged; no `select('*')` added; the resolver is pure (no I/O).

## Rollout
Pure client, no migration, no deploy, no secret, **no write**. Land on `main`; `tsc`/`lint`/
web-bundle; user device-verify (the real check — the day boundary at local midnight). Journal +
mark Done + commit & push.

## Open questions
1. **Persistence follow-up (deferred, one plan)** — combine (a) auto-write the device zone at
   onboarding and (b) heal existing stored `'UTC'` rows on load, so Settings shows the real zone
   without a manual heal. DB honesty only (the resolver already fixes behavior). Mirror the
   Settings upsert as a single-object `upsert({ id, timezone }, { onConflict: 'id' })` (NEVER an
   array — PostgREST null-fills missing keys across a heterogeneous array → would clobber
   `display_name`/`units`); fire-and-forget, rejection swallowed with no `setState`/no tz in logs;
   consider extracting a `persistDeviceTimezone(userId)` helper. Confirm deferral.
2. **Midnight-roll staleness** (`todayStr` frozen in the `[rows, tz]` memo → doesn't roll at
   midnight without a refetch) — a SEPARATE follow-up (rebucket on app-state → foreground resume,
   or key the memo to the current day). Raised in priority by this fix (boundary now at 00:00).
   Confirm out of scope here.

---

## Review
_Balanced 4-lens review (correctness, architecture, edge, data/privacy), 2026-08-27. **No
BLOCKERs.** The biggest outcome is a **scope reduction**: drop the onboarding tz-write from this
plan (resolver-only), removing the clobber + fire-and-forget risks entirely. Findings folded
below._

### Verdict
**APPROVED** (as revised to resolver-only). Zero blockers. The correctness core is confirmed: the
inline `profile?.timezone?.trim() || getDeviceTimezone() || 'UTC'` short-circuits on the non-blank
`'UTC'`, so the device fallback is unreachable — the resolver fixes it for all users with no write.
Both bucket consumers (`dashboard-screen`, `trend-screen`) are the only inline sites; Settings'
`getDeviceTimezone` use is a different op (the heal write) and stays. The "'UTC' ≡ DB default ≡
unset" invariant holds (the heal only ever writes the *device* zone; no free-text tz entry exists).

### Scope decision (architecture SF — adopted)
- **Ship resolver-only; defer ALL persistence.** The resolver alone fixes the whole symptom for
  everyone (new accounts included), so the onboarding tz-write was "DB honesty only" — a second
  `profiles` write path + a swallowed failure mode + a partial-upsert clobber footgun for zero
  behavioral benefit, while the identical-motive auto-heal (old OQ2) was already deferred. That
  line was inconsistent. **Resolution:** this plan is now a pure, no-write client change; onboarding
  persistence + existing-row auto-heal move to a single follow-up (OQ1). This also deletes the
  data-lens clobber concern and the correctness/edge "don't await the upsert" concern from scope.

### SHOULD-FIX (folded in)
- **SF1 — Name the `'UTC'` sentinel + document the invariant (architecture).** "Stored `'UTC'` ≡
  unset" is a magic literal, and the same string is reused as the last-resort fallback (two
  meanings). **Resolution:** a named constant `DB_DEFAULT_TIMEZONE = 'UTC'` tied by comment to
  `20260619102510_initial_schema.sql`'s column default, used for the sentinel compare; a doc line
  on `resolveTimezone` stating "a stored value equal to the DB default is treated as unset, because
  the only writer of a real zone is the Settings heal (device zone) — a future free-text tz UI must
  revisit this." Keeps the schema coupling greppable and the sentinel-vs-fallback distinction legible.
- **SF2 — Swap the import, don't add it (correctness — protects the lint gate).** After replacing
  the inline expression, `getDeviceTimezone` is unused in BOTH `dashboard-screen.tsx` and
  `trend-screen.tsx` → `expo lint` fails. **Resolution:** change each import from `getDeviceTimezone`
  to `resolveTimezone` (it's used nowhere else in either screen).
- **SF3 — Harden the resolver against a stored zone the CURRENT device's `Intl` can't construct
  (edge).** The resolver returns a real stored zone as-is; if that zone is valid on the writing
  device but rejected by this device's `Intl` (older ICU / cross-device account), `makeDayFormatter`
  silently falls back to UTC with no device fallback → a silent wrong bucket. (The resolver's own
  `getDeviceTimezone()` output is always Intl-produced, so that path is already safe.) **Resolution:**
  in the resolver, treat a stored zone that `Intl.DateTimeFormat` can't construct (throws) as unset
  too → fall through to the device zone. One tiny try/catch; makes all three inputs (blank, default,
  invalid) collapse to the device branch.

### NIT (addressed/noted)
- Use `?? 'UTC'` (not `||`) on the device fallback — `getDeviceTimezone()` is `string | null`, so
  both work; `??` documents intent. • Compare the **trimmed** value against the sentinel (`' UTC '`
  → unset); exact `=== 'UTC'` after trim is fine (Intl + the DB default both emit uppercase). •
  **On-device verify IS valid here:** the user reproduced the bug on their iPhone (no reset at 00:47),
  which proves their Hermes build **honors** the `timeZone` option (if it ignored it, `tz='UTC'`
  would have bucketed device-local Tehran and reset at midnight — no bug). So the before/after is
  observable on that device; web is also a valid surface. • **Midnight-roll exposure (honesty):**
  the correct zone moves the frozen-boundary bug (deferred OQ2) to true local midnight — a
  *higher*-traffic "app left open" hour than 03:30 — so more users could see a stale "today" until a
  refetch. State it plainly so the follow-up isn't under-prioritized. • The race between a (now
  removed) tz write and first render is moot under resolver-only. • Second `profiles`-tz writer
  duplication + `profile-form.ts` docstring scope — moot/again only relevant to the deferred
  persistence follow-up (extract a `persistDeviceTimezone(userId)` there if a third writer appears).

### Confirmed correct (no change)
Pure `resolveTimezone(storedTz)` is the right seam (both screens own the single `useProfile()` and
pass `tz` down; resolving inside `useProfile` would corrupt the raw row Settings needs for
`timezoneDisplay`/heal decisions). Colocation with `getDeviceTimezone` in `profile-form.ts` is
right. Loading behavior preserved (profile null → device zone). No migration needed (a column-default
change wouldn't fix existing rows and isn't required). Genuine-UTC user → device zone `'UTC'` → no
misfire. DST unaffected (same-formatter string compare). Fixed-offset IANA zones (`Etc/GMT-3`)
pass through correctly.

## Execution log
<!-- Filled during execution. -->
