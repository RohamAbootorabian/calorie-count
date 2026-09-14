# Plan: Smart meal reminders (local notifications)

- **Status**: ~~Draft~~ → ~~In Review~~ → ~~Approved~~ → ~~In Progress~~ → **Done**
- **Created**: 2026-09-14
- **Plan #**: 0040

## Problem / Goal
Users forget to log meals, which breaks the daily/weekly rings and the whole habit. Add **smart local
reminders**: up to a few daily nudges (default breakfast/lunch/dinner) that fire **only if the user has
NOT already logged a meal in that reminder's window today**, fully controllable from Settings (master
on/off + per-reminder time).

Decisions locked with the user:
- **Type:** smart — a reminder is suppressed when a meal is already logged in its window.
- **Control:** full control in Settings (toggle + editable times).
- **Transport:** LOCAL notifications only (`expo-notifications`). NO server/push, NO Expo push tokens.
  This is both simpler and privacy-preserving, and it is *sufficient* for "only when not logged" — see
  the key insight below.

### Key insight — why LOCAL is enough for "smart"
The only way to log a meal is inside the app. So every log is an in-app code-execution point where we
can **cancel** the pending reminder for that window. We therefore schedule single (non-repeating)
occurrences and **reconcile** them (cancel/re-arm) at three moments: app foreground, after a successful
meal save, and when reminder settings change. A reminder fires only if, by its time, no meal was logged
in its window — exactly the requested behavior — with zero backend.

## Non-goals
- No remote/push notifications, no Expo push tokens, no server cron. (Could be a later plan if we ever
  need nudges while the app has never been opened that day — see Limitations.)
- No cross-device sync of reminder prefs — they are inherently per-device, stored locally.
- No custom sounds / rich notifications / actions / snooze. A single generic banner.
- No Android-specific channel tuning beyond the default (we target the user's iPhone; keep it working
  but don't gold-plate Android).
- No new backend tables/columns/RPC/migration.

## Proposed approach

### Data model (device-local, no backend)
Reminder prefs live in **AsyncStorage**, keyed by user id (so a different account on the same device
doesn't inherit them, and sign-out can clear/cancel):
```ts
type Reminder = { id: string; hour: number; minute: number; label: string }; // 24h local time
type ReminderPrefs = { enabled: boolean; reminders: Reminder[] };
// default: enabled:false, reminders: [breakfast 09:00, lunch 13:00, dinner 20:00]
```
Key: `reminder-prefs:v1:<userId>`. Load returns defaults when absent/parse-fails (never throws).

### Pure helpers (unit-testable, no RN/Notifications import) — `reminders.ts`
- `sortReminders(rs)` → by (hour, minute).
- `windowStartMinutes(rs, i)` → the previous reminder's minute-of-day (or 0 for the first). Window for
  reminder i is `(prevMinutes, thisMinutes]` in local minutes-of-day.
- `isWindowSatisfied(reminder, prevMinutes, mealLocalMinutes[])` → true iff any logged meal today falls
  in `(prevMinutes, reminderMinutes]`.
- `nextOccurrence(reminder, now, satisfiedToday)` → a `Date`: today at h:m if it's still in the future
  AND not satisfied; otherwise tomorrow at h:m. (Tomorrow's occurrence is always unsatisfied at schedule
  time; it re-reconciles on the next foreground.)
- All time math is **device-local** (the notification is a wall-clock nudge on THIS device; we
  deliberately use the device clock, not the profile tz — a reminder should fire at 9am where the phone
  is). Meal "today" + minute-of-day are computed with the device local calendar.

### Notification service (thin `expo-notifications` wrapper) — `notification-service.ts`
- Module top-level: `Notifications.setNotificationHandler(...)` (banner on, sound/badge off).
- `ensurePermission()` → `getPermissionsAsync` then `requestPermissionsAsync({ios:{allowAlert,allowSound:false,allowBadge:false}})`; returns granted boolean.
- `reconcile(userId)`:
  1. `Platform.OS === 'web'` → no-op (web has no scheduling; the export must still bundle).
  2. Load prefs; if `!enabled` → cancel ALL our reminders, return.
  3. Query today's meal times: `supabase.from('meal_logs').select('eaten_at').eq('user_id', userId)
     .gte('eaten_at', startOfLocalDayIso)` → map to local minutes-of-day. (Owner-filtered; **privacy:
     only `eaten_at`**, never dish/health columns; never logged.)
  4. For each enabled reminder compute `nextOccurrence`; cancel our previously-scheduled ones and
     schedule the fresh set. Tag each with `content.data = { kind: 'meal-reminder' }` so we cancel ONLY
     ours (iterate `getAllScheduledNotificationsAsync`, cancel those whose data.kind matches) — never
     `cancelAllScheduledNotificationsAsync` (future features may schedule too).
  5. Body is GENERIC/PII-free, e.g. title `"Calorie Counter"`, body `"Time to log your {label} 🍽️"`
     where `label` is the user's own reminder label (a plain word like "breakfast"); **no meal/health
     data ever**.
- `cancelAllOurs()` — used on sign-out and when disabled.
- Trigger shape (SDK 56, from the versioned docs): `{ type: Notifications.SchedulableTriggerInputTypes.DATE, date }` for a specific next occurrence (single-fire; we re-arm on foreground). (DAILY repeats can't be conditionally suppressed, so we do NOT use them.)

### Wiring — `use-reminders.tsx` (hook) + mount
- A `useReminders()` hook (mounted ONCE in `src/app/(app)/_layout.tsx`, the authed area) that:
  - on mount + on `AppState` change to `active` + on `userId` change → `reconcile(userId)` (guarded by
    a `mounted` ref; best-effort, swallow errors — reminders never block the UI).
  - on sign-out (`userId` null) → `cancelAllOurs()`.
- After a successful meal save (capture-screen's save-success path, and meal-edit if it creates a log) →
  fire-and-forget `reconcile(userId)` so the just-satisfied window's reminder is cancelled immediately.
- Settings changes call `savePrefs` then `reconcile(userId)`.

### Settings UI — a "Reminders" section in `settings-screen.tsx`
- Master **toggle** (reuse the existing `SelectGroup` on/off, or a plain two-Button row) — on first
  enable, call `ensurePermission()`; if denied, show a static note ("Enable notifications for Calorie
  Counter in iOS Settings") and leave the toggle off.
- When enabled: a row per reminder with its **label** + an editable **time** via a NEW `TimeField`
  (mirrors `DateField`: `@react-native-community/datetimepicker` `mode="time"` in a centered modal, WITH
  a `.web.tsx` fallback so the web bundle never imports the native module). v1 keeps the fixed 3
  default reminders (edit time only); add/remove is a possible follow-up (keep scope tight).
- Prefs are device-local, so this section saves independently of the Supabase profile/goals Saves (its
  own tiny save → AsyncStorage → reconcile). No Supabase write.

### Config plugin — `app.json`
Add `"expo-notifications"` to `plugins` (minimal config; reuse existing icon/color if an asset is handy,
else omit icon for now — local notifications in Expo Go don't need it). NOTE: the plugin only affects
prebuilt/standalone/dev builds; **local scheduling works in Expo Go on iOS today**, so device testing
needs no rebuild.

## Files to change
- `package.json` — add `expo-notifications` via `npx expo install`.
- `app.json` — add the `expo-notifications` plugin entry.
- `src/features/notifications/lib/reminders.ts` — NEW pure time/window helpers.
- `src/features/notifications/lib/reminder-prefs.ts` — NEW AsyncStorage load/save (per-user, defaults).
- `src/features/notifications/lib/notification-service.ts` — NEW expo-notifications wrapper (web-guarded).
- `src/features/notifications/lib/use-reminders.tsx` — NEW hook (AppState + userId reconcile).
- `src/shared/ui/time-field.tsx` (+ `time-field.web.tsx`) — NEW time picker (mirrors date-field).
- `src/shared/ui/index.ts` — export `TimeField` + `TimeFieldProps` (R7).
- `src/app/(app)/_layout.tsx` — mount `useReminders()` once.
- `src/features/auth/screens/settings-screen.tsx` — Reminders section (toggle + TimeField rows).
- `src/features/capture/screens/capture-screen.tsx` (+ meal-edit path) — reconcile after a successful save.

## Data model / schema impact
None. Purely device-local (AsyncStorage). No migration, no RLS change. The only DB read is an
owner-filtered `select('eaten_at')` on `meal_logs` (already RLS-protected; strict single-column
allowlist).

## Edge cases & failure modes
- **Permission denied / undetermined:** reconcile still schedules; OS silently drops delivery. UI shows
  the "enable in iOS Settings" note. Never crash. Re-check permission on each enable.
- **Web export:** the service/hook must `Platform.OS === 'web'` no-op, and `time-field.web.tsx` avoids
  importing the native picker — so `expo export --platform web` bundles clean (verify triad's authority).
- **Sign-out mid-schedule / account switch:** prefs keyed by userId; on sign-out `cancelAllOurs()`; the
  hook's `mounted` ref + userId dependency prevent a stale reconcile from a previous user.
- **DST / clock change:** we schedule a concrete next-occurrence `Date` and re-reconcile every
  foreground, so at most one nudge is off by the DST hour until the next app open — acceptable.
- **Duplicate scheduling:** reconcile cancels OUR tagged notifications first, then schedules the fresh
  set — idempotent; repeated foregrounds don't stack duplicates.
- **Timezone travel:** device-local wall-clock is intended (a 9am nudge should be 9am wherever you are).
- **Privacy (health PII):** notification bodies contain only the user's own reminder label + a fixed
  string — never a dish name, allergen, or condition. The `eaten_at` query never selects or logs any
  other column. No analytics.
- **React Compiler / strict hooks:** the hook uses `useEffect` + refs only (AppState subscription with
  cleanup, userId dep); no setState-in-effect beyond the sanctioned patterns; the service is plain
  async functions (no hooks).

### Limitations (documented, acceptable for v1)
- If the user does NOT open the app for multiple days, only the already-scheduled next occurrence(s)
  fire; further days re-arm on the next foreground. (A user not opening the app also isn't logging, so a
  missed nudge is low-harm; true always-on delivery would need server push — explicit non-goal.)
- Window model assumes reminders are the day's meal checkpoints; a meal logged far outside any window
  still counts toward "today" only within the specific window it falls in.

## Test / verify plan
- `npx tsc --noEmit` → 0; `npx expo lint` → 0; `npx expo export --platform web` → success (proves the
  web-guarding + `.web.tsx` fallback keep the native module out of the web bundle).
- Manual (Expo Go, iPhone): enable reminders → grant permission; set a reminder ~2 min out; DON'T log →
  it fires. Repeat: set ~2 min out, LOG a meal in that window → it does NOT fire. Toggle off → nothing
  fires. Sign out → nothing fires. Kill/reopen app → reminders persist/re-arm.

## Rollout
Adds a native module (`expo-notifications`) but **local notifications run in Expo Go on iOS**, so no dev
build is needed to test. The `app.json` plugin matters only for a future standalone/dev build. Commit to
`main`; the user reloads Expo Go. (A future standalone build will pick up the plugin automatically.)

## Open questions
- ~~Keep v1 at the fixed 3 default reminders (edit-time-only), or allow add/remove now?~~ **RESOLVED:
  v1 = the fixed 3 default reminders, EDIT-TIME-ONLY. Labels are a CLOSED ENUM (breakfast/lunch/dinner),
  never user free-text** (privacy — see Review R9). Add/remove is a possible later plan and, if it ever
  ships, labels must stay a curated list (never free text into a notification body).

---

## Review
Four parallel reviewers (correctness, architecture, edge-cases, data/privacy). **Verdict: NEEDS CHANGES
→ resolved. 1 BLOCKER + 11 SHOULD-FIX, all folded into the spec below.** The core architecture —
LOCAL-only, single-fire `DATE` triggers + reconcile (foreground / after-save / settings), tag-and-cancel
by `content.data.kind`, AsyncStorage prefs keyed by userId, mount once in `(app)/_layout.tsx` — was
endorsed by all four as correct and right-sized. The "local notifications run in Expo Go on iOS (no dev
build to test)" claim was **confirmed against the v56 docs** before review.

### BLOCKER (resolved in spec)
- **B1 — Serialize `reconcile`.** Its three triggers (AppState→active, after-save, settings-save)
  genuinely overlap (e.g. closing the time/image picker cycles background→active while a save reconcile
  runs). `getAllScheduledNotificationsAsync → cancel ours → schedule` is NOT atomic, so two interleaved
  runs both cancel then both schedule → duplicate banners. **Fix:** a module-level in-flight promise —
  `reconcile` chains/coalesces so a second call awaits the first (never runs concurrently). The
  "idempotent" claim only held for sequential runs; this makes it true.

### SHOULD-FIX (all folded into spec)
- **R1 — Reconcile-after-save must fire POST-COMMIT, not at save initiation.** Today `MealReview` exposes
  only `onSaving` (fires before the `create_meal_log` RPC commits) — reconciling there would requery
  before the row exists (read-after-write miss). **Fix:** add an `onSaved?: () => void` to `MealReview`,
  call it in the success branch (`result.ok || conflict`, meal-review.tsx ~L113), and fire
  `reconcile(userId)` from `capture-screen` (which has `useUser`). Post-commit ⇒ Supabase reads its own
  write; no race. (`meal-edit` only UPDATES eaten_at → foreground reconcile covers it; also reconcile
  there for immediacy. Invariant: EVERY path that writes `meal_logs` reconciles.)
- **R2 — Web-import safety: guard the top-level `setNotificationHandler`.** In-function
  `Platform.OS==='web'` no-ops do NOT protect module-top-level code, which runs at import — and
  `notification-service` is reachable from the web bundle via `use-reminders` → `(app)/_layout`. **Fix:**
  wrap the top-level handler registration in `if (Platform.OS !== 'web')` (or a `.web.tsx` no-op stub).
  `expo export --platform web` is the gating check for this.
- **R3 — Use the SDK 56 handler fields.** `handleNotification` must return **`shouldShowBanner` +
  `shouldShowList`** (+ `shouldPlaySound:false`, `shouldSetBadge:false`); the old `shouldShowAlert` is
  deprecated and won't present a foreground banner. (Confirmed vs v56 docs.)
- **R4 — Sort + dedupe reminder times before computing windows.** `windowStartMinutes` assumes a sorted
  array; equal times produce an empty `(t, t]` window → that reminder can NEVER be suppressed AND both
  fire at the same minute. **Fix:** `reconcile` sorts first; the settings UI disallows/collapses
  duplicate times (v1's fixed 3 defaults are already distinct, but editing could collide).
- **R5 — Handle permission REVOKED-after-enable.** If the user enables (granted) then revokes in iOS
  Settings, `enabled` stays true and reconcile schedules into a black hole (silent). **Fix:** reconcile
  reads `getPermissionsAsync`; when not granted while `enabled`, it does NOT schedule and the Settings
  section surfaces the "enable notifications in iOS Settings" note (re-checked on each foreground).
- **R6 — Leak-safe cancel sequencing (64-pending cap).** If the cancel step throws but scheduling still
  proceeds, each reconcile adds 3 without removing 3 → drifts toward iOS's 64-pending cap. **Fix:**
  a failed cancel ABORTS scheduling (don't schedule a fresh set unless the old set was verifiably
  cleared). Errors are still swallowed for the UI, but not in a way that compounds.
- **R7 — Export `TimeField` from the `@/shared/ui` barrel** (`src/shared/ui/index.ts`), mirroring
  `DateField`/`DateFieldProps`, or the settings import won't resolve by convention. (Added to Files.)
- **R8 — AppState listener filters to `next === 'active'` ONLY** (mirror `use-current-day-key.tsx`): iOS
  also emits `inactive` for the app-switcher/sheets/calls; reconciling on those wastes a DB read. Fire
  reconcile from the callback, register in an effect returning `sub.remove()`, dep `[userId]`.
- **R9 — Privacy: reminder `label` is a CLOSED ENUM, never free-text.** A notification body renders on the
  lock screen / notification center — a free-text label is a health-PII surface (a user could name it
  after a condition/med/dish). v1 labels are the fixed breakfast/lunch/dinner set; any future rename must
  stay a curated list. `content.data` carries ONLY `{ kind: 'meal-reminder' }` — no time, no label.
- **R10 — Privacy: NO argument logging in the service/hook.** Swallow errors with no raw error object, no
  `eaten_at`, no minute arrays, no counts — a fixed structural string at most (matching the project's
  `kind`-label convention). No analytics on reminder fire/schedule.
- **R11 — Reuse the typed `eaten_at` allowlist, not a raw `select('eaten_at')` string.** Use a
  `Pick<Database['public']['Tables']['meal_logs']['Row'],'eaten_at'>` + a named column constant (or reuse
  `useOwnedMealRows`, which already fetches `eaten_at`) so an accidental widening is a compile error —
  consistent with `use-owned-meal-rows.tsx`. Owner filter `.eq('user_id', userId)` stays explicit.

### NIT (acknowledged; apply where cheap)
- Device-local wall-clock (when to fire) vs profile-tz (dashboard "today") divergence is INTENTIONAL —
  a 9am nudge fires at 9am where the phone is; `Date.getHours()` also sidesteps the Hermes/full-ICU
  `timeZone` caveat. Keep the explicit callout so it's not "fixed" later.
- No catch-up nudge for a window already past on a late app-open (can't schedule the past → tomorrow);
  matches "wall-clock nudge" intent. Use `>` at the exact-minute boundary consistently.
- Sign-out: `cancelAllOurs()` runs; stored prefs INTENTIONALLY persist (userId-keyed, generic labels
  only) for re-login convenience — documented, not a leak. (Revisit if labels ever become editable.)
- DST spring-forward normalizes a skipped-hour time; self-heals next foreground.
- Corrupt/missing prefs JSON → defaults (`enabled:false`) — fail-safe (a silent OFF, acceptable).
- Edit-time-only quirk: setting breakfast to 14:00 reorders windows but keeps the fixed label — known
  v1 cosmetic quirk.
- "Unit-testable" helpers earn their split (matches `history-filter.ts`), but there is NO test runner in
  the repo — the verify triad is tsc/lint/export only; don't imply a test step.

## Execution log
Implemented per the approved plan + all resolutions (B1, R1–R11).
- `expo-notifications@~56.0.25` installed; `"expo-notifications"` added to `app.json` plugins.
- `src/features/notifications/lib/reminders.ts` — NEW pure helpers: `Reminder`/`ReminderLabel` (closed
  enum) / `ReminderPrefs`, `DEFAULT_PREFS` (OFF), `normalizeReminders` (sort + dedupe by minute — R4),
  `isWindowSatisfied` (`(prev, this]`, first window opens at start-of-day), `nextOccurrence` (`>` boundary,
  today-if-future-&-unsatisfied else tomorrow), `localMinutesOfDay`/`startOfLocalDay` (device-local).
- `src/features/notifications/lib/reminder-prefs.ts` — NEW AsyncStorage load/save keyed by userId;
  fail-safe validation → defaults on absent/corrupt (never throws); no logging (R10).
- `src/features/notifications/lib/notification-service.ts` — NEW wrapper: web-guarded top-level
  `setNotificationHandler` with SDK-56 fields `shouldShowBanner`/`shouldShowList` (R2, R3);
  `ensurePermission`/`hasPermission`; `reconcile` SERIALIZED behind a promise chain (B1); cancel ONLY
  our `data.kind==='meal-reminder'` notifications, a failed cancel ABORTS scheduling (R6); permission
  re-check aborts scheduling when revoked (R5); `eaten_at` typed `Pick<>` allowlist + `.eq('user_id')`
  (R11); DATE single-fire triggers; PII-free body (fixed string + closed-enum label), `data` = `{kind}`.
- `src/features/notifications/lib/use-reminders.tsx` — NEW hook: reconcile on mount/userId + AppState
  `'active'` only (R8); cancel on sign-out; holds no state (clean under React Compiler).
- `src/shared/ui/time-field.tsx` (+ `.web.tsx`) — NEW time picker mirroring DateField (native `mode="time"`
  centered modal; web = strict `HH:MM` Input). Exported from `src/shared/ui/index.ts` (R7).
- `src/app/(app)/_layout.tsx` — mount `useReminders()` once (beside `useTimezoneHeal`).
- `src/features/notifications/components/reminders-section.tsx` — NEW self-contained Settings section
  (on/off + permission flow + 3 TimeField rows; immediate persist + reconcile). Placed in
  `settings-screen.tsx` between Daily goals and Legal.
- Reconcile-after-write (R1 invariant): `MealReview` gained an `onSaved` (fired post-commit on ok/conflict)
  → capture-screen reconciles; `edit-meal-screen` reconciles after a successful `updateMeal` (eaten_at can
  move a meal across a window). Delete is left to the next foreground reconcile (a re-nudge right after a
  delete would be undesirable).
- **Verify:** tsc 0 · expo lint 0 · web export success (proves the native module stays out of the web
  bundle). Local notifications run in Expo Go on iOS → test via reload, no dev build.
