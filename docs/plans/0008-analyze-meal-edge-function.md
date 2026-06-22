# Plan: `analyze-meal` Edge Function — photo → MealAnalysis (S2 · piece 2)

- **Status**: **Approved** (2026-06-22) — multi-agent review: **6 blockers resolved in-plan**
  (error contract returns 200+typed body; eslint must ignore Deno; Gemini truncation/empty-
  candidate guarding; reconciled download/Gemini/client timeouts; paid Gemini tier + privacy;
  per-user daily cost cap). All should-fixes folded in; all open questions decided. Ready to
  execute. _(One scope change from review: a small `analyze_usage` cap migration is now in
  scope.)_
- **Created**: 2026-06-22
- **Plan #**: 0008

## Problem / Goal
Piece 1 gets a meal photo into the private `meal-photos/{uid}/…` bucket and hands the
phone a storage **path**. Piece 2 turns that path into nutrition: a Supabase **Edge
Function** `analyze-meal` that authenticates the caller, confirms they own the path,
loads the image bytes server-side, calls **Gemini 2.5 Flash (vision)** with a
structured prompt, validates/coerces the model's JSON into a `MealAnalysis`
(per [src/types/nutrition.ts](../../src/types/nutrition.ts)), and returns it to the phone.

This is the step that realises the **core architecture rule**: the phone **NEVER**
calls Gemini directly. Photo path → Edge Function → Gemini → structured `MealAnalysis`
→ phone. The AI key lives **only** in an Edge Function secret.

**Done looks like:**
- A deployed `analyze-meal` function that, given `{ path }` from a signed-in user,
  returns a valid `MealAnalysis` JSON (dishName, items[], totals, confidence, quality,
  assumptions) or a typed error.
- The function **rejects** callers who don't own the path (RLS-enforced read) and
  anonymous callers (JWT-verified), and **never** leaks the API key or logs photo bytes.
- The phone calls it via `supabase.functions.invoke('analyze-meal', { body:{ path } })`
  through a typed client helper, and the Capture screen shows a **read-only** result
  (dish name + totals + confidence) after analysis — enough to verify the round-trip.
- Garbage/timeout/over-budget AI responses degrade to a friendly, typed error (no crash,
  no half-parsed data).
- Verified on **web** (signed-in test user: upload → analyze → see totals).

## Non-goals
- **No `meal_logs`/`meal_items` write** — piece 3 persists the analysis + lets the user
  edit it. Piece 2 returns the analysis in memory only (mirrors piece 1 keeping `path` in
  screen state).
- **No editable results UI** — piece 2's display is read-only and minimal (verification
  surface), not the final review screen (piece 3).
- **No new storage bucket / RLS change / table change** — reads the existing private
  bucket with the caller's own credentials.
- **No multi-image / batch / re-analyze history**, no streaming responses, no on-device
  model, no offline queue.
- **No deterministic re-scoring engine** for the food-quality score beyond light
  server-side validation — the model returns the score this piece (see Open questions Q3).
- **No *sophisticated* rate-limiting/quota system** (no sliding windows, billing tiers, or
  per-endpoint policies) — but review added a **crude per-user/day cap** (B6) as a hard
  prerequisite for exposing a paid API; that interim cap IS in scope (see Data model).

## Proposed approach

### Where the code lives
- `supabase/functions/analyze-meal/index.ts` — the Deno Edge Function (handler).
- `supabase/functions/analyze-meal/gemini.ts` — Gemini request builder + REST call +
  response-schema parsing/coercion (kept separate so it's unit-reviewable).
- `supabase/functions/analyze-meal/meal-analysis.ts` — the `MealAnalysis` shape, the
  Gemini `responseSchema`, and `coerceMealAnalysis()` (clamp/validate). **Mirrors**
  `src/types/nutrition.ts` — the two must stay in sync (documented coupling; see Q1).
- `supabase/functions/_shared/cors.ts` — shared CORS headers + preflight helper (web
  calls cross-origin; reused by future functions).
- `src/features/capture/lib/analyze-meal.ts` — NEW client helper `analyzeMeal({ path })`
  → `{ ok:true, analysis } | { ok:false, kind }` (typed, mirrors `uploadMealPhoto`).
- `src/features/capture/screens/capture-screen.tsx` — add an **Analyze** step after a
  successful upload that calls the helper and renders a read-only summary. Use **its own
  state** (`analyzing`, `analysis`, `analyzeError`/`analyzeCanRetry`) — do **not** overload
  the upload error state, or a stale upload error renders under the analyze card. Guard with
  `if (!uploadedPath || analyzing) return;` (no double Gemini charge) and the existing
  `mounted` ref before every post-await setState. Capture the `path` in the closure and
  ignore a late result if `uploadedPath` changed (re-pick race).
- `supabase/config.toml` — add `[functions.analyze-meal]` with `verify_jwt = true`.
- `tsconfig.json` — **exclude `supabase`** so the app's `tsc` doesn't try to typecheck
  Deno code (see Edge cases — this WILL break `tsc` otherwise).

### Auth & ownership (defence in depth)
1. **JWT verify** — `verify_jwt = true` (config) rejects **missing/malformed** JWTs at the
   gateway (a 401 before our code runs). Note: the **anon key is itself a valid JWT**, so it
   passes `verify_jwt`; the real "anonymous" rejection is step 2's `getUser()`.
2. **Identify caller** — build a Supabase client with the **anon key + the caller's raw
   `Authorization` header forwarded verbatim** (incl. the `Bearer ` prefix), constructed
   with `auth: { persistSession: false, autoRefreshToken: false }` (no storage in Deno).
   Call `auth.getUser()` (validates the token against the auth server) → the verified `uid`;
   if absent (anon key, or a valid token for a deleted user) → return `{ ok:false,
   kind:'unauthorized' }`.
3. **Ownership via RLS, not string-trust** — read the image through *this user-scoped
   client* (`storage.from('meal-photos').download(path)`). The bucket's `select` policy
   (`(storage.foldername(name))[1] = auth.uid()`) means a path the caller doesn't own
   **fails the download**. We do **not** use the service-role key for the read (least
   privilege; service role would bypass RLS and let any path be read — this RLS download is
   the load-bearing authorization, never the regex in step 4).
   **RLS deliberately makes "not owned" and "genuinely missing" indistinguishable** (both
   return not-found), so a failed download → one permanent `not_found` kind — we do **not**
   promise a 403-vs-404 distinction we can't make.
4. **Cheap pre-check (cost guard, not authorization)** — before spending an AI call,
   validate `path` is a non-empty string of shape `^<uid>/[^/]+\.(jpg|jpeg|png)$` whose
   first segment **equals** the caller `uid`. A mismatch → `not_found` without ever hitting
   Gemini. This is a guard to save cost; ownership is still enforced by step 3's RLS download.

### Getting bytes to Gemini — download, not signed URL
Download the object bytes via the user-scoped client (RLS-enforced), base64-encode, and
send to Gemini as **`inlineData`** (`{ mimeType, data }`). Our 10 MB cap → ~13 MB base64,
well under Gemini's ~20 MB inline-request limit. A short-lived **signed URL was
considered and rejected**: Gemini's `fileData` wants a Files-API/GCS URI, not an arbitrary
HTTPS URL, so a signed URL would add an extra public handle (health-data exposure, SF-class
risk) without removing the server-side fetch. Download-inline is simpler and leaks nothing.

### Calling Gemini 2.5 Flash (structured output)
- **Data tier (resolves B5 — privacy):** call Gemini on a **paid / billing-enabled tier**
  (or Vertex AI), NOT the free `generativelanguage` tier. Meal photos are health-adjacent
  PII; the free tier may **retain images ~55 days and use them to improve products
  (training)**, whereas the paid tier carries the no-training / zero-retention-for-training
  commitment. Pin the tier in the deploy checklist and cite Google's data-use terms in the
  function header. **Privacy-policy obligation** (tracked, like 0007 SF9): the policy must
  disclose that meal photos + derived nutrition are sent to Google for analysis.
- **Model**: `gemini-2.5-flash`. **REST** `POST
  https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`
  with `x-goog-api-key: <GEMINI_API_KEY>` (key from the function secret; never a query
  param that could land in logs). No SDK — raw `fetch` keeps the dependency surface zero.
  Deno 2 idioms (`Deno.serve`, no `std/http`), per `config.toml deno_version = 2`.
- **Force JSON**: `generationConfig.responseMimeType = "application/json"` +
  `responseSchema` describing `MealAnalysis`. Note Gemini's `responseSchema` is a **subset**
  of JSON Schema (no `$ref`, limited keywords, ordering via `propertyOrdering`) — keep the
  schema **flat-ish** (avoid deep nesting / refs). Structured output is the primary defence
  against "garbage."
- **Response robustness (resolves B3):** before reading any text, **check
  `candidates[0].finishReason`** — treat anything other than `STOP` (`MAX_TOKENS`, `SAFETY`,
  `RECITATION`, `OTHER`) as `bad_ai_response`, since `MAX_TOKENS` yields truncated-but-
  sometimes-parseable JSON. **Null-guard the whole chain** (`candidates?`, `[0].content?`,
  `.parts?[0]?.text`, `promptFeedback.blockReason`): any missing link → `bad_ai_response`
  (never a `TypeError`/uncaught 500). A SAFETY block on a *food* photo is almost always
  spurious → `bad_ai_response` (retryable, bounded — see B6/Edge), not `no_food`.
- **Bound cost/latency (resolves B4 timeouts):** low `temperature` (~0.2);
  `maxOutputTokens` set **comfortably above** a max-length analysis (capped items + factors
  + assumptions + per-item nutrients) so a normal result never truncates; and **two
  separate `AbortController` timeouts** — one on `storage.download()` (~15 s → `network`)
  and one on the Gemini `fetch` (~30 s → `timeout`) — budgeted so `download + gemini` stays
  under the Edge wall-clock limit. The **client** wraps `invoke` in `withTimeout` (~35 s,
  just above the server's 30 s) so the server's *typed* timeout wins the race when reachable
  (client → `timeout`/`network` only when the server is unreachable).
- **Prompt** (system/first part): "You are a nutrition estimator. From this meal photo,
  identify each food item, estimate portion grams and per-item nutrients (calories,
  protein, carbs, fat, sugar, fiber, sodium-mg), the overall dish name, your confidence,
  a 0–100 food-quality score with short factor strings, and any assumptions. Use metric;
  sodium in mg. **If the image contains no food (text, a menu, a non-food scene), return an
  empty `items` array** rather than inventing items. If unsure, lower confidence rather than
  inventing precision." Units pinned to the DB (`sodium` = mg, per the schema comment).

### Server-side validation / coercion (never trust the model)
`coerceMealAnalysis(raw)` — **one explicit number helper** used everywhere:
`coerceNum(x, max) = Number.isFinite(Number(x)) ? clamp(Number(x), 0, max) : 0`. This
turns `null`/`undefined`/`NaN`/`Infinity`/negative/`"abc"`/`"500kcal"` → `0` and never
inherits a sibling's value. **Postgres accepts `NaN` under `>= 0` checks**, so stripping
NaN here is load-bearing for piece 3's insert.
- Parse JSON; on failure → `bad_ai_response`.
- Enforce `confidence ∈ {low,medium,high}` (default `low` if off-enum).
- **Per-field clamps pinned to the migration literals** (cite
  `20260619102510_initial_schema.sql`): every item & total **calories** 0–100000; **protein,
  carbs, fat, sugar, fiber** 0–10000; **sodium** 0–1000000 (mg); **`estimatedGrams`**
  0–100000. Apply `coerceNum` to **every** nutrient AND `estimatedGrams`.
- **Recompute `totals` server-side** as `sumNutrients(items)` (the type defines totals as
  the denormalised item sum) — then **re-clamp the recomputed totals to the totals' own DB
  ranges** (B-fix): item caps do NOT bound their sum (N items × 10000 protein can exceed the
  `total_protein <= 10000` check), so the final clamp prevents a piece-3 constraint violation.
- **Strings:** truncate `dishName`/`name`/`portion`/`factors[]`/`assumptions[]` to ≤200
  chars (DB `char_length ≤ 200`); **default `dishName` to a non-empty `"Meal"`** if empty/
  missing (`dish_name` is `not null` and an empty name is a UX hole).
- Clamp `quality.score` to 0–100. If the model **omits `quality`**, leave it `undefined`
  (valid per the optional type) — never fabricate `{ score: 0 }`, which would read as a real
  "0/100." Cap `items`/`factors`/`assumptions` array lengths to bound payload.
- **No-food / degenerate (resolves Q4):** empty `items` → typed **`no_food`** error ("we
  couldn't find a meal"). Also, if `confidence === 'low'` AND the result is degenerate (all-
  zero totals, or a single unnamed item), prefer the `no_food`/low-confidence copy over a
  confident-looking card — a menu/text photo otherwise yields hallucinated, clamped-but-
  absurd numbers.

### How the phone calls it (error contract — resolves B1)
`analyzeMeal({ path })` in the capture feature:
```ts
const { data, error } = await supabase.functions.invoke('analyze-meal', { body: { path } });
```
`functions.invoke` attaches the caller's JWT automatically. **Critical contract:** the
function **always returns HTTP 200** with a JSON body of either `{ ok:true, analysis }`
or `{ ok:false, kind }`. We do **not** use non-2xx status codes for app-level failures,
because `supabase.functions.invoke` wraps any non-2xx in a `FunctionsHttpError` and sets
`data = null`, hiding our typed `kind` (the body would only be reachable via
`await error.context.json()`). Returning 200 + a typed body means the client reads `data`
directly and the transient-vs-permanent retry logic works (B1). The client still maps
**transport** failures: `FunctionsFetchError` → `network`, and wraps the call in a
`withTimeout` (~35 s, see B4) → `timeout`. (`verify_jwt` rejection at the gateway is the
one real non-2xx — a 401 — which the client maps to `unauthorized`.)

The full typed `kind` union (exhaustive `switch` in the screen, mirrors piece 1):
`unauthorized | not_found | no_food | bad_ai_response | rate_limited | too_large |
timeout | network | unknown`. Returns `{ ok:true, analysis }` or `{ ok:false, kind }`.
The client helper imports the **real** `MealAnalysis` type from `src/types/nutrition.ts`;
never logs the analysis, path, or raw response.

On the Capture screen: after `uploadedPath` is set, show an **Analyze meal** button →
calls `analyzeMeal({ path })` → on success render a read-only card (dishName, totals
calories/macros, confidence, and the quality score if present). Errors reuse the
transient-vs-permanent retry pattern from piece 1 (B3). Editing/saving = piece 3.

## Files to change
- `supabase/functions/analyze-meal/index.ts` — NEW: handler (CORS, auth, ownership,
  download, call Gemini, coerce, respond).
- `supabase/functions/analyze-meal/gemini.ts` — NEW: Gemini request + REST + parse.
- `supabase/functions/analyze-meal/meal-analysis.ts` — NEW: shape, responseSchema,
  `coerceMealAnalysis`, clamps (mirrors `nutrition.ts`).
- `supabase/functions/_shared/cors.ts` — NEW: CORS headers + OPTIONS preflight. **Pin
  `Access-Control-Allow-Origin` to the known web origin(s)** (Expo web dev + prod), NOT `*`;
  allow-headers `Authorization, Content-Type, apikey` (B-fix — health endpoint).
- `supabase/migrations/<ts>_analyze_usage.sql` — NEW: the `analyze_usage` daily-cap table +
  owner-only RLS + the increment rpc (resolves B6).
- `src/features/capture/lib/analyze-meal.ts` — NEW: typed client helper.
- `src/features/capture/screens/capture-screen.tsx` — add the Analyze step + read-only
  result card.
- `supabase/config.toml` — add `[functions.analyze-meal] verify_jwt = true`.
- `tsconfig.json` — add `"exclude": ["supabase"]` (Deno code must not enter app `tsc`).
- `eslint.config.js` — **add `"supabase/**"` to `ignores` (resolves B2)** — `expo lint` is
  in the Done gate and ESLint flat config does NOT read `tsconfig.exclude`; without this it
  lints Deno code (`esm.sh`/`jsr:` imports, `Deno.*` globals) and **fails**. Verify with
  `expo lint` *after* a function file exists.
- **docs / deploy checklist** — note the **`GEMINI_API_KEY`** secret (set via
  `supabase secrets set`, server-only). Do **NOT** add it to `.env.example` (that file is the
  `EXPO_PUBLIC_*` surface — listing a secret there implies it's a client var).

## Data model / schema impact
**Almost none, with one small interim addition for the cost cap (B6).** The function reads the
existing private `meal-photos` bucket using the **caller's** credentials (RLS unchanged).
`meal_logs`/`meal_items` are untouched (piece 3). The only new persistent thing is the
**secret** `GEMINI_API_KEY` in Edge Function config — not schema, not committed.

**Per-user cost ceiling (resolves B6).** `verify_jwt` stops anonymous abuse but **not** an
authenticated user (or automated account) looping `analyze-meal` — each call is a real paid
Gemini vision charge and Supabase has no default per-invocation rate limit. Per-call bounding
(one image, capped tokens, timeout) caps a *single* call, not the count. Add a **crude daily
cap**: a tiny `public.analyze_usage(user_id uuid, day date, count int, primary key(user_id,
day))` table with owner-only RLS, incremented at function entry (service-role or a
`SECURITY DEFINER` rpc so the count can't be tampered with), returning typed `rate_limited`
past **N/day** (pick N in review, e.g. 50). This is a few lines and is the difference between a
bounded and unbounded bill. (Alternatively, once piece 3 lands, count today's `meal_logs` —
but piece 2 ships before piece 3, so the small table is the interim.) This **does** add one
migration — the only schema change in this piece.

**Tracked obligations (cross-linked, owned not built here):** the **privacy policy** must
disclose meal photos + derived nutrition are sent to Google (see B5); and **0007 SF9**'s
storage-lifecycle obligations (orphan cleanup, delete-cascade-to-Storage) remain open —
analyzing then abandoning still leaves an orphan photo, so SF9 stays the owner of that cost.

## Edge cases & failure modes
- **Anonymous / expired JWT** → `401`; client maps to "sign in again" (permanent).
- **Path not owned / object missing** → RLS download fails → `403`/`404`; permanent error
  ("we couldn't find that photo"). Pre-check rejects a malformed/foreign path pre-AI.
- **Bad input body** (no `path`, wrong type) → `400` without calling Gemini.
- **Image too large / wrong mime** — bucket already enforced it at upload; if the download
  somehow exceeds the inline limit, return `too_large` rather than sending a doomed request.
- **Gemini timeout / 5xx / network** → `timeout`/`network` typed error → **transient**.
- **Gemini 429 (rate limit / quota exhausted)** → typed `rate_limited` ("service busy, try
  again in a moment") — **not** an instant-retry `unknown` (which invites hammering an
  exhausted quota).
- **Gemini 400 `API_KEY_INVALID` / 403 `PERMISSION_DENIED` (key rejected)** → log "key
  rejected" (no value) and return a **permanent** server fault (mapped to `unknown` but the
  copy is "service unavailable", **not** user-retryable) — distinct from a missing key.
- **Gemini returns non-JSON / schema-violating / truncated (`MAX_TOKENS`) / empty
  candidates / SAFETY** → `bad_ai_response` (see B3 null-guarding); never surface half-parsed
  numbers. **Retry is BOUNDED** (resolves cost-amplifier): the screen caps manual retries
  (2–3) before forcing the user to re-shoot — an endlessly-retryable malformed-AI loop is
  real paid spend.
- **Model invents absurd numbers** → `coerceNum` + clamps; totals recomputed AND re-clamped
  so they can't disagree or exceed the totals' DB ranges.
- **No food / non-food image (menu, text, wall)** → empty `items` (prompted) → typed
  `no_food`; a low-confidence degenerate single item is also surfaced as `no_food` (B-fix).
- **Image near 10 MB cap** → check **downloaded `byteLength` ≤ 10 MB (matches the bucket cap)
  BEFORE base64-encoding**; over → `too_large` (belt-and-suspenders; bucket already caps at
  upload). Base64 inflates ×1.34 (10 MB → ~13.4 MB) — within Gemini's ~20 MB request body
  but not "well under," so the pre-check stays.
- **Logging discipline (explicit allow/deny):** SAFE to log = error `kind`, HTTP status,
  coarse timing, a non-PII request id. **FORBIDDEN** = `path`/`uid`, the JWT/Authorization
  header, photo bytes/base64, any signed URL, the parsed `MealAnalysis` (health data), and
  the **raw Gemini response body**. The catch-all logs *our* typed `err.message` only — never
  `JSON.stringify(upstreamResponse)`.
- **`tsc` picks up Deno code** → excluded via tsconfig (without this, `tsc` fails on Deno
  globals / esm.sh imports — a build-breaker, not optional).
- **Secret missing in the deployed env** → function returns a generic `unknown` 500 and
  logs "missing GEMINI_API_KEY" (no key value); a deploy-checklist item.
- **Cost abuse** — a signed-in user could spam analyze. Out of scope to fully solve;
  bound per-call cost (maxOutputTokens, timeout, single image) and flag a quota follow-up.

## Test / verify plan
- **App typecheck/lint**: `npx tsc --noEmit` clean (proves the `supabase` exclude works and
  the client helper + screen typecheck); `npx expo lint` clean.
- **Function typecheck**: `deno check supabase/functions/analyze-meal/index.ts` (Deno is
  installed by the Supabase CLI; run from the function dir) — catches Deno-side type errors
  the app `tsc` intentionally skips.
- **Local function run**: `supabase functions serve analyze-meal --env-file supabase/.env.local`
  (holds `GEMINI_API_KEY` locally, gitignored) and invoke with a real signed-in JWT + a path
  that exists from a piece-1 upload; confirm a valid `MealAnalysis` comes back.
- **Negative tests**: (a) call with no JWT → 401; (b) call with another user's path → 403;
  (c) malformed body → 400; (d) point at a deliberately non-food image → low confidence or
  `no_food`; (e) temporarily break the key → `unknown`/500 with no key leak in logs.
- **Manual on web** (the Done gate): signed-in test user → Capture tab → upload a meal photo
  (piece 1) → **Analyze meal** → read-only card shows a plausible dish name + calorie/macro
  totals + confidence. Re-run with a clearly junk photo → friendly error/low confidence.
- **Secret hygiene check**: grep the diff for the key; confirm it's only referenced as
  `Deno.env.get('GEMINI_API_KEY')` and present only in `supabase secrets` / local env file.

## Rollout
1. `/review-plan` this doc; resolve blockers before coding. **(Done — 6 blockers resolved
   in-plan below.)**
2. Add `tsconfig.json` `exclude: ["supabase"]` **and** `eslint.config.js` `ignores:
   ["supabase/**"]` first (so `tsc`/`expo lint` stay green as Deno files land). Scaffold
   `supabase/functions/_shared/cors.ts`.
3. Write + push the `analyze_usage` migration (`supabase db push`) for the daily cap (B6).
4. Build `meal-analysis.ts` (shape + responseSchema + coerce) → `gemini.ts` → `index.ts`
   (Deno 2 `Deno.serve`, dual download/Gemini timeouts).
5. Confirm the **paid Gemini tier** (B5); set the secret `supabase secrets set GEMINI_API_KEY=…`
   (+ local `supabase/.env.local` for `functions serve`, already gitignored); add
   `[functions.analyze-meal] verify_jwt = true` to config.
6. `deno check` + `supabase functions serve` local tests (positive + the negative matrix:
   no-JWT, foreign path, malformed body, non-food image, broken key, 429).
7. `supabase functions deploy analyze-meal --project-ref vldpfoczswakghkrkyrm`.
8. Build the client helper (`withTimeout`, exhaustive `kind` switch) + the Capture Analyze
   step (own state, bounded retry); `tsc`/`expo lint`.
9. Verify on web end-to-end. Append `docs/JOURNAL.md`; mark Done; **commit straight to
   `main`** and push. Next: piece 3 (editable results + save to `meal_logs`/`meal_items`).

## Open questions — resolved during review (2026-06-22)
1. **`MealAnalysis` duplication (Deno vs app).** ✅ **Mirror + header comment** in
   `meal-analysis.ts`, pinned to `nutrition.ts` + the migration literals. The Deno/Metro
   module graphs are separate and an import map would couple deploy to app paths — the mirror
   is genuinely simpler. **No "shared shape test"** (the repo has no test runner; it couldn't
   cross the boundary anyway). (Q1.)
2. **Gemini key via `x-goog-api-key` header, raw fetch.** ✅ Header (never `?key=` in a URL/
   log); raw fetch matches the repo's zero-extra-dep grain. (Q2.)
3. **Food-quality score → Gemini returns it this piece.** ✅ Vision can judge processing/
   density; a **deterministic server-side scorer** from totals+factors is a named **follow-up**
   (more consistent/testable). (Q3.)
4. **No-food → typed `no_food`** (plus the low-confidence-degenerate case). ✅ (Q4.)
5. **Cost ceiling → a crude per-user/day cap IS built this piece (B6),** not deferred — per-
   call bounding alone leaves an authenticated user's loop unbounded against a paid API. The
   *sophisticated* quota system remains a follow-up. (Q5.)
6. **Verification surface → minimal read-only card on the Capture screen.** ✅ Smallest
   verifiable surface; piece 3's review screen replaces it. (Q6.)
7. **Local secret → `supabase/.env.local`.** ✅ Already gitignored (`supabase/.gitignore` +
   root `.gitignore`); no new entry needed. (Q7.)

### Still open (decide at execution, non-blocking)
- **Daily cap value N** (B6) — start at ~50/user/day? Tune from real usage.
- **Exact allowed web origins** for CORS (dev vs prod) — fill in when the prod web origin is
  known; until then, the Expo web dev origin.
- **Gemini `responseSchema` flattening** — confirm the nested `items[].nutrients` shape is
  accepted, or flatten if Gemini rejects the nesting.

---

## Review
_Multi-agent review (4 lenses: correctness, architecture, edge cases, data/privacy),
2026-06-22. Consolidated & deduped._

**Verdict: NEEDS CHANGES → 6 blockers** — all resolved in-plan (folded into the approach
above; see each `(resolves Bn)` marker). Re-review not required: the resolutions add
robustness/safety, no scope change. Blocker count by lens — correctness 1, architecture 1,
edge cases 3, data/privacy 2.

### BLOCKER
- **B1 — Error contract: `functions.invoke` hides non-2xx bodies.** (Correctness.) supabase-js
  wraps any non-2xx in `FunctionsHttpError` with `data=null`; the typed `kind` would only be
  reachable via `await error.context.json()`. **Resolution:** the function **always returns
  HTTP 200** with `{ ok:true, analysis } | { ok:false, kind }`; the client reads `data`
  directly. Transport failures map separately (`FunctionsFetchError`→`network`; gateway 401→
  `unauthorized`). Exhaustive `kind` union defined. (§How the phone calls it.)
- **B2 — `expo lint` will fail on the Deno code.** (Architecture.) The plan only excluded
  `supabase` from `tsc`; ESLint flat config ignores only `dist/*` and does **not** read
  `tsconfig.exclude`, so it would lint `esm.sh`/`Deno.*` code and error. **Resolution:** add
  `"supabase/**"` to `eslint.config.js` `ignores`; verify `expo lint` after a function file
  exists. (§Files to change.)
- **B3 — Gemini response not robust: truncation & empty candidates.** (Edge.) `MAX_TOKENS`
  yields truncated-but-sometimes-parseable JSON; SAFETY/empty candidates make
  `candidates[0].content.parts[0].text` throw an uncaught `TypeError`→500. **Resolution:**
  check `finishReason !== 'STOP'` → `bad_ai_response`; null-guard the whole candidate/
  promptFeedback chain; set `maxOutputTokens` above a max-length analysis. (§Calling Gemini.)
- **B4 — Three timeout layers unreconciled; client had none.** (Edge.) **Resolution:** dual
  server `AbortController`s — download (~15 s→`network`) and Gemini (~30 s→`timeout`) budgeted
  under the Edge wall-clock; client wraps `invoke` in `withTimeout` (~35 s, just above the
  server) so the server's typed timeout wins when reachable. (§Calling Gemini.)
- **B5 — Health data → Google with no tier/privacy decision.** (Data/privacy.) The free
  `generativelanguage` tier may retain images ~55 days and train on them. **Resolution:** pin
  the **paid / Vertex tier** (no-training, no-retention-for-training), cite the terms in the
  function header, and add a tracked **privacy-policy** obligation (meal photos + nutrition go
  to Google). (§Calling Gemini, §Data model, §Rollout step 5.)
- **B6 — No per-user cost ceiling before exposing a paid API to all users.** (Data/privacy.)
  `verify_jwt` stops anon abuse, not an authenticated loop; no default Supabase invoke rate
  limit. **Resolution:** a crude **daily cap** — `analyze_usage(user_id, day, count)` table
  (owner-only RLS, tamper-proof increment), `rate_limited` past N/day; one small migration in
  scope this piece. (§Data model, §Non-goals, §Files to change.)

### SHOULD-FIX (all folded in)
- **Coercion hardening:** one `coerceNum` helper (null/NaN/Infinity/string/negative→0;
  Postgres accepts NaN so stripping is load-bearing); **re-clamp recomputed totals** to the
  totals' DB ranges (item caps don't bound the sum); add `estimatedGrams` (0–100000) +
  `portion`/`name` truncation; **default `dishName` to "Meal"** (non-empty). (Correctness,
  Edge, Architecture.) (§Server-side validation.)
- **Auth precision:** build the user client with `persistSession:false`, forward the raw
  `Authorization` header verbatim; correct the `verify_jwt` wording (anon key is a valid JWT —
  `getUser()` is the real anon gate); **collapse not-owned vs missing to one `not_found`** (RLS
  can't distinguish them); note the regex is a cost guard, not authorization. (§Auth.)
- **Distinct Gemini failure kinds:** `429`→`rate_limited` (not instant-retry); rejected key→
  permanent "service unavailable" (distinct from missing key); **bounded retry** for
  `bad_ai_response` (2–3) so a malformed-AI loop isn't a cost amplifier. (Edge, Data.) (§Edge
  cases.)
- **Screen state isolation:** analyze gets its own `analyzing`/`analysis`/`analyzeError`
  state + double-tap guard + `mounted` ref + re-pick race guard (don't overload upload state).
  (Edge, Architecture.) (§Files to change.)
- **Download size pre-check** (`byteLength ≤ 10 MB` before base64) → `too_large`. (Edge.)
- **Logging allow/deny list** spelled out: never log path/uid/JWT/bytes/analysis/raw Gemini
  body; the catch-all logs our typed message only. (Data/privacy.) (§Edge cases.)
- **CORS pinned to known origins**, not `*`; allow-headers limited. (Data/privacy.) (§Files.)
- **Deno 2 idioms** (`Deno.serve`) + **`responseSchema` is a JSON-Schema subset** (no `$ref`,
  keep flat). (Architecture, Correctness.) (§Calling Gemini.)
- **Drop the "shared shape test"** (no test runner) and **keep `GEMINI_API_KEY` out of
  `.env.example`** (it's the `EXPO_PUBLIC` surface). (Architecture.) (§Files, §Open questions.)

### NIT (folded or noted)
- Omitted `quality` stays `undefined` (never fabricate `{score:0}`). (Correctness/Edge.)
- Consider 45–60 s tolerance if 30 s proves tight for vision (Correctness) — kept 30 s server
  / 35 s client for now.
- Valid-token-for-deleted-user → `unauthorized`, not `unknown`. (Correctness/Edge.)
- Pre-check is a guard, never the authorization (one-liner added). (Data.)
- Cross-link 0007 SF9 for the still-open storage-lifecycle/orphan obligation. (Data.) (Added.)
- Secret rotation: `supabase secrets set` needs no app redeploy (note in checklist). (Data.)

### Affirmations (no change)
- Phone never calls Gemini (key is a function secret, REST is server-side); RLS-via-user-
  download is the correct ownership gate (no service-role); raw fetch + structured output fit
  the repo grain; the read-only card on the Capture screen is the right minimal verify surface
  and composes with piece 1's `uploadedPath` branch; `_shared/cors.ts` is acceptable (piece 3
  adds a second function).

## Execution log
<!-- Filled during execution: what actually happened, any deviation from the plan
     and why, final verification result. -->
