# Plan: Privacy policy — disclose OpenAI processing + Supabase storage of health data

- **Status**: **Done** (2026-06-23) — executed per plan, `tsc` + `expo lint` clean, web-verified
  (signed-out + cold deep-link + signed-in + sign-out-while-open reachability; capture notice across
  states; outbound links; themed header). Legal specifics confirmed by the user.
  Was: **Approved** (2026-06-23) — multi-agent review: **2 blockers resolved in-plan**
  (collection list corrected to the real schema incl. body metrics; deletion wording made honest — no
  self-serve delete, photos persist). All should-fixes folded (proven route reachability + sign-out
  edge, dropped the `legal/` feature dir, capture notice covers upload, attributed OpenAI claim,
  generic region, no-tab-bar Screen). Notice-over-consent affirmed for v1. Ready to execute.
- **Created**: 2026-06-23
- **Plan #**: 0010

## Problem / Goal
The app sends **meal photos + derived nutrition data to OpenAI** (GPT-4o-mini vision, via the
`analyze-meal` Edge Function) and stores meals, photos, and body metrics in Supabase — yet there is
**no privacy policy anywhere** (no screen, no doc, no link; README line 70 names it as a known gap, and
plans 0007/0008 list it as a tracked obligation). Sending a user's food photos (sensitive,
health-adjacent data) to a third party with **zero disclosure** is the single highest-risk
privacy/compliance gap in the product and a hard blocker for App Store / Play submission.

**Goal:** ship a truthful, readable **in-app privacy policy** and surface it where it matters — at
**sign-up** (notice before account creation), in **Settings** (always reachable), and as a short
**point-of-processing notice on the Capture screen** (right where a photo is about to be sent to
OpenAI). No backend or schema change.

**Done looks like:**
- A `/privacy` route renders a scrollable, themed policy that accurately states: what data we collect
  (email, meal photos, AI-derived nutrition, profile/body metrics & goals), that **photos + analysis
  are sent to OpenAI for processing** (with a link to OpenAI's policy + the API no-training note),
  that data is **stored in Supabase** (private photo bucket + Postgres, owner-only via RLS), retention
  ("kept until you delete your meals/account") stated **honestly** (full automated photo deletion is
  still tracked in 0007 SF9 — we don't over-promise), and a contact address.
- `/privacy` is reachable **both signed-out** (from sign-up) **and signed-in** (from Settings), with a
  working back affordance, on web and native.
- Sign-up shows a one-line "By creating an account you agree to our Privacy Policy" with a tappable
  link; Capture shows a one-line "Your photo is sent to OpenAI to analyze it · Privacy" notice before
  the Analyze action.
- `npx tsc --noEmit` + `npx expo lint` clean; web-verified navigation from all three entry points.

## Non-goals
- **No Terms of Service / EULA** — privacy policy only (ToS is a separate later task).
- **No hosted public URL** in v1 — we have no production web domain yet (same blocker as the CORS
  prod-origin TODO). The in-app screen is the source of truth; a public URL mirror is deferred to store
  submission (Open question Q1). App-store metadata URL is out of scope here.
- **No blocking, persisted consent gate** (a checkbox that writes `privacy_accepted_at` and refuses to
  analyze until accepted). v1 is **prominent notice + agreement-on-signup**, not a hard gate — see
  Open question Q2. (Chosen to keep this a zero-schema change; the reviewers can escalate.)
- **No actual change to data handling** — no new deletion job, no retention automation, no OpenAI
  setting change. This task *describes* current behavior truthfully; fixing photo-deletion automation
  stays 0007 SF9.
- **No markdown-rendering dependency** — the policy is authored as themed `Text` blocks (no new lib).
- **No i18n** — English copy (consistent with the rest of the app's UI strings).

## Proposed approach
**The smallest change that fully solves it: one shared, always-reachable route + three thin entry
points, content authored as components.**

### 1. The policy content + screen (new `legal` feature)
- `src/features/legal/privacy-content.ts` — the policy as **structured data**: an ordered list of
  `{ heading, body }` sections + constants for `EFFECTIVE_DATE`, `CONTACT_EMAIL`, `COMPANY_NAME`, and
  the two outbound URLs (OpenAI privacy policy, Supabase privacy policy). Keeping copy as data (not
  JSX) makes it diff-reviewable and lets the screen stay dumb. Sections cover, in plain language:
  1. **What we collect (resolves B1 — matches the real schema)** — account email; profile (display
     name, units, timezone); the body details you enter for goals (age, sex, height, weight, activity
     level, weight goal) and the calorie/macro targets computed from them (`profiles` + `goals`,
     incl. `20260619192848_goals_body_inputs.sql`); the meal photos you capture; and the AI-estimated
     nutrition + food items you save (`meal_logs`/`meal_items`).
  2. **How your meal photos are analyzed** — the photo + a prompt are sent to **OpenAI** (GPT-4o-mini
     vision) **through our server**, never from your phone directly; OpenAI returns the estimate.
     **Attributed + date-anchored (SF):** "As of {EFFECTIVE_DATE}, OpenAI states it does not use data
     submitted via its API to train its models — see OpenAI's privacy policy" (link). Don't self-
     guarantee a third party's behavior.
  3. **Where your data is stored** — **Supabase, our cloud provider** (no region claim unless confirmed
     — Q4); photos live in a **private bucket** only you can access; database rows are **owner-only
     (RLS)**; we don't log your photos or analysis content; link to Supabase's policy.
  4. **Retention & deletion (resolves B2 — honest, no over-promise)** — "We keep your meals, photos,
     and profile data until you ask us to delete them. **To delete your data or your account, email us
     at {CONTACT_EMAIL}** and we'll remove it." Do **not** imply a self-serve delete button (none
     exists), and do **not** claim deleting a meal removes its photo file (Postgres row delete ≠
     Storage delete; orphan cleanup is 0007 SF9, unshipped).
  5. **What we don't do** — "We don't sell your data, and we share it **only** with the providers
     needed to run the app — **OpenAI** (analysis) and **Supabase** (storage)." (Not an unqualified
     "we don't share" — photos ARE shared with OpenAI as a processor.)
  6. **Contact** — `CONTACT_EMAIL` for privacy questions / deletion requests (load-bearing per B2).
- `src/features/legal/privacy-policy-screen.tsx` — **flattened, no `screens/`/`lib/` subdirs (resolves
  the Arch SF — a full feature dir is overkill for one static screen).** `PrivacyPolicyScreen`: a
  `<Screen scroll>` (**NOT `tabBarInset`** — this is a root Stack screen with no tab bar; SF) rendering
  the title, "Last updated: {EFFECTIVE_DATE}", each section (`subtitle` heading + `default` body
  `Text` via `themeColor`), and the two outbound links via the existing **`ExternalLink`** component
  (`src/components/external-link.tsx`, already handles web `target=_blank` + native in-app browser).
  Pure presentational; no state, no I/O.

### 2. One always-reachable route (works signed-in AND signed-out)
- `src/app/privacy.tsx` — route wrapper rendering `<PrivacyPolicyScreen />`.
- `src/app/_layout.tsx` — add `<Stack.Screen name="privacy" options={{ headerShown: true, title:
  'Privacy Policy' }} />` **as a sibling of the `Stack.Protected` groups, OUTSIDE every guard**. The
  root Stack currently renders exactly one guarded group `(auth)`/`(onboarding)`/`(app)`; an unguarded
  sibling screen is pushable from any state, so `/privacy` works **before** login (from sign-up) and
  **after** (from Settings). `headerShown: true` (overriding the root `headerShown: false`) gives a
  native back chevron — the back affordance with no extra UI code.

### 3. Three thin entry points
- **Settings** (`settings-screen.tsx`) — a new "Legal" `Card` section (mirrors the existing section
  pattern) with a `Text type="linkPrimary"` row → `router.push('/privacy')`. (`useRouter` is already
  imported in sibling screens; add to this one.)
- **Sign-up** (`sign-up-screen.tsx`) — under the Create-account button, a small `Text` line: "By
  creating an account you agree to our " + a `linkPrimary` "Privacy Policy" → `router.push('/privacy')`.
  Uses the router already in the file.
- **Capture** (`capture-screen.tsx`) — a one-line `Text type="small" themeColor="textSecondary"` notice
  **(reworded + repositioned, SF):** *"Your photo is uploaded and sent to OpenAI to estimate
  nutrition."* + a `linkPrimary` "Privacy" link → `router.push('/privacy')`. Rendered in the **preview
  card while a photo is selected and not yet saved** — i.e. it shows in both the pre-Upload and
  uploaded-not-analyzed states (the photo leaves the device at **Upload** → Supabase Storage, and
  again at **Analyze** → OpenAI, so the disclosure must precede Upload), and is **hidden once the
  `MealReview` card shows** and in the no-photo / denial states. This is the **point-of-processing**
  disclosure, shown before the data leaves the device.

### 4. Docs
- Update `README.md` line ~70 (the "we need a privacy policy" gap) to reflect that an in-app policy now
  exists (public-URL mirror still pending). No other doc churn.

## Files to change
- `src/features/legal/privacy-content.ts` — **NEW** (flattened, no `lib/`): policy sections as data +
  `EFFECTIVE_DATE`, `CONTACT_EMAIL`, `COMPANY_NAME`, `OPENAI_PRIVACY_URL`, `SUPABASE_PRIVACY_URL`
  (constants grouped separately from the section prose for a trivial future `constants/legal.ts`
  extraction).
- `src/features/legal/privacy-policy-screen.tsx` — **NEW** (flattened, no `screens/`):
  `PrivacyPolicyScreen`, `<Screen scroll>` **without `tabBarInset`**, themed, outbound links via
  `ExternalLink`.
- `src/app/privacy.tsx` — **NEW**: route wrapper delegating to `PrivacyPolicyScreen` (mirrors
  `capture.tsx`/`profile.tsx`).
- `src/app/_layout.tsx` — **EDIT**: register `<Stack.Screen name="privacy" options={{ headerShown:
  true, title: 'Privacy Policy' }} />` as a literal sibling of the three `Stack.Protected` groups,
  **outside every guard** and after `RootNavigator`'s early returns (the back chevron + the brand
  `navTheme` header come for free; verify dark-mode header).
- `src/features/auth/screens/settings-screen.tsx` — **EDIT**: add a "Legal" section linking to
  `/privacy` (add `useRouter`).
- `src/features/auth/screens/sign-up-screen.tsx` — **EDIT**: add the agreement line + link.
- `src/features/capture/screens/capture-screen.tsx` — **EDIT**: add the point-of-processing notice +
  link near Analyze.
- `README.md` — **EDIT**: update the privacy-policy gap line.

## Data model / schema impact
**None.** No tables, columns, migrations, RLS, or storage changes. v1 is notice + in-app content only.
(A persisted consent gate — Open question Q2 — *would* add a `profiles.privacy_accepted_at timestamptz`
column + migration; explicitly out of scope unless review escalates it.)

## Edge cases & failure modes
- **Unauthenticated access to `/privacy`** (from sign-up, before any session) — must render. Handled by
  registering the route **outside** the `Stack.Protected` guards; verify the auth gate doesn't bounce
  it back to `sign-in`.
- **Back navigation** — `headerShown: true` provides the chevron; on web also confirm browser back +
  the header back both return to the prior screen (sign-up or Settings) without dumping to `/`.
- **Web vs native rendering** — `ExternalLink` already branches (web `target=_blank`, native in-app
  browser); native verification is deferred to a device session (consistent with the camera follow-up),
  noted in the verify plan.
- **Long content / small screens** — `<Screen scroll>` must scroll the whole policy; check the last
  section + contact are reachable, with tab-bar inset not clipping it.
- **Outbound link failure / offline** — tapping OpenAI/Supabase links offline just fails to open; no
  app state depends on it (purely informational). No crash path.
- **Copy accuracy (the real risk)** — the policy must not over-promise: do **not** claim automatic photo
  deletion (0007 SF9 unshipped) or a data region we haven't confirmed. Hedge deletion as "email us to
  request deletion" + "deleting a meal removes its record." Reviewer (data/privacy lens) should fact-
  check every sentence against actual behavior.
- **Placeholder legal fields** — `COMPANY_NAME`/`CONTACT_EMAIL`/`EFFECTIVE_DATE` need real values
  (Open question Q3); shipping a placeholder like "TODO Inc." would be worse than a holding value —
  use the known `heartharmona.com` contact until confirmed, flagged below.
- **Theme/dark mode** — all text via `Text`/`themeColor`; no hardcoded colors.

## Test / verify plan
- **Typecheck/lint:** `npx tsc --noEmit` clean; `npx expo lint` clean.
- **Manual on web (Done gate):**
  1. **Signed-out reachability (resolves Edge B1):** on Sign-up, tap "Privacy Policy" → `/privacy`
     renders fully with no session, scrolls to the contact section; the header chevron AND the browser
     back button both return to Sign-up (not to `/`). If the chevron pops to the root anchor instead,
     add an explicit `headerLeft`/`router.back()`.
  2. **Cold web deep-link (resolves Edge S2):** paste `/privacy` into a fresh tab with no session → it
     must **render the policy, not redirect to `sign-in`**.
  3. **Signed-in path:** Profile/Settings → "Privacy Policy" row → `/privacy` renders, back returns to
     Settings.
  4. **Sign-out while open (resolves Edge B2):** open `/privacy` signed-in, then sign out (or simulate
     token expiry) → the app lands cleanly on `sign-in`, no blank/dead back-stack.
  5. **Capture notice across ALL sub-states (resolves SF):** the "uploaded and sent to OpenAI" notice
     shows in the **preview (pre-Upload)** and **uploaded-not-analyzed** states; is **hidden** in
     no-photo, the `MealReview` card, and the permission-denied card; tapping "Privacy" opens the policy.
  6. **Outbound links:** the OpenAI + Supabase links open in a new tab (web).
  7. **Dark mode:** the new Privacy header uses the brand `navTheme` (not an unthemed white bar).
- **Native:** deferred to a device session (like the camera path) — note, don't block on it.
- **Content review (resolves B1/B2):** every factual claim cross-checked against the code — OpenAI
  model + server-side call, private bucket + owner-only RLS, the **full** collection list (incl.
  `goals` body inputs), and the **honest deletion wording** (no self-serve delete; photo files persist).

## Rollout
1. `/review-plan docs/plans/0010-privacy-policy.md`; resolve blockers (esp. copy accuracy + the
   consent-gate decision) before coding.
2. Confirm the legal placeholders (Q3) — `COMPANY_NAME`, `CONTACT_EMAIL`, `EFFECTIVE_DATE`.
3. Build content → screen → route + layout registration → the three entry-point links → README line.
4. `npx tsc --noEmit` + `npx expo lint`.
5. Web-verify the three entry points + outbound links (above).
6. Append `docs/JOURNAL.md`; mark this plan Done; **commit straight to `main`** and push.
   Then the remaining tracked obligations are unblocked-or-deferred: CORS prod origin + public-URL
   mirror move together when a prod domain exists; 0007 SF9 photo cleanup; custom SMTP.

## Open questions
1. **Public hosted URL? — DEFERRED (affirmed).** App stores want a publicly reachable URL; we have no
   prod web domain yet (same blocker as CORS prod origin). Ship in-app now; mirror the same content at a
   public URL when the prod domain lands (one combined task with CORS).
2. **Notice vs persisted consent gate — RESOLVED: notice for v1 (affirmed by the data/privacy lens).**
   No hard gate, no schema change. The one-time consent modal persisted as `profiles.privacy_accepted_at`
   stays the named escalation if a store reviewer requires it.
3. **Legal specifics — NEEDS USER CONFIRMATION before execution.** Real `COMPANY_NAME`, the privacy
   `CONTACT_EMAIL` (this is now load-bearing — it's the only deletion-request channel, per B2), and the
   `EFFECTIVE_DATE`. Proposed holding values: `COMPANY_NAME` = "Heart Harmona", `CONTACT_EMAIL` =
   `saba@heartharmona.com`, `EFFECTIVE_DATE` = 2026-06-23. Confirm or correct before ship.
4. **Supabase data region — RESOLVED: keep generic** ("our cloud provider, Supabase"), no region/country
   claim unless confirmed.

---

## Review
_Multi-agent review (4 lenses: correctness, architecture, edge cases, data/privacy),
2026-06-23. Consolidated & deduped._

**Verdict: NEEDS CHANGES → 2 blockers — both resolved in-plan** (folded into the approach/sections
above; see each `(resolves Bn)` marker). Both are copy/accuracy fixes, not design changes. The
notice-over-consent decision (Q2) was **affirmed** by the data/privacy lens for v1. One reviewer claim
was **investigated and corrected**: the data lens asserted "no body-metric columns exist" — **false**,
migration `20260619192848_goals_body_inputs.sql` adds `age/sex/height_cm/weight_kg` to `goals`, so the
fix is to **expand** the collection list (B1), not drop body metrics.

### BLOCKER
- **B1 — "What we collect" list is inaccurate/incomplete vs the real schema.** (Data.) The schema
  stores more than the plan listed: `profiles` → `display_name`, `units`, `timezone`; `goals` →
  `age`, `sex`, `height_cm`, `weight_kg` (via `20260619192848_goals_body_inputs.sql`), plus
  `activity_level`, `weight_goal`, and computed calorie/macro targets; `meal_logs`/`meal_items` →
  dish, items, nutrients, `image_path`. A privacy policy must enumerate categories truthfully.
  **Resolution (§Approach section 1):** the collect list now reads: *account email; profile (display
  name, units, timezone); the body details you enter for goals (age, sex, height, weight, activity
  level, weight goal) and the calorie/macro targets computed from them; the meal photos you capture;
  and the AI-estimated nutrition + food items you save.*
- **B2 — Deletion is over-promised; no delete path exists and photos survive row deletion.** (Data +
  Edge.) There is **no in-app "delete meal", no "delete account", and no Storage-orphan cleanup** (0007
  SF9 open). Deleting a `meal_logs` row cascades to `meal_items` but **does NOT remove the Storage
  photo file** (Postgres delete ≠ Storage delete). Stating "kept until you delete your meals/account"
  implies a capability the app doesn't expose. **Resolution (§Approach section 4):** state honestly —
  *"We keep your meals, photos, and profile data until you ask us to delete them. To delete your data
  or your account, email us at {CONTACT_EMAIL} and we'll remove it."* Do **not** imply a self-serve
  delete button, and do **not** claim deleting a meal removes its photo file. (`{CONTACT_EMAIL}` is now
  load-bearing — Q3 must resolve before ship.)

### SHOULD-FIX (all folded in)
- **Reachability of the unguarded `/privacy` route must be proven, not assumed (Edge B1→SF).** The
  correctness lens confirmed against the expo-router v56 Protected-routes docs that an **unguarded
  sibling `<Stack.Screen>`** is reachable in every state; the edge lens wants it exercised. **Fix:**
  the route is registered as a literal sibling of the three `Stack.Protected` groups, **outside** every
  guard and **after** `RootNavigator`'s early returns; and the verify plan now **mandates** confirming
  `router.push('/privacy')` works (a) signed-out from sign-up, (b) signed-in from Settings, and
  (c) survives a sign-out that flips the guards while `/privacy` is on top (§Test plan).
- **Sign-out / session-expiry while `/privacy` is open (Edge B2).** When the session flips, the gate
  tears down the underlying group; back-nav could dead-end. **Fix:** added an edge case + verify step —
  after sign-out the app must land cleanly on `sign-in` (not a blank back-stack).
- **Drop the `src/features/legal/` feature dir — overkill for one static screen (Arch).** No `lib/`
  logic exists; a full feature dir is ceremony the repo doesn't pay elsewhere. **Fix:** flatten to
  `src/features/legal/privacy-policy-screen.tsx` + `src/features/legal/privacy-content.ts` (no
  `lib/`/`screens/` subdirs), with `src/app/privacy.tsx` delegating (preserves the "routes delegate to
  feature screens" convention seen in `capture.tsx`/`profile.tsx`). Content-as-data is kept (the arch
  lens affirmed it). **Note:** do NOT put a non-route `.ts` inside `src/app/` (expo-router scans that dir).
- **Capture notice must cover the photo *leaving the device*, which happens at UPLOAD, not just
  Analyze (Data + Correctness + Edge).** The photo goes to Supabase Storage at Upload and to OpenAI at
  Analyze. **Fix:** reword to *"Your photo is uploaded and sent to OpenAI to estimate nutrition."* and
  render it in the **preview card while a photo is selected and not yet saved** (covers both the
  pre-Upload and uploaded-not-analyzed states), hidden once the `MealReview` card shows. The verify
  plan checks visibility across all capture sub-states (no-photo, preview/upload-pending, uploaded-
  not-analyzed, MealReview, denial).
- **`/privacy` is a root Stack screen with NO tab bar — use `<Screen scroll>` WITHOUT `tabBarInset`
  (Edge S4).** Copy-pasting capture's `<Screen scroll tabBarInset>` would add phantom bottom padding.
  Fix noted in §Approach section 1 + §Files.
- **OpenAI "no training on API data" must be attributed + date-anchored, not self-guaranteed (Data).**
  **Fix:** *"As of {EFFECTIVE_DATE}, OpenAI states it does not use data submitted via its API to train
  its models — see OpenAI's privacy policy."* (link). Shifts the representation to OpenAI.
- **Don't claim "we don't share with third parties" unqualified (Data).** Photos ARE shared with OpenAI
  (a processor). **Fix:** *"We don't sell your data, and we share it only with the providers needed to
  run the app — OpenAI (analysis) and Supabase (storage)."*
- **Keep the data region generic (Data, Q4).** Don't name a Supabase region/country unless confirmed —
  *"stored with our cloud provider, Supabase."* Locked.
- **Cross-group back affordance + web browser-back (Correctness + Edge N2).** **Fix:** verify the header
  chevron AND the web browser back both return to the prior screen (sign-up / Settings), not to `/`; if
  the default chevron pops to the root anchor instead, add an explicit `headerLeft`/`router.back()`.

### NIT (folded or noted)
- Use `themeColor="textSecondary"` (not a bare `textSecondary` prop) and `Text type="small"`; internal
  links use `Text type="linkPrimary" onPress={() => router.push('/privacy')}` (already the pattern in
  `sign-up-screen.tsx:136`); outbound links use `ExternalLink` with visible children text.
- Confirm the new header uses the brand `navTheme` (it's inside the root `ThemeProvider`) so it isn't an
  unthemed white bar in dark mode — add to the verify checklist.
- Native verification (in-app browser for outbound links; `openBrowserAsync` offline reject) is deferred
  to a device session, consistent with the camera follow-up — noted, not blocking.
- `COMPANY_NAME` must be a confirmed legal entity (Q3) — an unconfirmed name is itself a misstatement.

### Affirmations (no change)
- **Notice over a persisted consent gate is the right v1 posture** (data/privacy lens): food photos are
  health-*adjacent*, not GDPR Art. 9 special-category per se; prominent notice + signup agreement +
  pre-action point-of-processing notice is defensible under GDPR/CCPA and meets Apple/Google disclosure
  expectations — provided the disclosure is truthful and pre-action (both now enforced). The
  `privacy_accepted_at` gate stays the named escalation (Q2).
- Verified accurate against code: OpenAI **GPT-4o-mini** vision, called **server-side** (key is an Edge
  secret, phone never calls OpenAI directly); **private** `meal-photos` bucket + **owner-only RLS**;
  no PII/secret logging in the Edge Function. Stating these is correct.
- Registering an unguarded root route + per-screen `headerShown: true` for the back chevron is the
  idiomatic reachable-everywhere approach (correctness + arch lenses).

<!-- Original placeholder retained for history below. -->

## Execution log
**2026-06-23 (session 10) — executed as planned, no deviations.**

- **Legal specifics confirmed by the user:** `COMPANY_NAME` = "Heart Harmona", `CONTACT_EMAIL` =
  `saba@heartharmona.com`, `EFFECTIVE_DATE` = June 23, 2026 (resolves Q3).
- **`src/features/legal/privacy-content.ts`** — policy as data (constants grouped separately from the
  6 section prose blocks); collection list mirrors the real schema incl. `goals` body inputs (B1);
  honest deletion wording (email-only, no self-serve, photos persist — B2); OpenAI claim attributed +
  date-anchored; generic Supabase region; "share only with OpenAI/Supabase" (not unqualified).
- **`src/features/legal/privacy-policy-screen.tsx`** — flat (no `lib/`/`screens/` subdirs, Arch SF);
  `<Screen scroll>` **without `tabBarInset`**; outbound OpenAI/Supabase links via `ExternalLink`.
- **`src/app/privacy.tsx`** + **`src/app/_layout.tsx`** — route delegates to the screen; registered as
  an **unguarded `<Stack.Screen name="privacy" options={{ headerShown:true, title:'Privacy Policy' }}>`**
  sibling of the three `Stack.Protected` groups → reachable signed-out AND signed-in, themed back chevron.
- **Three entry points:** sign-up agreement line ("By creating an account you agree to our Privacy
  Policy"); Settings "Legal" card row; Capture point-of-processing notice ("Your photo is uploaded and
  sent to OpenAI to estimate nutrition · Privacy") rendered while a photo is selected and `!analysis`
  (covers pre-Upload + uploaded-not-analyzed; hidden once MealReview shows). All via
  `router.push('/privacy')`.
- **`README.md`** — privacy-gap line updated (in-app policy ships; public-URL mirror still pending a
  prod domain).

**Verify result:** `npx tsc --noEmit` ✅ (typed `/privacy` route resolved), `npx expo lint` ✅ (exit 0).
**Web-verified by the user:** signed-out from sign-up, cold `/privacy` deep-link (renders, no sign-in
redirect), signed-in from Settings, sign-out-while-open lands cleanly on sign-in, capture notice shows/
hides across states, outbound links open, header themed. Done.

**Still open (unchanged):** public hosted-URL mirror (Q1, with the CORS prod origin when a prod domain
exists); the `privacy_accepted_at` consent gate stays the named escalation if a store reviewer requires
it (Q2). 0007 SF9 photo-orphan cleanup + a self-serve/account-deletion flow remain separate tracked
obligations (the policy now routes deletion through email until they ship).
