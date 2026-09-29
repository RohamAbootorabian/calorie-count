# Plan: Allergen safety disclaimer copy

- **Status**: ~~Draft~~ → ~~In Review~~ → ~~Approved~~ → ~~In Progress~~ (2 blockers resolved in body) → **Done** (2026-09-29)
- **Created**: 2026-09-29
- **Plan #**: 0044

## Problem / Goal
Nothing in the app says the allergen warning is an **AI estimate**. The privacy policy's only
mention is descriptive — it "can flag likely allergen conflicts"
(`src/features/legal/privacy-content.ts:56`) — and there is no Terms of Service.

Plan 0043 made the warning much more precise (it now fires only on a per-item tag from a declared
allergen). That is the right trade, but it moves risk from false alarms to **false reassurance**:
after 0043, the absence of a red box looks like a verdict. It isn't. The model can miss an
ingredient that isn't visible, isn't in the note, or isn't listed as its own item — and if the
profile read fails, the check is skipped entirely (0043 surfaces that as "Allergy check unavailable",
which also needs context).

This was raised by the privacy reviewer in 0043 and accepted by the user as a follow-up.

**Done =** a user with a declared allergy sees, in plain language and without hunting for it:
1. on the meal review card — that allergen alerts are AI estimates, can miss things, and are not
   medical advice **(shown whether or not a warning appears)**;
2. where they declare the allergy (onboarding + Profile) — what the data is used for and its limits,
   before they rely on it;
3. in the privacy/legal copy — the same claim, so the written terms match the UI.

## Non-goals
- No change to when a warning fires, to the Edge Function, the prompt, or the schema (0043 owns all
  of that). In particular, **this plan does not make conditions produce allergen checks** — it only
  makes that behaviour visible (blocker B1).
- No modal, no dismiss-and-remember, no per-user acknowledgement state. Static copy only; nothing new
  is persisted and nothing new is sent to OpenAI.
- Not a Terms of Service. It is still missing, and it was **never actually tracked** (only a non-goal
  in plan 0010) — so this plan adds the tracking line rather than pretending it exists.
- **Deferred, named so they don't get lost like the ToS did:** App Review 1.4.1 (physical-harm)
  framing and App Store metadata copy; the App Privacy "Health & Fitness" label for
  `profiles.allergies` / `conditions`; localization of safety copy (the app is English-only, yet 0043
  notes users may write their allergies in Persian).
- No new UI primitive. `<Text type="small" themeColor="textSecondary">` inline is already the house
  idiom.
- Not blocking or gating the flow — the user must never have to tap through a warning to log a meal.

## Proposed approach
**One place for the strings, three surfaces.** Constants live in `src/constants/legal.ts` — the
location `privacy-content.ts:15-16` already anticipates ("a future `src/constants/legal.ts`
extraction"). `privacy-content.ts` imports from there like every other feature imports from
`src/constants/`, so `capture` and `auth` never import from the `legal` feature.

### The wording (blockers B1 + B2)
A missing red box has **three** meanings today: the model checked and found nothing; the user
declared no allergies so no check ran at all; or it's a History edit, where a check never runs. The
first draft ("Allergen alerts are AI estimates and can miss ingredients") only covered the first and
would imply to everyone else that a check happened. The final strings therefore say *what is
checked and when*, and stay true on every screen and for every user:

- `ANALYSIS_DISCLAIMER` (review card): **"Calories, macros and allergens here are AI estimates and
  can be wrong or incomplete. We only check allergies you've entered in your profile, and only when
  a meal is analyzed. Not medical advice — always check ingredients or ask before eating."**
- `ALLERGY_FIELD_HINT` (allergy question): **"Used to flag possible allergens when a meal is
  analyzed. AI estimates can miss things — always check ingredients yourself."**
- `CONDITION_FIELD_HINT` (conditions question — **B1**): **"Conditions aren't used for allergen
  alerts. List food allergies or sensitivities in the question above."**
- `LEGAL_ESTIMATE_CAVEAT` (policy): the caveat form, attached to the existing capability claim.

### 1. Meal review card (`meal-editor-form.tsx`)
- The allergen block and the caption go inside **one wrapper `View`** with `gap: Spacing.one`, so
  they read as a unit and the body's `gap: Spacing.three` separates them from the Dish-name input
  (otherwise the caption floats between the `Confidence:` line and an `Input` that renders its own
  muted hint).
- Rendered **unconditionally**, including on the History edit screen. With the wording above that is
  true there too, so no extra prop is needed. **Conditioning it on profile state is rejected on
  privacy grounds, not just cost:** it would introduce a health-data read into the render path that
  doesn't exist today.
- `type="smallBold"` + `themeColor="textSecondary"` — more salience than a hint, still clearly
  quieter than the red `danger` warning above it. Contrast is already verified: light 5.94:1, dark
  10.1:1, both above WCAG AA.
- **Accessibility:** the caption is a *sibling* of the alert `View`, so it is read after the warnings
  in document order whether or not the group label is honoured. No `accessibilityRole`, no live
  region (it would re-announce on every keystroke). The wrapper must not set `accessible={true}`.
  (The alert `View` sets `accessibilityRole="alert"` + a label without `accessible`, so iOS may
  ignore the group label — that is a 0032 bug, explicitly **out of scope** here.)

### 2. Where health is declared (`health-question.tsx` + its two call sites)
- Add an optional **`description?: string`** prop — *not* `hint`, which already means the `Input`
  character counter inside this same component and is hard-clamped to one line
  (`input.tsx:59-65`), so a two-line disclaimer would be truncated; it also only appears after the
  user taps "Yes", i.e. too late to inform the choice.
- Renders as `<Text type="small" themeColor="textSecondary">` immediately **after the label and
  before the No/Yes buttons**, so a screen reader reads it before the options. The label stays
  `smallBold` so the hierarchy is legible. It shows even while `disabled` (static copy).
- Allergies question → `ALLERGY_FIELD_HINT`; conditions question → `CONDITION_FIELD_HINT`, in both
  `settings-screen.tsx` and `onboarding-wizard.tsx`.

### 3. Legal copy (`privacy-content.ts`)
- §2's existing claim gains its caveat **in place** ("…can flag likely allergen conflicts. These
  alerts are AI estimates, can miss ingredients, and are not medical advice."), rather than a
  verbatim paste of the UI string into a data-flow paragraph.
- Plus **one new paragraph entry** covering the whole product, because disclaiming only allergens
  implies the rest is advice: *"Calorie, macro and allergen estimates in the app are AI-generated and
  are not medical or nutritional advice."* `body` renders one `<Text>` per array entry, so a new
  entry is a new paragraph.
- **`EFFECTIVE_DATE` is not bumped** (Open question 3 resolved). Git precedent: bumped only for the
  0031 health-data *category* change, not for the 0012 or 0020 copy changes. A convention comment is
  added next to the constant: bump only on a material change in data practice or collected
  categories — and re-verify the OpenAI training statement when bumping, since the same date anchors
  that third-party claim (`privacy-content.ts:57`).
- Soften the adjacent capability wording ("can attempt to flag") so the policy and the caveat agree.

## Files to change
- `src/constants/legal.ts` — **new.** The four constants + why they're shared.
- `src/features/capture/screens/meal-editor-form.tsx` — wrapper `View` + caption.
- `src/features/auth/components/health-question.tsx` — optional `description` prop.
- `src/features/auth/screens/settings-screen.tsx`, `src/features/auth/screens/onboarding-wizard.tsx`
  — pass the two hints.
- `src/features/legal/privacy-content.ts` — caveat in §2, the new general paragraph, the
  `EFFECTIVE_DATE` convention comment.
- `docs/sessions/HANDOFF.md` — add the ToS (and the deferred App Store items) to tracked obligations.
- `docs/plans/0044-…`, `docs/JOURNAL.md` — record.

No migration, no Edge Function, no new dependency. JS-only → a reload is enough.

## Data model / schema impact
None. Static copy; nothing stored, nothing new sent to OpenAI. **Nothing to disclaim at rest:**
`allergenWarnings` is review-time only — not in `toSavePayload`, not seeded by
`seedFormFromMealLog`, no DB column (0032) — so no stored copy of a warning needs the disclaimer to
travel with it.

## Edge cases & failure modes
- **No declared allergies:** the caption is still true ("we only check allergies you've entered"),
  which turns it from noise into information. This is the case the first draft got wrong.
- **History edit** (no check ever ran): same wording holds, because it scopes the claim to "when a
  meal is analyzed".
- **"Allergy check unavailable" (0043):** that red line is the load-bearing message; the caption's
  "only when a meal is analyzed" does not contradict it. Verified on device, not just reasoned.
- **Conditions-only user** (e.g. "celiac" in the conditions box): gets no allergen check at all —
  now stated at the point of entry by `CONDITION_FIELD_HINT`.
- **The caption competing with the warning:** it sits below the red block, muted, inside the same
  wrapper.
- **Dynamic type (AX5 ≈ 310%):** nothing in the repo sets `allowFontScaling`/
  `maxFontSizeMultiplier`, and the onboarding body is `flex: 1` inside a `flex: 1` clamp, so a
  shrinking body can push content under the footer. **Pre-approved deviation:** if the footer
  overlaps at AX5, remove `flex: 1` from `onboarding-wizard.tsx` `styles.body` in this plan rather
  than stopping.
- **Rollback:** revert the commit; no server state involved.

## Test / verify plan
The repo has no test framework — `tsc`, `lint` and the device pass are the whole gate. Say so
plainly rather than implying coverage.
1. `npx tsc --noEmit` and `npx expo lint` clean.
2. Device pass with `qa@calorie.dev`:
   - onboarding: allergy hint and conditions hint both visible, correct question each;
   - Profile: same;
   - a meal with **no** warning → caption visible and reads truthfully;
   - a meal **with** a warning (declared peanuts + a peanut dish) → red warning above, caption below,
     grouped, warning still dominant;
   - **an account with allergies set to "No"** → caption still reads correctly;
   - History edit of a saved meal → caption present, nothing looks broken;
   - Privacy screen → the caveat and the new paragraph each appear once and read naturally.
3. **Dark mode** pass over all three surfaces.
4. **Dynamic type at AX5** on the onboarding health step, the Profile health section and the review
   card; plus an iPhone SE-class width for layout.
5. **VoiceOver** on the review card: the warning is announced before the caption.
6. The `ALLERGY_CHECK_UNAVAILABLE` path: reasoned + verified if it can be triggered; if not, record
   it as "verified by reading, not on device".

## Rollout
1. Implement → 2. tsc/lint → 3. device + dark mode + AX5 + VoiceOver pass → 4. JOURNAL + HANDOFF +
plan → 5. commit and push.

No deploy, no migration, no rebuild (JS-only).

## Open questions — RESOLVED in review
1. **Wording** — rewritten per blockers B1/B2 (see above); English only, consistent with the app.
   Localization of safety copy is a named deferred gap.
2. **Caption always or only with a warning?** → **Always**, on both the review and History-edit
   screens, which the new wording makes true everywhere.
3. **Bump `EFFECTIVE_DATE`?** → **No**, plus a written convention comment so the rule stops being
   re-derived.

---

## Review
Four-agent review (2026-09-29): correctness, architecture, edge cases, privacy/legal. Consolidated
and deduped; every resolution is folded into the body above.
**Verdict: NEEDS CHANGES (2 blockers) → both resolved in body → APPROVED.**

### BLOCKER (resolved)
- **B1: conditions-only users are the biggest false-reassurance path, and the plan left them out**
  *(correctness)*. 0043 checks `allergiesDeclared` only, so a user who types "celiac" into the
  **conditions** box gets no allergen check and no red box, ever — the exact risk this plan names.
  The draft deliberately gave the conditions question no hint, and the behaviour is documented
  nowhere but a code comment. → **Resolved:** a `CONDITION_FIELD_HINT` on the conditions question in
  both call sites, pointing the user at the allergy field.
- **B2: the draft wording implies a check happened when none did** *(privacy, edge; correctness on
  the History path)*. A missing box means three different things — checked-and-clean, no allergies
  declared (policy deletes warnings unconditionally), or a History edit where no check ever runs.
  "Allergen alerts are AI estimates" only covers the first and actively reassures in the other two.
  → **Resolved:** the caption now states *what* is checked and *when* ("we only check allergies
  you've entered in your profile, and only when a meal is analyzed"), which is true on every screen
  and for every user, and also reads correctly under 0043's "Allergy check unavailable" line.

### SHOULD-FIX (resolved)
- **Wrong home for the constants** *(architecture, correctness)* — `privacy-content.ts:15-16` already
  names `src/constants/legal.ts`, and pointing `capture`/`auth` at the `legal` feature inverts the
  import direction. → Constants live in `src/constants/legal.ts`.
- **`hint` is a name already used in that component** *(architecture, correctness)* — it means the
  `Input` character counter, is clamped to one line, and only appears after "Yes". → The prop is
  `description`, rendered as its own `Text` between the label and the buttons; the rejection of
  `Input.hint` is recorded so it isn't re-raised.
- **"Append to the existing paragraph" is the worse rendering** *(architecture, correctness)* —
  `body` is one paragraph per entry, and §2's first sentence is already ~60 words. → The existing
  claim gets its caveat in place; the general statement is a new entry.
- **Disclaiming only allergens implies the rest is advice** *(privacy)* — the app also computes TDEE,
  targets and a quality score with no caveat anywhere. → One general "not medical or nutritional
  advice" paragraph.
- **"ToS tracked separately" was false** *(privacy)* — it appears only as a 0010 non-goal. → This
  plan adds the tracking line to HANDOFF, plus the deferred App Store / privacy-label items.
- **Caption placement floats** *(edge)* — between the muted `Confidence:` line and an `Input` with its
  own muted hint, it would read as that input's hint. → Wrapper `View`, `gap: Spacing.one`.
- **The accessibility claim was overstated** *(correctness, edge)* — the alert `View` sets a label
  without `accessible`, so iOS may ignore the group label. → Reworded to the sibling/document-order
  argument; a VoiceOver device step replaces the assertion; fixing 0032's missing flag is out of
  scope.
- **Dynamic type untested; onboarding `flex: 1` is the risky spot** *(edge)* → an AX5 pass, with the
  `flex: 1` removal pre-approved as an allowed deviation.
- **`EFFECTIVE_DATE` needs a written rule** *(privacy)* — the same constant also anchors the "As of
  <date>, OpenAI states…" third-party claim, so a silent bump re-asserts something nobody re-checked.
  → Don't bump; add the convention comment.
- **Test-plan gaps** *(edge, correctness)* — no dark-mode sweep, no dynamic type, no small device, no
  no-allergies account, no unavailable-path check, and the repo has no test framework at all. → All
  added, and the gate is stated plainly.

### NIT (addressed)
- "Check ingredients **or ask**" — restaurant and home-cooked food has no label to read *(privacy)*.
- `type="smallBold"` for the review-card caption; contrast measured (light 5.94:1, dark 10.1:1), so
  the open contrast question is closed *(edge)*.
- Soften §2's "can flag" to "can attempt to flag" so the policy and the caveat agree *(correctness)*.
- Keeping the caption unconditional is the **privacy-positive** choice: conditioning on profile state
  would add a health-data read to the render path *(privacy)*.
- Nothing to disclaim at rest — warnings are never persisted *(privacy)*; recorded in Data model.
- Two constants for the two field hints are intentionally different sentences, not drift *(architecture)*.
- If the policy ever needs a different voice, the UI constant stays the source and the policy
  re-words *(architecture)*.
- English-only confirmed (no i18n, no RTL config anywhere) *(edge)*.

## Execution log

**2026-09-29 — executed as planned, no deviations.**

Files, in the order they were written:
- **`src/constants/legal.ts` (new)** — four constants: `ANALYSIS_DISCLAIMER`, `ALLERGY_FIELD_HINT`,
  `CONDITION_FIELD_HINT`, `LEGAL_ESTIMATE_CAVEAT`. The file header records *why* the wording states
  what/when rather than "alerts can miss things" (blocker B2), so a future edit doesn't quietly undo it.
- **`src/features/capture/screens/meal-editor-form.tsx`** — the allergen alert and the new
  unconditional `ANALYSIS_DISCLAIMER` caption now sit in one `styles.allergenBlock` wrapper
  (`gap: Spacing.one`), so the caption can't read as the next `Input`'s hint. The caption is a
  *sibling* of the `accessibilityRole="alert"` node, not a child, so VoiceOver reads the warning
  first and the caption straight after it in document order. No `accessible={true}` was added to the
  wrapper — that would collapse the two into one utterance.
- **`src/features/auth/components/health-question.tsx`** — new optional `description?: string`,
  rendered between the label and the No/Yes buttons. Deliberately *not* reusing `Input`'s `hint`
  (one line, and only visible after "Yes").
- **`settings-screen.tsx` / `onboarding-wizard.tsx`** — both pass `ALLERGY_FIELD_HINT` and
  `CONDITION_FIELD_HINT`. The conditions hint is the B1 fix: conditions never feed the allergen check.
- **`src/features/legal/privacy-content.ts`** — `LEGAL_ESTIMATE_CAVEAT` added as a new §2 entry,
  "can flag" softened to "can attempt to flag", and the `EFFECTIVE_DATE` convention written down
  (bump only on a material data-practice change; re-verify the OpenAI-training claim when bumping).
- **`docs/sessions/HANDOFF.md`** — the legal / store gaps block (no ToS, App Review 1.4.1 + the
  Health & Fitness privacy label, localization of safety copy).

**Deviation allowance not needed.** The pre-approved `flex: 1` removal in `onboarding-wizard.tsx`
`styles.body` was held in reserve for an AX5 footer overlap; the device pass showed none, so the
style is untouched.

**Verified.** `npx tsc --noEmit` 0; `npx expo lint` clean. Device pass (JS reload, no rebuild) by the
user, all green: both hints in Onboarding and Profile; a meal with no warning; a meal with a warning
(the red box still clearly dominates the muted caption); a History edit; the Privacy screen; dark
mode. JS-only change — no schema, no Edge Function, nothing to roll back but the commit.
