# Handoff → Next Session

_Last updated: 2026-06-22 (session 8)_

## Where we are
**S2 (Capture & AI Analysis) is in progress.** Piece 1 (capture + upload) is **executed &
pushed** but its **web click-through verification is still open** (and the iPhone camera /
native-byte test is deferred). Piece 2 (`analyze-meal` Edge Function) is **planned, multi-agent-
reviewed, and Approved — NOT executed** (plan 0008, 6 blockers resolved in-plan). Tree clean,
`tsc` passes.

## What changed this session
- **Executed + pushed plan 0007** (Capture & upload, S2 piece 1) — `expo-image-picker`, picker
  wrappers, typed upload helper, capture screen, Capture tab in both tab bars. Commit `0521821`.
  Two logged deviations: SF7 AbortController→timeout race (storage-js `upload` has no `signal`);
  filename `Date.now()+rand` (no UUID dep on Hermes).
- **Web-verified 0007 only by smoke test** (bundle compiles); the **manual web click-through is
  pending the user**, and the **real-camera + native byte path is deferred** to a later session
  (saved to memory `capture-deferred-camera-test`; user has an iPhone 16 Pro Max).
- **Drafted + reviewed + Approved plan 0008** (`analyze-meal` Edge Function). 6 blockers resolved
  in-plan, all should-fixes folded, all open questions decided.

## Next steps (pick up here)
1. **(Optional, quick) Close 0007's web verification.** `npx expo start --web`, sign in → Capture
   tab → Choose from library → JPEG/PNG → Upload → confirm the object lands under
   `meal-photos/{uid}/…` in the Supabase Storage browser; cancel = no-op; bad/oversized = friendly
   error. If it passes, mark plan 0007 **PASSED/Done** in a tiny follow-up commit (like 0006 did).
2. **Execute plan 0008** ([docs/plans/0008-analyze-meal-edge-function.md](../plans/0008-analyze-meal-edge-function.md)) —
   Approved. Build order per its Rollout:
   - **First**, land the tooling guards so `tsc`/`expo lint` stay green as Deno files appear:
     `tsconfig.json` → `"exclude": ["supabase"]`; `eslint.config.js` → add `"supabase/**"` to
     `ignores` (B2 — ESLint does NOT read tsconfig.exclude).
   - Write + `supabase db push` the `analyze_usage` daily-cap migration (B6).
   - `supabase/functions/analyze-meal/{meal-analysis,gemini,index}.ts` +
     `supabase/functions/_shared/cors.ts` (Deno 2 `Deno.serve`; CORS pinned to known origins).
     The function **always returns HTTP 200 + `{ok,kind}`** (B1); dual download/Gemini timeouts
     (B4); `finishReason!==STOP` + null-guards (B3); `coerceNum` + re-clamp totals.
   - Confirm the **paid Gemini tier** (B5); `supabase secrets set GEMINI_API_KEY=…` (+ local
     `supabase/.env.local`); add `[functions.analyze-meal] verify_jwt = true` to `config.toml`.
   - `deno check` + `supabase functions serve` (positive + negatives: no-JWT, foreign path,
     malformed body, non-food image, broken key, 429) → `supabase functions deploy analyze-meal
     --project-ref vldpfoczswakghkrkyrm`.
   - Client helper `src/features/capture/lib/analyze-meal.ts` (`withTimeout`, exhaustive `kind`
     switch) + an **Analyze** step on the Capture screen with its **own** state + bounded retry.
   - Verify on web; commit straight to `main`. Next: piece 3 (editable results + save to
     `meal_logs`/`meal_items`).

## Open questions / risks
- **0007 web verify + iPhone test still open** (above) — health-data photos start accruing here;
  0007 SF9 (orphan cleanup, delete-cascade-to-Storage, privacy-policy line) remains owned.
- **Gemini `responseSchema`** is a JSON-Schema subset (no `$ref`) — confirm nested
  `items[].nutrients` is accepted or flatten it (plan 0008 still-open item).
- **Paid Gemini tier is a hard prerequisite** (B5) before sending real photos; the free tier may
  train on them. Pick the daily-cap `N` (B6, ~50) and exact CORS origins at execution.
- **Postgres accepts `NaN`** under `>= 0` checks — coercion must strip NaN (load-bearing for
  piece 3's insert).
- Watch the two lint rules during execution: no ref read in render, no setState synchronously in
  an effect (bit us in 0006).
- **Custom SMTP** still needed before signup-confirm/reset *emails* test end-to-end (infra).

## How to resume
Run `/session-start`. Node is via nvm — if `node`/`npm` are missing, `source ~/.zshrc`. Work from
`/Users/roham_abt/Desktop/calorie count` (quote the space). Build **sequentially on `main`**
(commit straight, no PRs). **Converse in Persian.**
