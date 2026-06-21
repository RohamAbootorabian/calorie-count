# Plan: Profile & Settings — edit profile + goals, move Sign out (S1 · piece 3)

- **Status**: Approved (2026-06-19) — multi-agent review passed; 2 blockers resolved
  in-plan (imperial state model + unit-aware validation); 8 should-fixes folded in; all
  5 open questions decided.
- **Created**: 2026-06-19
- **Plan #**: 0006

## Problem / Goal
The signed-in user has no place to manage their account. The only way to sign out is
an **interim button bolted onto Home** (plan 0004 SF4/N4), and the targets computed
during onboarding (plan 0005) can't be viewed or changed. We need a **Profile &
Settings** screen that lets the user:
- see/edit their **profile** — `display_name`, `units` (metric/imperial), `timezone`
  (backed by `profiles`),
- see/edit their **daily goals** — recomputing calories + macros from the stored raw
  body inputs (`age/sex/height_cm/weight_kg` on `goals`) via the existing `tdee.ts`,
- **sign out** (moved here; removed from Home).

This **closes S1 (Auth & Onboarding)**. Imperial *display* — deferred from plan 0005
(metric-only inputs) — lands here, since editing goals is where units actually matter.

**Done looks like:**
- A new **Profile** tab in `(app)` opens the settings screen.
- The screen shows the current profile + daily targets and lets the user edit and
  **save** each; saves persist to `profiles` / `goals` and survive reload.
- Editing body inputs **recomputes** calories + macros through `computeGoals` (same
  math as onboarding) and upserts `goals` (raw inputs kept populated — plan 0005 SF5).
- With `units = imperial`, body fields are **displayed/edited** in imperial and stored
  back as metric (storage stays canonical metric — plan 0005 N4).
- Home is back to the plain template (no Sign out button); Sign out lives in Settings.
- `tsc` + `lint` pass; verified on web.

## Non-goals
- **Schema/migration changes** — `profiles` and `goals` already have every column we
  need (verified). This piece is UI + data-layer only.
- **Re-running the 5-step onboarding wizard for edits** — editing is a single-screen
  form (see approach); the stepped wizard stays onboarding-only.
- **Account deletion, change email/password, avatar upload** — later/own tasks.
- **Full timezone picker / IANA validation** — v1 keeps timezone minimal (see OQ4).
- **Localizing units beyond metric/imperial**, ft+in split entry (OQ2), or athlete/
  clinical TDEE formulas (plan 0005 non-goal, unchanged).
- **Custom SMTP / email flows** — unrelated infra (tracked in HANDOFF).

## Proposed approach

### Where it lives (matches piece 1 & 2 — flat S1 module)
- `src/features/auth/screens/settings-screen.tsx` — the screen.
- `src/features/auth/lib/use-profile.tsx` — `{ loading, profile, error, refetch }`
  profile fetch hook (plain hook; **not** a context — only the settings screen needs
  it, unlike `useOnboardingStatus` which the gate consumes).
- `src/features/auth/lib/profile-form.ts` — pure profile-field validators
  (`display_name` ≤ 80 mirroring the DB check; units; timezone) + the imperial⇄metric
  **display** conversion helpers for the goals editor.
- `src/app/(app)/profile.tsx` — thin route → `<SettingsScreen/>`.
- Reuses `tdee.ts` (`computeGoals`) and `onboarding-form.ts` (bounds + validators +
  `toMetricInput`) from plan 0005 unchanged in contract; **adds reverse conversions**
  (`cmToInches`, `kgToPounds`) next to the existing forward ones.

**PII discipline (plan 0005 SF4):** never log `display_name` or any body metric /
BMR/TDEE; validation shows per-field copy, never the rejected value.

### The screen — three sections on one scrollable `Screen`
Built entirely on `@/shared/ui` (`Screen`, `Card`, `Text`, `Input`, `Button`).

1. **Profile**
   - `display_name` — `Input` (optional; trimmed; empty → store `null`; ≤ 80).
   - `units` — two `Button` rows (Metric / Imperial), selected = `primary` (reuse the
     plan-0005 SF3 pattern; no new primitive). Switching units **re-labels and
     re-converts** the goals editor's displayed values live (state-derived, no refetch).
   - `timezone` — minimal in v1 (OQ4): a read-only display of the stored value with a
     single "Use device timezone" action (no free-form IANA typing to validate).
   - **Save profile** → `supabase.from('profiles').update({...}).eq('id', user.id)`
     (the row always exists via the `handle_new_user` signup trigger — so UPDATE, not
     insert). RLS `profiles_update` enforces `auth.uid() = id`.

2. **Daily goals** (inline editor — *not* the stepped wizard)
   - Shows current targets (calories + protein/carbs/fat) from `goals`.
   - Editable fields (all on one screen): age, sex, height, weight, activity, goal —
     **pre-filled** from the stored raw inputs, with height/weight shown in the active
     units. Reuses `onboarding-form.ts` validators (metric bounds) after converting any
     imperial input back to metric.
   - A live **Review** of the recomputed targets (same `computeGoals`), incl. the
     `clampedToMinimum` note (plan 0005 N5).
   - **Save goals** → `computeGoals(metric)` → `supabase.from('goals').upsert({ user_id,
     calories, protein, carbs, fat, weight_goal, activity_level, age, sex, height_cm,
     weight_kg }, { onConflict: 'user_id' })` — identical write shape to plan 0005 B5
     (idempotent; client supplies `user_id`; RLS `WITH CHECK` is the boundary).

3. **Sign out** — `Button variant="secondary"` calling `useAuth().signOut()` (moved
   verbatim from Home). The root gate flips to `(auth)`; mounted-ref guards any
   post-`await` setState (plan 0004 SF2 / plan 0005 SF6).

### Units conversion contract (display only; storage stays metric — N4)
- Load: `goals.height_cm`/`weight_kg` are metric. If `units = imperial`, display
  `cmToInches(height_cm)` / `kgToPounds(weight_kg)` (rounded for the field).
- Save: parse the displayed value; if imperial, `inchesToCm` / `poundsToKg` back to
  metric **before** validation (bounds are metric) and `computeGoals`.
- The DB only ever stores metric; `units` is a display preference. Round-trips never
  mutate the canonical metric value unless the user actually edits the field.

### Navigation entry — a third `(app)` tab "Profile" (OQ1)
Add a `Profile` trigger to **both** tab bars:
- `src/components/app-tabs.tsx` (native `NativeTabs`) — needs a PNG icon at
  `assets/images/tabIcons/profile{,@2x,@3x}.png` (native triggers require an icon).
- `src/components/app-tabs.web.tsx` (web `expo-router/ui` Tabs) — text label only.
- New route file `src/app/(app)/profile.tsx`.

## Files to change
- `src/features/auth/screens/settings-screen.tsx` — NEW: the screen (3 sections).
- `src/features/auth/lib/use-profile.tsx` — NEW: profile fetch/refetch hook.
- `src/features/auth/lib/profile-form.ts` — NEW: profile validators + display copy.
- `src/features/auth/lib/onboarding-form.ts` — add `cmToInches` / `kgToPounds` reverse
  helpers next to the existing forward ones (small, additive; keeps all unit
  conversion in one module).
- `src/app/(app)/profile.tsx` — NEW: thin route → `<SettingsScreen/>`.
- `src/components/app-tabs.tsx` — add the Profile native tab (+ icon require).
- `src/components/app-tabs.web.tsx` — add the Profile web tab.
- `assets/images/tabIcons/profile{,@2x,@3x}.png` — NEW: native tab icon (OQ1).
- `src/app/(app)/index.tsx` — remove the interim Sign out button + its `useAuth`
  import; restore the plain template hero.

## Data model / schema impact
**None.** `profiles(display_name, units, timezone)` and `goals(age, sex, height_cm,
weight_kg, calories, protein, carbs, fat, weight_goal, activity_level)` already exist
(plan 0001 + plan 0005). No new columns, tables, RLS, storage, or types regen. Existing
RLS (`profiles_update`, `goals_insert/update` with `auth.uid()` checks) and the
`set_updated_at` trigger on both tables fully cover every write here.

## Edge cases & failure modes
- **Profile row somehow missing** (trigger failed / legacy) → `maybeSingle()` returns
  null; treat as a blank profile (defaults: units `metric`, no name) and **upsert** on
  save so it self-heals.
- **Goals row missing** — can't happen for a user inside `(app)` (the plan-0005 gate
  only admits users *with* a goals row). Defensive: if null, hide the goals editor and
  show a "complete onboarding" hint rather than writing a half row.
- **Unit switch mid-edit** — re-label + re-convert displayed body values from the
  canonical metric state; never lose precision by round-tripping the *displayed* number.
- **Out-of-range / empty body inputs** — reuse plan-0005 validators (metric bounds);
  for imperial, convert to metric first so the same bounds apply (a valid form can't be
  rejected by the DB checks).
- **`display_name`** — optional; trim; empty → `null`; > 80 chars blocked client-side
  (mirrors the DB `char_length <= 80` check).
- **Offline / save fails** — friendly per-section error; keep the user's edits (don't
  reset the form); idempotent upsert means a retry never dups.
- **Double-tap Save** — `Button` in-flight guard + mounted-ref on post-`await` setState.
- **Sign out from Settings** — gate flips to `(auth)`; mounted-ref prevents
  setState-after-unmount.
- **`computeGoals` throws** (defensive; form should block) → show a friendly error,
  don't write.

## Test / verify plan
- `npx tsc --noEmit` + `npx expo lint` clean (new `profile` route regenerates typed
  routes — expect the one-build churn from the piece-1/2 lesson).
- `npx tsx scripts/check-tdee.ts` still green (we only *add* reverse converters; the
  formula is untouched). Optionally extend it with a metric⇄imperial round-trip assert.
- **Manual on web** (confirmed test user, who now has a goals row):
  1. Open the **Profile** tab → see current name/units + daily targets.
  2. Edit `display_name`, Save → reload → persists.
  3. Toggle units to **imperial** → body fields relabel (in/lb) and show converted
     values; edit weight, Save goals → targets recompute; verify the `goals` row in
     Supabase stores **metric** and the recomputed calories/macros match `tdee.ts`.
  4. Toggle back to metric → values convert back consistently.
  5. Enter a bad body value (0 / out of range) → blocked with per-field copy.
  6. **Sign out** from Settings → routed to `(auth)`; no console error.
  7. Confirm **Home** no longer shows a Sign out button.
- Verify the written `profiles` / `goals` rows match the UI.

## Rollout
1. Review this plan (`/review-plan`); resolve blockers before coding.
2. No migration / no secrets. Build: reverse converters → `use-profile` + `profile-form`
   → `settings-screen` → route → both tab bars (+ icon) → strip Home's Sign out.
3. Verify per above; append `docs/JOURNAL.md`; mark Done; **commit straight to `main`**
   and push (sequential, no PRs). Update HANDOFF: **S1 complete.**

## Open questions — all resolved during review (2026-06-19)
1. **Navigation entry & icon → third `(app)` "Profile" tab + placeholder icon.** ✅ Add a
   Profile tab to both tab bars; commit a **placeholder** PNG now (copy an existing
   `tabIcons/*` set → `profile{,@2x,@3x}.png`) so the native build doesn't break; real art
   is a later task. (SF7.)
2. **Imperial input shape → single decimal fields (inches, pounds).** ✅ No ft+in split in
   v1. Bounds/validation per B2; conversion via `parseNumber`→`inchesToCm`/`poundsToKg`.
3. **Goals editing UX → inline single-screen editor.** ✅ Not a re-run of the stepped
   wizard. Reuses the shared validators/options/`computeGoals` (SF1); live Review.
4. **Timezone → read-only display + "Use device timezone" action.** ✅ No free-form IANA
   typing in v1; `Intl`-unavailable / null-or-invalid value handled per N3. Full picker
   defers to the diary/day-boundary feature.
5. **`display_name` → optional.** ✅ Nullable; trim; empty→`null` (SF4); ≤80 client-side.

---

## Review
_Multi-agent review (4 lenses: correctness, architecture, edge cases, data/privacy),
2026-06-19. Consolidated & deduped._

**Verdict: NEEDS CHANGES → 2 blockers. Both are about the imperial-units feature (the
headline of this piece). Resolutions applied to the approach below; 4 open questions
still need a product decision before coding (see updated Open questions).**

> Note (deduped): three reviewers flagged "reverse converters `cmToInches`/`kgToPounds`
> are missing" as a blocker. They don't exist *yet* because this plan adds them — the
> approach already lists it. Not a plan defect; it's the first build step. Folded into
> B1's resolution so the contract (rounding) is pinned down.

### BLOCKER
- **B1 — Imperial⇄metric round-trip drifts the canonical metric, and the state model
  is unspecified.** (Correctness #2, Edge #5, Arch #8.) If the editor stores the
  *displayed* imperial string and converts it back on save, an **unedited** field still
  drifts (`cmToInches(180)=70.87 in` → `inchesToCm(70.87)=179.91 cm`), corrupting stored
  data on every save, and a unit toggle that re-derives from the displayed number
  compounds it. **Resolution:** the goals editor holds the **DB metric values as the
  single source of truth** in state; each input field is an independent display string.
  - On load / unit toggle: derive each field's display string from the canonical metric
    (`cmToInches`/`kgToPounds` for imperial), **rounding for display only** — height to
    1 decimal (in or cm), weight to nearest whole (lb) / 1 decimal (kg).
  - **Dirty-tracking:** convert display→metric and overwrite the canonical value **only
    for fields the user actually edited**; unedited fields persist the stored metric
    **verbatim** (no convert-back). A unit toggle re-derives display strings from the
    canonical metric and **never** writes back.
  - Pin the converter contract in `onboarding-form.ts`: `inchesToCm`/`poundsToKg` already
    exist; add `cmToInches`/`kgToPounds` as exact inverses (no internal rounding — the UI
    rounds at the display edge).
- **B2 — Validation must run in the active display units, with matching bounds + copy.**
  (Correctness #3, Edge #10, Arch #8.) Reusing the metric validators on imperial fields
  yields nonsensical copy ("Enter a height (cm) between 50 and 272") on an inches field,
  and toggling units while a value is invalid shows stale metric bounds. **Resolution:**
  add **unit-aware goal validators** (in the shared goals module, see SF1) that take the
  raw string + `units` and validate against the **display-unit bounds** derived from the
  metric bounds (e.g. height 50–272 cm ⇒ ~19.7–107.1 in; weight 20–500 kg ⇒ ~44–1102 lb),
  with copy in the shown unit. Conversion to metric for `computeGoals` happens **after**
  the value passes. On unit toggle, **clear field errors** (or re-validate) so bounds/copy
  always match what's on screen. A value valid in metric stays valid after toggle and
  vice-versa (bounds are exact conversions of each other).

### SHOULD-FIX
- **SF1 — Don't duplicate goal validators; reuse (and lightly extend).** (Arch #3/#4.)
  The goals editor uses the *same* fields/bounds/options as onboarding. **Do not** write
  parallel validators in `profile-form.ts`. Import `validateAge`, `SEX_OPTIONS`,
  `ACTIVITY_OPTIONS`, `GOAL_OPTIONS`, `toMetricInput`, bounds from `onboarding-form.ts`
  directly; add the B2 unit-aware height/weight validators **there** (or a small
  `goals-form.ts` it re-exports) so the wizard and settings share one source. Keep
  `profile-form.ts` for profile-only concerns (`display_name`/`timezone` + nothing else).
- **SF2 — `use-profile` stays a plain hook, but needs the lifecycle guard.** (Arch #2 said
  make it a context — **rejected:** unlike `useOnboardingStatus` (consumed by *both* the
  gate and the wizard), the profile is read by *one* screen, which owns the instance and
  can call its own `refetch()` after save. A context adds a provider for no second
  consumer.) **Resolution:** keep the plain hook, but copy `useOnboardingStatus`'s
  `mounted`/`active` guards so a sign-out mid-fetch can't setState-after-unmount
  (Edge #11), and `refetch()` after a successful save.
- **SF3 — Independent per-section saves, not atomic.** (Edge #4.) Profile and goals are
  separate rows; a single "Save all" that half-succeeds is confusing. **Resolution:**
  two separate Save buttons ("Save profile" / "Save goals"), each with its own in-flight
  state + error; neither blocks the other. Document that they're independent.
- **SF4 — Normalize `display_name` empty → `null` explicitly.** (Data #1, Edge #7.) The DB
  `char_length<=80` check accepts `''`, so a blank must be coerced: write
  `name.trim() || null`. Mirror the ≤80 bound client-side (no value echoed in the error).
- **SF5 — Never send `updated_at` in the write payloads.** (Data #3.) The `set_updated_at`
  trigger owns it on both tables; the client payload must omit it even though the generated
  `Update` type marks it optional.
- **SF6 — Goals upsert must write a COMPLETE body-input set.** (Data #4, plan-0005 SF5.)
  Block the goals save unless age/sex/height_cm/weight_kg are all present & valid after
  conversion — never partial-write `null` into a populated row and break the invariant.
- **SF7 — Tab icon asset decision (native build breaks without it).** (Arch #1/#5,
  Correctness #7.) `NativeTabs.Trigger.Icon` needs a real PNG; the file doesn't exist yet.
  **Resolution (pending OQ1):** if we keep the tab, commit a **placeholder** icon now (copy
  an existing `tabIcons/*` set to `profile{,@2x,@3x}.png`), real art later; otherwise use a
  non-tab entry. Don't leave a dangling `require()`.
- **SF8 — Locale-comma + parse path for imperial.** (Edge #3.) Route imperial input through
  the existing comma-tolerant `parseNumber` **before** `inchesToCm`/`poundsToKg`, so
  `"80,5"` lb doesn't become `NaN`.

### NIT
- **N1 — Goals-row-missing copy.** (Edge #2.) The defensive null-goals branch should read as
  a rare account-state issue ("finish onboarding / contact support"), distinct from input
  errors. The `(app)` gate normally guarantees the row.
- **N2 — Token-expiry mid-edit.** (Edge #8.) Map a 401/403 on save to "Your session
  expired — please sign in again" (reuse the `getAuthErrorMessage` style), distinct from a
  network error.
- **N3 — `Intl` / device-timezone fallback + null/invalid timezone.** (Edge #6, Arch #9.) If
  `Intl.DateTimeFormat().resolvedOptions().timeZone` is unavailable, keep the stored value;
  display a null/invalid `timezone` as "Not set" with the "Use device timezone" heal action.
- **N4 — Reaffirm PII discipline on the edit path.** (Data #5, Arch #7.) Same as onboarding:
  validators return generic copy; never log `display_name`, body metrics, or BMR/TDEE.
- **N5 — Always source `user.id` from `useUser()`.** (Data #6.) Never accept an id param to
  the save fns; RLS `WITH CHECK` is the boundary but the client must pass its own id.
- **N6 — Web tab `href`.** (Arch #6.) The web Profile trigger needs `href="/profile"`.
- **N7 — Optional: extract a shared `<GoalsForm/>` used by both wizard and settings.** (Arch
  #4.) Nice-to-have dedupe of the *UI*, not just validators; defer unless it falls out
  cleanly during execution.

### Praise (reviewers concurred)
"No schema change" is correct and verified (profiles + goals already hold every column;
RLS + `set_updated_at` cover the writes). Strong reuse of plan-0005 patterns (tdee.ts,
mounted-ref, upsert, `@/shared/ui`, SF3 button-rows). Keeping storage canonical-metric
and units as display-only is the right call.

### Resolution status
B1, B2 resolved in-approach above (state model + unit-aware validation pinned). SF1–SF8
folded into Files/Approach/Edge sections. **Open product decisions (OQ1–OQ5) still need
the user** before this is Approved — see Open questions.

## Execution log
<!-- Filled during execution: what actually happened, any deviation from the plan
     and why, final verification result. -->
