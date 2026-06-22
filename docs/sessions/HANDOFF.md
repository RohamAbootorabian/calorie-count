# Handoff → Next Session

_Last updated: 2026-06-21 (session 7)_

## Where we are
**S1 (Auth & Onboarding) is COMPLETE and shipped** — plans 0001–0006 all Done; the app has
auth, onboarding+TDEE, and Profile/Settings, hand-verified on web. We've now opened **S2
(Capture & AI Analysis)**, the product core, and **plan 0007 — Capture & upload (S2 piece 1)
is drafted, multi-agent-reviewed, and Approved but NOT executed.** Tree clean, `tsc` passes.

## What changed this session
- **Executed + web-verified plan 0006 (Profile & Settings)** → closed S1 (commits `21bbd3f`,
  `8cb02ad`).
- **Sliced S2 into 3 pieces** (1: capture+upload · 2: `analyze-meal` Edge Function + Gemini ·
  3: editable results + save to `meal_logs`/`meal_items`).
- **Drafted + reviewed + Approved plan 0007** (S2 piece 1). 3 blockers resolved in-plan, 10
  should-fixes folded in, all open questions decided. No feature code written.

## Next steps (pick up here)
1. **Execute plan 0007** ([docs/plans/0007-capture-upload.md](../plans/0007-capture-upload.md)) —
   Approved, client-only, **no migration** (bucket + RLS exist from 0001). Build order per its
   Rollout:
   - **First:** `npx expo install expo-image-picker`, then add its config plugin + iOS
     permission strings to [app.json](../../app.json) (see the plan's "The dependency" block).
   - `src/features/capture/lib/pick-photo.ts` — permissioned picker wrappers returning a
     **discriminated union** `{status:'ok'|'cancelled'|'denied'}` (SF5); iOS `limited` == usable.
   - `src/features/capture/lib/upload-meal-photo.ts` — `uploadMealPhoto({ photo })`: uid from
     session (SF2); **reject non-jpeg/png mime client-side** + extension from resolved mime (B1);
     `${uid}/${randomUUID}.<ext>` path; **assert `byteLength>0`** (B2); `upsert:false` +
     `AbortController` timeout (SF7); returns `{ok:true, path:data.path}` (bucket-relative, SF1)
     or `{ok:false, kind}` (B3); never log uri/path/bytes.
   - `src/features/capture/screens/capture-screen.tsx` — pick → preview → upload; local
     `mounted` ref (SF8); transient-only retry (B3); reuse S1 `saveErrorMessage` 401/403 mapping.
   - `src/app/(app)/capture.tsx` thin route; add a **Capture tab** to BOTH
     [app-tabs.tsx](../../src/components/app-tabs.tsx) (native — needs a PNG icon) and
     [app-tabs.web.tsx](../../src/components/app-tabs.web.tsx) (`href="/capture"`).
   - **Placeholder icon:** copy an existing `assets/images/tabIcons/*` set → `capture{,@2x,@3x}.png`.
   - Regenerate typed routes for `/capture` (run the dev server once — the 0006 `/profile` lesson).
   - Verify on **web** (pick → preview → upload → success path; object lands under the user's
     folder in the Supabase Storage browser; cancel = no-op; bad/oversized = friendly error).
     Then commit straight to `main`.
2. **After 0007 → piece 2:** plan the `analyze-meal` Edge Function (Gemini 2.5 Flash). Remember
   the architecture rule: the phone NEVER calls the AI; photo path → Edge Function → `MealAnalysis`.

## Open questions / risks
- **`expo-image-picker` not installed yet** — it's the first execute step (above).
- **Native byte path is unverified (B2):** `fetch().arrayBuffer()` can return 0-byte on some
  Android builds. Web is the Done gate; the 0-byte guard makes it safe; if a device fails,
  switch to `base64:true` + `base64-arraybuffer` `decode()` (named follow-up, plan OQ2).
- **iOS HEIC (B1):** guarded by the client-side jpeg/png reject; full re-encode
  (`expo-image-manipulator`) is deferred native hardening.
- **Storage lifecycle/privacy (plan OQ6, owned not built):** orphan-object cleanup job,
  account/meal-delete must also delete Storage objects (the `auth.users` cascade does NOT),
  and a privacy-policy line for photo storage — health data starts accruing at this piece.
- **Custom SMTP** still needed before signup-confirm/password-reset *emails* test end-to-end
  (infra, not code; Supabase → Auth → Emails → SMTP). Future deep-link plan owes in-app
  confirm/reset completion (`expo-linking`).
- Watch the two lint rules during execution: no ref read in render, no setState synchronously
  in an effect (both bit us in 0006).

## How to resume
Run `/session-start`. Node is via nvm — if `node`/`npm` are missing, `source ~/.zshrc`.
Work from `/Users/roham_abt/Desktop/calorie count` (quote the space). Build **sequentially on
`main`** (commit straight, no PRs). **Converse in Persian.**
