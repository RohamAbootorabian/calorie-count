# Plan: Database schema + Row-Level Security (Phase A foundation)

- **Status**: Draft → In Review → Approved → In Progress → Done
- **Created**: 2026-06-19
- **Plan #**: 0001

## Problem / Goal
Stand up the Postgres schema, storage bucket, and row-level-security (RLS) that
every feature module depends on. This is the Phase A trunk from
[../MODULES.md](../MODULES.md) — until it's on `main`, parallel feature work is
blocked. "Done" = migrations apply cleanly to the linked Supabase project, a
user can only ever read/write their own data, and the schema mirrors
`src/types/nutrition.ts` so the app and AI output map onto tables 1:1.

## Non-goals
- No app/UI code, no Edge Function (that's the `analyze-meal` plan).
- No seed/demo data beyond what's needed to verify RLS.
- No analytics/aggregation tables (daily summaries) — compute in queries for now.
- No social/sharing, no multi-user meals.

## Proposed approach
A single initial migration creating four tables, one storage bucket, RLS on all,
and a trigger to auto-create a profile on signup. Enums modeled as `text` +
`CHECK` constraints to mirror the TS union types without enum-migration pain.

**Tables**

- `profiles` — 1:1 with `auth.users`.
  `id uuid PK REFERENCES auth.users(id) ON DELETE CASCADE`, `display_name text`,
  `units text CHECK (units IN ('metric','imperial')) DEFAULT 'metric'`,
  `created_at`, `updated_at`.
- `goals` — one active goal row per user.
  `user_id uuid PK REFERENCES auth.users(id) ON DELETE CASCADE`,
  `calories int CHECK (calories >= 0)`, `protein/carbs/fat numeric CHECK (>=0)`,
  `weight_goal text CHECK (weight_goal IN ('lose','maintain','gain'))`,
  `activity_level text CHECK (... 'sedentary'..'very_active')`, timestamps.
- `meal_logs` — one analyzed meal. Mirrors `MealAnalysis` + `MealLog`.
  `id uuid PK DEFAULT gen_random_uuid()`,
  `user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE`,
  `image_path text` (storage object path, not a public URL),
  `eaten_at timestamptz NOT NULL DEFAULT now()`,
  `dish_name text`, `confidence text CHECK (confidence IN ('low','medium','high'))`,
  `quality_score int CHECK (quality_score BETWEEN 0 AND 100)` (nullable),
  `assumptions text[]`,
  denormalized totals: `total_calories, total_protein, total_carbs, total_fat,
  total_sugar, total_fiber, total_sodium numeric DEFAULT 0 CHECK (>=0)`,
  `verified boolean DEFAULT false`, `created_at`.
- `meal_items` — components of a meal. Mirrors `FoodItem`.
  `id uuid PK DEFAULT gen_random_uuid()`,
  `meal_log_id uuid REFERENCES meal_logs(id) ON DELETE CASCADE`,
  `name text NOT NULL`, `portion text`, `estimated_grams numeric CHECK (>=0)`,
  `calories, protein, carbs, fat, sugar, fiber, sodium numeric DEFAULT 0 CHECK (>=0)`.

**Storage**: private bucket `meal-photos`. Object path convention
`{user_id}/{meal_log_id}.jpg`. Storage RLS restricts access to objects whose
first path segment equals `auth.uid()`.

**RLS**: `ENABLE ROW LEVEL SECURITY` on all four tables. `profiles`/`goals`/
`meal_logs`: policies for select/insert/update/delete gated on
`auth.uid() = user_id` (or `id` for profiles). `meal_items`: gated via
`EXISTS (SELECT 1 FROM meal_logs WHERE meal_logs.id = meal_items.meal_log_id AND
meal_logs.user_id = auth.uid())`.

**Trigger**: `handle_new_user()` (SECURITY DEFINER) inserts a `profiles` row on
`auth.users` insert. Plus a shared `set_updated_at()` trigger on tables with
`updated_at`.

**Indexes**: `meal_logs(user_id, eaten_at desc)` for the diary; `meal_items(meal_log_id)`.

## Files to change
- `supabase/migrations/<ts>_initial_schema.sql` — created via `supabase migration new initial_schema`; contains tables, constraints, indexes, triggers.
- `supabase/migrations/<ts>_rls_policies.sql` — RLS enable + all policies (kept separate for readability/review).
- `supabase/migrations/<ts>_storage_meal_photos.sql` — bucket insert + storage policies.
- (Optional) `src/types/database.ts` — generated via `supabase gen types typescript` after push, so the client is typed. Generated, not hand-written.

## Data model / schema impact
Greenfield — these are the first migrations. No existing data to migrate.
`totals` on `MealAnalysis` are stored denormalized on `meal_logs` (matches the
"denormalised for quick reads" note in `nutrition.ts`); the Edge Function/app is
responsible for keeping them equal to the sum of `meal_items` (the client
already recomputes totals in `analyzeMeal.ts`).

## Edge cases & failure modes
- **meal_items RLS via subquery** — ensure `meal_items(meal_log_id)` is indexed so
  the policy check isn't a seq scan.
- **Orphan storage objects** — deleting a `meal_log` cascades its row + items, but
  the storage object is not auto-deleted; note for the Capture module (delete the
  object in app code, or a later cleanup job).
- **Totals drift** — if app writes items but stale totals, diary disagrees.
  Mitigation: client recomputes totals before insert; flag a possible DB trigger
  to recompute as an open question.
- **Negative / absurd values** — `CHECK (>= 0)` on nutrients; `quality_score`
  bounded 0–100.
- **Signup race** — `handle_new_user` must be `SECURITY DEFINER` and idempotent
  (`ON CONFLICT DO NOTHING`) so a retried signup doesn't error.
- **Daily totals & timezone** — `eaten_at` is `timestamptz`; "what counts as today"
  depends on the user's timezone. Not solved here — see Open questions.

## Test / verify plan
1. `supabase db push` applies migrations to the linked project with no errors.
2. `supabase db reset` locally (if Docker available) re-applies from scratch cleanly.
3. RLS check: create two test users; confirm user A cannot select/update/delete
   user B's `meal_logs`, `meal_items`, `goals`, `profiles`, or storage objects
   (run as each user via the anon key + a signed-in session).
4. Insert a full meal (log + items) and confirm totals/constraints hold.
5. `supabase gen types typescript` succeeds and reflects the schema.
6. App still typechecks (`npx tsc --noEmit`).

## Rollout
1. `supabase migration new initial_schema` (and the rls/storage migrations).
2. Write SQL; review locally.
3. `supabase db push` to the linked project `vldpfoczswakghkrkyrm`.
4. Verify the bucket exists (Dashboard → Storage) and RLS via the two-user test.
5. `supabase gen types typescript --linked > src/types/database.ts`; commit.
Order matters: tables → RLS → storage. No env/secret changes required.

## Open questions
1. **Goals: single row vs history?** Plan assumes one active goal per user
   (simplest). If we want trend-over-time on goals, switch to a history table
   with `effective_from`. Recommend single now.
2. **Daily-total timezone** — store a `timezone` on `profiles` and bucket days by
   it, or compute "today" client-side from device tz? Recommend a `profiles.timezone`
   column now to avoid a later migration; confirm.
3. **Totals: client-computed vs DB trigger** — keep client-authoritative (current
   `analyzeMeal.ts` behavior) or add a trigger that recomputes `meal_logs` totals
   from `meal_items`? Recommend client-authoritative for v1, revisit if drift appears.
4. **Generated types location/commit** — commit `src/types/database.ts` to the
   repo, or gitignore and generate per-machine? Recommend commit for parallel sessions.

---

## Review
<!-- Filled by /review-plan. Findings grouped: BLOCKER / SHOULD-FIX / NIT, each
     with a suggested resolution. Verdict: APPROVED or NEEDS CHANGES. -->

## Execution log
<!-- Filled during execution: what actually happened, any deviation from the plan
     and why, final verification result. -->
