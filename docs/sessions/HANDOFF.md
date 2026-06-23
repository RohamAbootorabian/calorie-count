<!-- HANDOFF.md is rewritten from this shape at every /session-end. Keep it SHORT:
     it's "where to pick up", not a history (the journal is the history). -->

# Handoff → Next Session

_Last updated: 2026-06-23 (session 9)_

## Where we are
**S2 (Capture & AI Analysis): pieces 1 & 2 are DONE and live; piece 3 is planned & Approved, not
executed.** A signed-in user can take/pick a meal photo → upload it → **Analyze** it through the
deployed `analyze-meal` Edge Function → see a read-only result card. The AI provider is **OpenAI
(GPT-4o-mini vision)** (switched from Gemini this session). Tree is clean, `tsc` + `expo lint` + `deno
check` all pass.

## What changed this session
- **Executed plan 0008** (analyze-meal Edge Function): tooling guards, `analyze_usage` cap migration
  (pushed), the Deno function (`index.ts`/`openai.ts`/`meal-analysis.ts` + `_shared/cors.ts`), client
  helper, and the Capture **Analyze** step + result card.
- **Switched the AI provider Gemini → OpenAI** mid-execution (user has OpenAI billing; OpenAI's
  no-training-on-API default resolves B5; Structured Outputs retire the schema-nesting question).
  Updated `CLAUDE.md`'s stack line.
- **Deployed + web-verified** `analyze-meal` end-to-end (real photo → "Grilled Fish with Rice and
  Soda" card). Set the `OPENAI_API_KEY` secret. **Plan 0008 → Done.**
- **Fixed a CORS bug:** browser `functions.invoke` sends `x-client-info` / `x-supabase-api-version`;
  `_shared/cors.ts` now allows them (a missing allow-header surfaced as a client `network` error).
- **Drafted + reviewed + Approved plan 0009** (meal review/edit + save). 3 blockers resolved in-plan.

## Next steps (pick up here)
1. **Execute plan 0009** ([docs/plans/0009-meal-review-save.md](../plans/0009-meal-review-save.md)) —
   Approved. Build order per its Rollout:
   - Write + `supabase db push` the **`create_meal_log(jsonb, jsonb)` RPC** migration — `SECURITY
     INVOKER`, `set search_path=''`, server-set `user_id:=auth.uid()`/`verified:=true`, **column
     allowlist** (no `id`/`user_id`/`verified`/`meal_log_id` from the payload), `image_path` first-
     segment `= auth.uid()` check, item-count guard `1..50`, `->>`+casts with aliased `with ordinality
     as t(e, ord)`, **idempotent** `on conflict (image_path) do nothing` → return existing id. **No type
     regen** (client is untyped; `.rpc` returns `any`).
   - `src/features/capture/lib/meal-form.ts` (seed/validators mirroring DB bounds + `parseNumber` reuse,
     `recomputeTotals` on `sumNutrients`, `toSavePayload`) → `lib/save-meal.ts` (`withTimeout` 20 s,
     map by `error.code` only, never log message/details) → `screens/meal-review.tsx` (editable card,
     reuse `Input`) → wire into `capture-screen.tsx` as `<MealReview key={uploadedPath ?? 'none'} … />`.
   - `npx tsc --noEmit` + `npx expo lint`; then **web verify** — analyze → edit → remove an item →
     totals update → Save → confirm the `meal_logs` row (`verified=true`, `image_path` set) + N
     `meal_items` rows in Supabase. **Actually invoke the RPC as a signed-in user** (an empty-
     `search_path` failure only shows on a real call, not on `db push`).
   - Commit straight to `main`. Next: **S3** — meals history/list + day totals reading these rows.

## Open questions / risks
- **OpenAI billing is live but watch cost** — the `analyze_usage` daily cap is **N=50/user/day**;
  tune if needed. Each analyze is a real paid GPT-4o-mini vision call.
- **CORS prod origin is still a TODO** in `supabase/functions/_shared/cors.ts` (only Expo web dev
  origins `localhost:8081`/`127.0.0.1:8081` are allowed today) — add the prod web origin before web prod.
- **Carry-through drift (plan 0009 v1):** edited macros can diverge from carried sugar/fiber — accepted
  for v1; per-item recompute-on-edit is the named follow-up.
- **Tracked obligations:** privacy policy must disclose meal photos + nutrition go to **OpenAI**; 0007
  SF9 storage orphan cleanup; custom SMTP for signup/reset emails.
- **`deno check` needs Deno** at `~/.deno/bin/deno` (installed this session; CLI ships none). supabase-js
  is imported via `esm.sh` (not `jsr:`) in the function so `deno check` resolves it.

## How to resume
Run `/session-start`. Node is via nvm — if `node`/`npm` are missing, `source ~/.zshrc`. Work from
`/Users/roham_abt/Desktop/calorie count` (quote the space). Build **sequentially on `main`** (commit
straight, no PRs). **Converse in Persian.**
