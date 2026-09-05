# Plan: Manual meal date — set/edit `eaten_at` (defaults to today)

- **Status**: **Draft** → In Review → Approved → In Progress → Done
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
### 1. New native dep + a platform-split `DateField`
`npx expo install @react-native-community/datetimepicker` (a NATIVE module → the dev build must be
rebuilt — see Rollout). To keep the web export (our verify surface) bundling AND give the device the
calendar, split by platform file:
- `date-field.tsx` (native, iOS/Android): a `Pressable` showing the formatted date that opens
  `DateTimePicker` (`mode="date"`, `maximumDate={today}`); on change → `onChange(date)`.
- `date-field.web.tsx` (web fallback): a DS `<Input>` (`YYYY-MM-DD`) with the same `value`/`onChange`
  contract + inline validation. (Metro resolves `.web.tsx` for web, `.tsx` for native, so web never
  imports the native module.)
Shared prop contract: `DateField({ value: Date, onChange: (d: Date) => void, maximumDate: Date })`.

### 2. `MealForm` gains `eatenAt: Date`
`meal-form.ts`:
- `MealForm.eatenAt: Date`; `SaveLogPayload.eaten_at: string` (ISO); `StoredMealLog.eaten_at: string`.
- `seedFormFromAnalysis(analysis, initialNote)` → `eatenAt: new Date()` (today; a new meal).
- `seedFormFromMealLog(log, items)` → `eatenAt: new Date(log.eaten_at)` (the stored instant).
- `toSavePayload` → `eaten_at: form.eatenAt.toISOString()`.
- `validateEatenAt(d: Date)` → error if the **local date** is after today's local date (compare
  `YYYY-MM-DD` of each — NOT the raw timestamp, so "today at any time" is always valid); wire into
  `isFormValid`. Near-dead behind the picker's `maximumDate`, kept as defense-in-depth.

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
  `coalesce((p_log->>'eaten_at')::timestamptz, now())` (omitted → today's `now()`, unchanged
  behavior). Add a LOOSE future guard: `if provided and (p_log->>'eaten_at')::timestamptz > now() +
  interval '1 day' then raise … 23514` (the strict "not after today local" check is client-side; the
  server bound just rejects absurd far-future values without needing the tz).
- **`update_meal_log`**: add `eaten_at = coalesce((p_log->>'eaten_at')::timestamptz, eaten_at)` to
  the allowlisted `SET` (was explicitly never touched); same loose future guard.
- Update both RPC header comments (`eaten_at` is no longer immutable; it's an owner-settable date,
  loose-future-guarded).
- `database.ts` already has `eaten_at` on `meal_logs` Row/Insert/Update — no regen needed.

### 6. Note the invariant change
`eaten_at` becomes user-settable (past-only). The `<= todayKey` guards added in 0025/0027
(`use-monthly-totals`/`month-weeks`) and the daily/weekly exact-date buckets already tolerate this;
add a one-line note where those comments assert "eaten_at is now()-defaulted + immutable" so they
stay truthful (now: "+ owner-settable to a past date; never future").

## Files to change
- `package.json` (+ `ios/`/pods) — add `@react-native-community/datetimepicker` (native dep).
- `src/features/capture/screens/date-field.tsx` + `date-field.web.tsx` — **new.** The picker + web
  fallback.
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
  `date-field.tsx` (never the `.web.tsx`).

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
<!-- Filled by /review-plan. -->

## Execution log
<!-- Filled during execution. -->
