# Plan: Manual meal date — set/edit `eaten_at` (defaults to today)

- **Status**: ~~Draft~~ → ~~In Review~~ → **Approved** → In Progress → Done
- **Plan #**: 0028
- **Created**: 2026-09-05

## Problem / Goal
Meals are always stamped `eaten_at = now()` (immutable). Let the user set the meal's **date**:
- In the capture flow's **review card** (part of the upload flow), a date field defaulting to
  **today**; leaving it as-is saves today.
- In **History → edit**, the user can change a saved meal's date.

Date only (no time). **Only today or earlier** (no future) — which preserves the "all rows ≤ today"
invariant the daily/weekly/monthly buckets rely on. The picker is the **native calendar**
(`@react-native-community/datetimepicker`).

**"Done" =** the review card + the edit-meal screen show a date field (native calendar picker on
device) defaulting to the meal's date (today for a new meal); picking a past date stores it on
`meal_logs.eaten_at`; a future date is blocked; the daily/weekly/monthly views bucket a backdated
meal on its chosen day; `tsc`/`lint`/web-export green (web uses a fallback field); migration
deployed; dev build rebuilt; user verifies on device.

## Non-goals
- **No time-of-day editing** — date only. (`eaten_at` keeps a time component internally — noon/local
  or the current time — but the UI edits only the calendar day.)
- **No future dates** — capped at today (client + a loose server guard).
- **No backfill/bulk edit** — one meal at a time, via the existing create/edit flows.
- **No per-item dates** — one date per meal.
- **No History-list inline date edit** — the date is edited on the edit-meal screen (History → a
  meal → Edit), not on the compact list row.

## Proposed approach
### 1. New native dep + a platform-split `DateField` (in `shared/ui`, SF3)
`npx expo install @react-native-community/datetimepicker` (a NATIVE module → the dev build must be
rebuilt — see Rollout). Platform-split files in **`src/shared/ui/`** (+ barrel export) so web never
imports the native module (Metro resolves `.web.tsx` for web, `.tsx` for native):
- `date-field.tsx` (native): a `Pressable` showing the formatted date that opens `DateTimePicker`
  (`mode="date"`, `maximumDate={today}`); on change → `onChange(noon)` where **noon =
  `new Date(y, m-1, d, 12, 0, 0)` of the picked day** (SF1 — normalize the picker's result).
- `date-field.web.tsx` (web fallback): a DS `<Input>` (`YYYY-MM-DD`). On a VALID `YYYY-MM-DD`, emit
  `new Date(y, m-1, d, 12)` (noon-local, parsed from PARTS — **never `new Date(str)`**, B1); on an
  invalid/partial value, do NOT call `onChange` (keep the last valid value + show inline error, B2).
Shared contract: `DateField({ value: Date, onChange: (d: Date) => void, maximumDate: Date })` —
`onChange` ONLY ever emits a valid noon-local Date.

### 2. `MealForm` gains `eatenAt: Date`
`meal-form.ts`:
- `MealForm.eatenAt: Date`; `SaveLogPayload.eaten_at: string` (ISO); `StoredMealLog.eaten_at: string`.
- `seedFormFromAnalysis(analysis, initialNote)` → `eatenAt: new Date()` (today; a new meal).
- `seedFormFromMealLog(log, items)` → `eatenAt: new Date(log.eaten_at)` (the stored instant).
- `toSavePayload` → `eaten_at: form.eatenAt.toISOString()`.
- `validateEatenAt(d: Date)` → error if `Number.isNaN(d.getTime())` (B2) OR the **device-local date**
  is after today's local date. Compare via `getFullYear/getMonth/getDate` (NOT `toISOString().slice`
  — that's UTC and reintroduces the cross-midnight off-by-one, SF2); "today at any time" stays valid.
  Wire into `isFormValid` (so a bad/future date blocks Save before the `toISOString()` throw).
  `eatenAt: Date` (the one non-string form field) is intentional — the picker + `maximumDate` speak
  `Date`, and the noon time component dodges the midnight-UTC bucket bug; don't "simplify" to a string.

### 3. Shared editable form — the date row
`meal-editor-form.tsx` (shared by review + edit): add the `<DateField>` bound to `form.eatenAt` via a
new controlled `onDateChange` prop (mirrors `onNoteChange`, plan 0020). **Both callers wire it:**
`meal-review.tsx` and `edit-meal-screen.tsx` each add `setEatenAt = (d) => setForm(p => ({ ...p,
eatenAt: d }))` and pass `onDateChange={setEatenAt}`.

### 4. Fetch the date for editing
`use-meal-detail.tsx`: add `eaten_at` to the `meal_logs` SELECT string + `StoredMealLog` so the edit
form seeds the stored date.

### 5. Persistence — both RPCs accept `eaten_at` (migration)
New migration `<ts>_meal_log_eaten_at.sql` (`create or replace` both RPCs; the only new line each is
the `eaten_at` column/value):
- **`create_meal_log`**: add `eaten_at` to the allowlisted insert; value =
  `coalesce((p_log->>'eaten_at')::timestamptz, now())` (omitted → today's `now()`, unchanged).
- **`update_meal_log`**: add `eaten_at = coalesce((p_log->>'eaten_at')::timestamptz, eaten_at)` to
  the allowlisted `SET` (was explicitly never touched).
- **Loose server guard (both):** when provided, reject a far-future OR non-finite value —
  `if v_eaten > now() + interval '1 day' or v_eaten in ('infinity','-infinity') then raise
  'eaten_at out of range' using errcode = '23514'` (SF5 — value-free message; the strict "not after
  today local" check is client-side; no tz passed to the RPC). The generic `23514`→client-`invalid`
  copy ("check your edits") is acceptable for the crafted-caller/wrong-clock path the UI already
  blocks.
- **Client errcode mapping (SF4):** add `22007` + `22008` (malformed/overflow timestamp cast)
  alongside `22P02` in the `invalid` branch of `save-meal.ts` + `update-meal.ts`'s `classifyCode`.
- Update BOTH RPC header comments (create "keeps column defaults" + **update "NEVER touched: …
  eaten_at … immutable"**) — `eaten_at` is now owner-settable to a past date (SF6).
- `database.ts` already has `eaten_at` on `meal_logs` Row/Insert/Update — no regen needed.

### 6. Note the invariant change (all FOUR stale comments, SF6)
`eaten_at` becomes owner-settable (client-strict past-only; server loosely bounds future to
now()+1d; the `<= todayKey` bucket guards are the real safety net that excludes any stray
future/edge row). Update the four comments that assert immutability: the **create RPC header**, the
**`update_meal_log.sql` header** ("NEVER touched: … eaten_at … immutable"), **`use-monthly-totals.tsx`**,
and **`month-weeks.ts`**. `created_at` stays the immutable audit timestamp (only `eaten_at` moves).

## Files to change
- `package.json` (+ `ios/`/pods) — add `@react-native-community/datetimepicker` (native dep).
- `src/shared/ui/date-field.tsx` + `date-field.web.tsx` (+ `src/shared/ui/index.ts` export) —
  **new (SF3).** Native picker + web fallback; `onChange` emits ONLY a valid noon-local Date.
- `src/features/capture/lib/save-meal.ts` + `src/features/history/lib/update-meal.ts` — map
  `22007`/`22008` → `invalid` (SF4).
- `src/features/capture/lib/meal-form.ts` — `eatenAt` in `MealForm`/`SaveLogPayload`/`StoredMealLog`;
  both seeders; `toSavePayload`; `validateEatenAt` + `isFormValid`.
- `src/features/capture/screens/meal-editor-form.tsx` — the `DateField` row via `onDateChange`.
- `src/features/capture/screens/meal-review.tsx` + `src/features/history/screens/edit-meal-screen.tsx`
  — add `setEatenAt` + pass `onDateChange`.
- `src/features/history/lib/use-meal-detail.tsx` — `eaten_at` in the SELECT string + `StoredMealLog`.
- `supabase/migrations/<ts>_meal_log_eaten_at.sql` — **new.** Both RPCs accept `eaten_at`.
- Comment touch-ups: `use-monthly-totals.tsx`/`month-weeks.ts` invariant note.

## Data model / schema impact
No new column (`meal_logs.eaten_at` exists). Two RPCs gain `eaten_at` in their explicit allowlists
(`coalesce(..., now())` on create; `coalesce(..., eaten_at)` on update) + a loose future guard. RLS
unchanged (owner-scoped). `db push` required. New NATIVE dependency → dev-build rebuild required.

## Edge cases & failure modes
- **No date entered (new meal)** → `eatenAt` defaults to `new Date()` → `now()` semantics, identical
  to today's behavior.
- **Future date** → blocked by the picker (`maximumDate=today`) + `validateEatenAt` (client) + the
  loose server guard; a save with a future date can't reach the RPC via the UI.
- **Backdated meal** → buckets on its local day: it drops out of "today", lands in the right
  weekly/monthly bucket IF within the fetch window (48 h / 8-day / ~33-day); older than the window →
  simply not shown in those aggregates (correct — it's out of range), still saved + visible in History.
- **Timezone / noon skew** → `eatenAt` is a device-local `Date`; `toISOString()` sends the exact
  instant; buckets format it in the active tz → the intended local day. The "not after today"
  compare is date-vs-date in local, so "today at 9am picking today" (noon-or-later instant) is NOT
  falsely rejected.
- **Editing an old meal's date across the fetch window** → moving a meal out of the last-7/33-day
  window makes it leave those views (expected); History still shows it.
- **`eaten_at` immutability assumption elsewhere** → the `<= todayKey` bucket guards already handle a
  non-`now()` date; future is disallowed so "≤ today" holds. Comments updated (§6).
- **Web** → the `.web.tsx` fallback (text `YYYY-MM-DD`) keeps the export bundling + is usable for the
  user's web verify; the native calendar is device-only.
- **Idempotent create on `image_path` conflict** → keeps the FIRST row's `eaten_at` (like every
  field); a genuine date change goes through `update_meal_log`.

## Test / verify plan
- `npx tsc --noEmit` PASS; `npx expo lint` clean; full `npx expo export --platform web` green (web
  fallback compiles; native module not imported on web).
- **Migration:** `supabase db push`; verify both RPCs accept `eaten_at` + default to `now()` when
  omitted + reject far-future.
- **Dev build:** `npx expo install` the dep, `pod install`, rebuild the dev client.
- **Manual (device):**
  1. Capture → analyze → review card shows a date field = today; save → History shows today.
  2. Review card → change the date to yesterday → save → the meal shows under yesterday; the daily
     dashboard for today no longer counts it; the weekly bar lands on yesterday.
  3. History → a meal → Edit → change the date → save → reopen → the new date persists.
  4. Future date is not selectable / blocked.
  5. Empty/no-date path unchanged (defaults to today).
- **Grep gate:** the date value isn't logged; no `select('*')`; the native module is imported ONLY in
  `date-field.tsx` (never the `.web.tsx`); History + dashboard queries `order by`/bucket on
  `eaten_at` (confirmed `useMealHistory` uses `eaten_at desc`); the web fallback never calls
  `new Date(str)` (parts-only, noon-local).

## Rollout
1. Migration first (`db push`) — the write target must accept `eaten_at`.
2. `npx expo install @react-native-community/datetimepicker`; `pod install`; **rebuild the dev
   build** (iOS via Xcode/`run:ios`, Android via EAS) — a native dep can't hot-reload.
3. Land the client files; `tsc`/`lint`/web-export; user device-verify.
4. Journal + mark Done + commit & push. (No new secret; no Edge Function change.)

## Open questions
1. **Native dep + rebuild** — confirmed acceptable (the user chose the native picker); the dev build
   must be rebuilt once. OK to proceed?
2. **Stored time-of-day** — proposed: keep the `Date`'s time (current time on create; the stored
   instant on edit) — only the calendar day is user-edited. Buckets ignore the time. OK?
3. **Server future guard granularity** — proposed loose (`> now() + 1 day` → reject) to avoid passing
   the tz into the RPC; the exact "not after today local" is client-side. Acceptable?
4. **Date field placement** — proposed the review card (`MealEditorForm`, shown in the capture flow
   after analyze) + the edit screen, NOT a separate pre-analyze step (the date doesn't affect the AI
   analysis, unlike the 0020 note). OK, or also a pre-analyze field?

---

## Review
_4-lens review (correctness, architecture, edge, data/privacy), 2026-09-05. **Two BLOCKERs** (both
the web `DateField`'s Date handling) + should-fixes. All folded below._

### Verdict
**NEEDS CHANGES → RESOLVED → APPROVED.** The DB logic (both `coalesce` forms, `::timestamptz`
parsing, owner-scoping, idempotency, no injection, server fields untouched), all three bucketing
paths, `seedFormFromAnalysis` (no signature break), and History ordering (`order by eaten_at desc`,
confirmed) are correct. Two blockers in the not-yet-written `date-field.web.tsx` (UTC-parse off-by-one
+ Invalid-Date crash) + a cluster of local-vs-UTC / noon-anchoring / errcode should-fixes, all folded.

### BLOCKER (resolved)
- **B1 — Web fallback `new Date('YYYY-MM-DD')` = UTC midnight → off-by-one local day.** West of UTC,
  that instant formats to the PREVIOUS day in the bucket formatter → the meal lands on the wrong day
  (and web is our verify surface). **Resolution:** the web field parses PARTS to noon-local —
  `const [y,m,d] = s.split('-').map(Number); new Date(y, m-1, d, 12)` — NEVER `new Date(str)`.
- **B2 — `toISOString()` on an Invalid Date crashes Save.** `toSavePayload` calls
  `form.eatenAt.toISOString()`, which throws `RangeError` on an Invalid Date; the web text field can
  hold a half-typed/garbage value. **Resolution:** the web `DateField` NEVER emits an invalid Date
  via `onChange` (parse+validate first; keep the last-valid value + show an inline error otherwise),
  AND `validateEatenAt` returns an error when `Number.isNaN(d.getTime())` and is wired into
  `isFormValid` (so a bad date blocks Save before the throw).

### SHOULD-FIX (folded in)
- **SF1 — Store NOON-of-day when the user picks a day (both variants).** Midnight can not-exist under
  a midnight-DST zone and any device-vs-profile tz offset can push it across the day boundary. The
  weekly hook already seeds at noon for this reason. **Resolution:** `DateField.onChange` ALWAYS emits
  `new Date(y, m-1, d, 12, 0, 0)` (noon-local of the chosen day) — native (normalize the picker's
  result) AND web. Create default (unpicked) = `new Date()` (now) is fine.
- **SF2 — `validateEatenAt` (and `maximumDate`) compare in DEVICE-LOCAL, not UTC.** Use
  `getFullYear/getMonth/getDate` (or an `en-CA` local formatter), NEVER `toISOString().slice(0,10)`
  (which would reintroduce the cross-midnight off-by-one). Reject future AND `NaN(getTime())`.
- **SF3 — Move `DateField` to `src/shared/ui/` (+ barrel export).** It's a generic, DS-level,
  platform-split primitive consumed cross-feature (capture + history); it has zero meal semantics —
  `shared/ui` (which already holds `Input`, wrapped by the web fallback) is its home, not
  `capture/screens/`.
- **SF4 — Map `22007`/`22008` (malformed/overflow timestamp) → `invalid` in BOTH `save-meal.ts` +
  `update-meal.ts`.** A crafted bad `eaten_at` casts to `22007`/`22008` (not `22P02`), which currently
  falls through to raw `unknown` — inconsistent with the typed-never-raw posture at the RPC boundary.
- **SF5 — Reject non-finite `eaten_at` in the server guard.** `'+infinity'` is caught by `> now()+1
  day` but `'-infinity'` passes; add `or (p_log->>'eaten_at')::timestamptz not in ('infinity','-infinity')`
  (or an `isfinite`-style check) → `23514`, so the bounded-date invariant holds at the boundary.
  Keep the raise messages VALUE-FREE (health-adjacent PII).
- **SF6 — Update ALL FOUR stale invariant comments** (create RPC header, **`update_meal_log.sql`
  header** — §6 originally omitted it, `use-monthly-totals.tsx`, `month-weeks.ts`): `eaten_at` is now
  owner-settable to a PAST date (client-strict past-only; server loosely bounds future to now()+1d;
  the `<= todayKey` bucket guards exclude any stray future/edge row). Reword §6 so the invariant note
  is truthful at the DB layer (server is loose, buckets are the real safety net).

### NIT (addressed/noted)
- **Verify History/dashboard ORDER BY `eaten_at`** (not `created_at`) — confirmed: `useMealHistory`
  uses `.order('eaten_at', {ascending:false})`; keep as a grep/verify line. • **Document `eatenAt:
  Date`** (the one non-string form field): the native picker + `maximumDate` speak `Date`, and keeping
  a time component (noon) is what dodges the midnight-UTC bucket bug — note it so a future reader
  doesn't "simplify" to a bare string. • **device-tz vs. profile-tz divergence** — noon-of-day
  storage (SF1) absorbs offsets up to ±12 h; post-0022 both are the device zone anyway; one-line
  comment. • **`maximumDate` staleness across midnight** — minor; `validateEatenAt` uses a fresh
  `new Date()`; accept or recompute from the live day key. • **No `minimumDate`** — harmless
  (timestamptz + buckets tolerate old dates); optional floor, skipped. • **Future-guard `23514`
  shares the SQLSTATE with the totals/item-count checks** → the client shows the generic `invalid`
  copy ("We couldn't save… check your edits"), which is acceptable for a date too (NOT the "totals
  too large" copy, which lives elsewhere); the UI (`maximumDate` + `validateEatenAt`) blocks future
  before the RPC, so this path is crafted-caller/wrong-clock only — accepted, no new SQLSTATE. •
  Optionally use `<input type="date">` for the web fallback (a real calendar on the verify surface) —
  optional.

### Confirmed correct (no change)
`coalesce(...,now())` (create) / `coalesce(...,eaten_at)` (update) preserve omitted-→-unchanged;
`toISOString()` (Z) parses exactly as `timestamptz`; allowlist stays explicit `->>`+cast (no
injection, no `jsonb_populate_record`); update stays owner-scoped (`id=p_id AND user_id=v_uid`,
raised before child mutation); `verified`/`user_id`/`image_path`/`created_at` untouched;
`set_updated_at` still fires; backdated meals bucket on their day + drop out of "today" (all three
paths) and out of the fetch windows when older (still in History); idempotent create keeps the first
`eaten_at`; the loose `> now()+1day` guard can't false-reject a legit "today" instant at any tz;
`database.ts` already carries `eaten_at` (no regen); the 0020 `note` threading seam is the right
mirror.

## Execution log
<!-- Filled during execution. -->
