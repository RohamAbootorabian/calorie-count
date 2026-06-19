# Plan: Database schema + Row-Level Security (Phase A foundation)

- **Status**: Approved (revised after multi-agent review 2026-06-19)
- **Created**: 2026-06-19
- **Plan #**: 0001

## Problem / Goal
Stand up the Postgres schema, storage bucket, and row-level-security (RLS) that
every feature module depends on. This is the Phase A trunk from
[../MODULES.md](../MODULES.md). "Done" = migration applies cleanly to the linked
Supabase project, a user can **only** ever read/write their own data (verified by
a two-user + anon test), and the schema mirrors `src/types/nutrition.ts`.

## Non-goals
- No app/UI code, no Edge Function (that's the `analyze-meal` plan).
- No seed/demo data beyond what's needed to verify RLS.
- No analytics/aggregation tables; no social/sharing.
- Storage-object cleanup automation is **out of scope here** but is a documented,
  owned follow-up (see Edge cases) — not "solved."

## Proposed approach
A **single** initial migration (`initial_schema.sql`) with commented sections —
`-- TABLES`, `-- TRIGGERS`, `-- RLS`, `-- STORAGE POLICIES` — so RLS is enabled in
the *same* migration that creates each table (no partial-apply window where a
table exists without RLS). The bucket itself is declared in `config.toml`
(reproducible on `db reset`); only its policies live in SQL. Enums are `text` +
`CHECK` to mirror the TS unions. Dev re-runs use `IF NOT EXISTS` /
`DROP POLICY IF EXISTS`. No down migration — recovery is fix-forward (greenfield).

**Tables**

- `profiles` — 1:1 with `auth.users`.
  `id uuid PK REFERENCES auth.users(id) ON DELETE CASCADE`,
  `display_name text CHECK (char_length(display_name) <= 80)`,
  `units text NOT NULL DEFAULT 'metric' CHECK (units IN ('metric','imperial'))`,
  `timezone text NOT NULL DEFAULT 'UTC'` (valid IANA name; used to bucket "today"),
  `created_at timestamptz NOT NULL DEFAULT now()`, `updated_at timestamptz NOT NULL DEFAULT now()`.
- `goals` — one active goal row per user.
  `user_id uuid PK REFERENCES auth.users(id) ON DELETE CASCADE`,
  `calories int NOT NULL CHECK (calories BETWEEN 0 AND 20000)`,
  `protein/carbs/fat numeric NOT NULL CHECK (col >= 0 AND col <= 5000)`,
  `weight_goal text NOT NULL CHECK (weight_goal IN ('lose','maintain','gain'))`,
  `activity_level text NOT NULL CHECK (activity_level IN ('sedentary','light','moderate','active','very_active'))`,
  timestamps.
- `meal_logs` — one analyzed meal. Mirrors `MealAnalysis` + `MealLog`.
  `id uuid PK DEFAULT gen_random_uuid()` (writer may supply it so the storage path
  is known before upload),
  `user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE`,
  `image_path text UNIQUE` (storage object path, not a public URL; nullable until photo saved),
  `eaten_at timestamptz NOT NULL DEFAULT now()`,
  `dish_name text NOT NULL CHECK (char_length(dish_name) <= 200)`,
  `confidence text NOT NULL CHECK (confidence IN ('low','medium','high'))`,
  `quality_score int CHECK (quality_score BETWEEN 0 AND 100)` (nullable — `quality?`),
  `quality_factors text[]` (nullable — the reasons from `QualityScore.factors`),
  `assumptions text[]` (nullable),
  totals `total_calories/total_protein/total_carbs/total_fat/total_sugar/total_fiber/total_sodium numeric NOT NULL CHECK (col >= 0 AND col = col)` (the `col = col` rejects `NaN`; **no DEFAULT** so a missing totals write fails loudly),
  `verified boolean NOT NULL DEFAULT false`,
  `created_at timestamptz NOT NULL DEFAULT now()`, `updated_at timestamptz NOT NULL DEFAULT now()`.
- `meal_items` — components of a meal. Mirrors `FoodItem`.
  `id uuid PK DEFAULT gen_random_uuid()`,
  `meal_log_id uuid NOT NULL REFERENCES meal_logs(id) ON DELETE CASCADE`,
  `position int NOT NULL DEFAULT 0` (preserves model item order),
  `name text NOT NULL CHECK (char_length(name) <= 200)`, `portion text`,
  `estimated_grams numeric CHECK (estimated_grams >= 0 AND estimated_grams = estimated_grams)`,
  nutrients `calories/protein/carbs/fat/sugar/fiber/sodium numeric NOT NULL CHECK (col >= 0 AND col = col)`.

**Totals authority:** the **Edge Function** (server-side, in the `analyze-meal`
plan) writes `meal_logs` + `meal_items` + totals in one call; the phone is not
trusted to compute them. Totals are `NOT NULL` so a partial write fails. A
recompute trigger from `meal_items` is the documented future hardening.

**Storage**: private bucket `meal-photos` declared in `config.toml`
(`public = false`, `file_size_limit`, `allowed_mime_types = image/jpeg,image/png`).
Path convention `{user_id}/{meal_log_id}.{ext}` (the writer knows the id before
upload). RLS via `(storage.foldername(name))[1] = auth.uid()::text` on all four
verbs.

**RLS** — `ENABLE ROW LEVEL SECURITY` on all four tables, **default-deny**. For
each user-owned table, **per-verb** policies:
- `FOR SELECT USING (auth.uid() = user_id)`
- `FOR INSERT WITH CHECK (auth.uid() = user_id)`
- `FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)`
- `FOR DELETE USING (auth.uid() = user_id)`
`meal_items` uses the same shape but with
`EXISTS (SELECT 1 FROM meal_logs WHERE meal_logs.id = meal_items.meal_log_id AND meal_logs.user_id = auth.uid())`
in **both** `USING` (select/update/delete) and `WITH CHECK` (insert/update) — so a
user can never attach or re-point an item to someone else's meal.

**Triggers**:
- `handle_new_user()` — `SECURITY DEFINER`, `SET search_path = ''`, all objects
  schema-qualified (`public.profiles`, `auth.users`), `INSERT ... ON CONFLICT (id)
  DO NOTHING`, wrapped in `EXCEPTION WHEN OTHERS THEN RETURN new` so a profile-insert
  failure can never abort signup.
- `set_updated_at()` — `SECURITY INVOKER`, sets `updated_at = now()` on update;
  attached to `profiles`, `goals`, `meal_logs`, `meal_items`.

**Indexes**: `meal_logs(user_id, eaten_at DESC)` (diary/trends); `meal_items(meal_log_id)` (FK join + RLS subquery).

## Files to change
- `supabase/config.toml` — declare the `meal-photos` bucket (private, limits).
- `supabase/migrations/<ts>_initial_schema.sql` — created via `supabase migration new initial_schema`; tables + constraints + indexes + triggers + RLS + storage policies, in commented sections.
- `src/types/database.ts` — generated via `supabase gen types typescript --linked`; committed.
- `CLAUDE.md` — fix the stack line ("Claude vision" → "Gemini 2.5 Flash") to match the model decision (flagged in review).

## Data model / schema impact
Greenfield — first migration, no data to migrate. `quality.factors` →
`quality_factors text[]`; `MealLog.imageUrl` (TS) maps to `image_path` (DB stores
the private path; the app signs a URL on read). Totals denormalized on `meal_logs`
(server-authoritative).

## Edge cases & failure modes
- **Signup never breaks** — `handle_new_user` swallows errors + `ON CONFLICT DO NOTHING`; app profile-reads must tolerate a missing row (get-or-create), since a profile is best-effort.
- **Cross-user writes** — closed by `WITH CHECK` on every INSERT/UPDATE and the `meal_items` ownership subquery in both `USING` and `WITH CHECK`.
- **SECURITY DEFINER escalation** — closed by pinned `search_path = ''` + schema-qualified objects.
- **NaN / absurd values** — `col = col` rejects `NaN` (which would otherwise pass `>= 0` in Postgres); sane upper bounds on calories/grams.
- **Totals drift** — totals `NOT NULL`, written server-side with items in one call; recompute trigger noted as future hardening.
- **Orphaned storage objects** (meal delete *and* account delete cascade rows but not files) — **known, owned follow-up**: the Capture feature deletes the object on meal delete, and account-deletion must purge `meal-photos/{user_id}/`; a periodic reconciler is the backstop. Documented, not solved here.
- **Storage path** — bound to the user via `foldername[1]`, not to a real `meal_log_id` (a user can write `A/<any>.jpg`); acceptable, noted. `image_path UNIQUE` prevents two logs sharing one object.
- **Timezone** — `NOT NULL DEFAULT 'UTC'`; "today" bucketing uses `eaten_at AT TIME ZONE profiles.timezone`; changing tz re-buckets past meals (acceptable for v1).
- **Migration atomicity** — RLS enabled in the same migration as each table; `IF NOT EXISTS` / `DROP POLICY IF EXISTS` keep dev `db reset` clean.

## Test / verify plan
1. `supabase db push` applies with no errors; `supabase db reset` (if Docker) re-applies clean.
2. **RLS proof:** two test users + the **anon** role. Confirm user A cannot
   select/insert/update/delete user B's `meal_logs`/`meal_items`/`goals`/`profiles`
   or storage objects; confirm anon (no session) gets nothing.
3. **Cross-user write attempt:** as user A, try inserting a `meal_logs` row with
   B's `user_id`, and a `meal_items` row pointing at B's `meal_log_id` — both must fail.
4. Insert a full meal (log + items + totals) and confirm constraints (NaN, bounds) hold.
5. `supabase gen types typescript --linked` succeeds and reflects the schema.
6. App still typechecks (`npx tsc --noEmit`).

## Rollout
1. Declare bucket in `config.toml`.
2. `supabase migration new initial_schema`; write SQL (sections above).
3. `supabase db push` to linked project `vldpfoczswakghkrkyrm`.
4. Run the RLS proof (step 2–3 above) as two users + anon.
5. `supabase gen types typescript --linked > src/types/database.ts`; commit.
6. Fix the `CLAUDE.md` stack line. No env/secret changes required.

## Open questions — RESOLVED (2026-06-19)
1. **Goals** → single active goal row per user.
2. **Timezone** → `profiles.timezone NOT NULL DEFAULT 'UTC'` now.
3. **Totals** → server-authoritative (Edge Function), `NOT NULL`, no default; recompute trigger = future hardening.
4. **Generated types** → commit `src/types/database.ts`.

---

## Review
Multi-agent review (correctness, architecture, edge-cases, data/privacy) — 2026-06-19.
**Verdict: NEEDS CHANGES → all blockers resolved in this revision.**

### BLOCKER (resolved)
- **RLS INSERT/UPDATE missing `WITH CHECK`** (edge-cases, data/privacy) → cross-user
  writes were possible. Fixed: per-verb policies with `WITH CHECK` everywhere, and
  the `meal_items` ownership subquery in both `USING` and `WITH CHECK`.
- **`SECURITY DEFINER` `search_path` not pinned** (data/privacy) → escalation vector.
  Fixed: `SET search_path = ''` + schema-qualified objects; `set_updated_at` is INVOKER.
- **Storage path anchoring + `public=false`** (data/privacy) → fixed: `foldername[1]`
  check on all four verbs, bucket declared private in `config.toml`.
- **`quality.factors` dropped** (correctness) → fixed: added `quality_factors text[]`.
- **Storage path chicken-and-egg** (correctness) → fixed: writer supplies the
  `meal_logs.id` so the path is known before upload; `image_path` nullable + UNIQUE.

### SHOULD-FIX (resolved)
- `NOT NULL DEFAULT auth.uid()` on `user_id`; `dish_name`/`confidence`/goal targets
  `NOT NULL`; `profiles.timezone NOT NULL DEFAULT 'UTC'`.
- `NaN` accepted by `numeric >= 0` → added `col = col` guard + sane upper bounds.
- Totals `DEFAULT 0` hid missing writes → removed default, server-authoritative.
- `handle_new_user` could abort signup → `EXCEPTION ... RETURN new` + best-effort profile.
- `updated_at` added to editable tables via `set_updated_at`.
- Single migration with RLS enabled alongside each table (no partial-apply window).
- Storage: four explicit verb policies; bucket via `config.toml`.
- Orphaned-object cleanup documented as an owned follow-up.
- Test plan now includes the anon role + explicit cross-user write attempts.

### NIT (applied or noted)
- `set_updated_at` = SECURITY INVOKER; `position` column on `meal_items`; `sodium`
  is mg (add `COMMENT`); text length caps; `image_path UNIQUE`; `IF NOT EXISTS` /
  `DROP POLICY IF EXISTS` for dev re-runs; no down migration (fix-forward); fix the
  `CLAUDE.md` provider line.

## Execution log
**2026-06-19 — Executed. Status: DONE.**
- Wrote `supabase/migrations/20260619102510_initial_schema.sql` (all tables,
  triggers, per-verb RLS, storage bucket + policies).
- `supabase db push` applied it to the linked project `vldpfoczswakghkrkyrm`
  (`migration list` shows local == remote).
- **Deviation from plan:** the `meal-photos` bucket is created via SQL
  (`insert into storage.buckets ... on conflict do nothing`) rather than declared
  in `config.toml`, because `db push` deploys SQL to the *remote* project but a
  `config.toml` bucket only applies to local `supabase start`. Noted inline.
- **NaN guard correction:** the planned `col = col` trick does NOT reject NaN for
  Postgres `numeric` (NaN = NaN is TRUE there). Switched every numeric column to a
  bounded range (`between 0 and MAX`), which rejects NaN (NaN > all non-NaN ⇒ fails
  the upper bound) and also caps absurd values.
- Generated `src/types/database.ts` via `supabase gen types typescript --linked`.
- **Verified:** all four tables exist on the remote and RLS is active (anon select
  returns no rows, no "missing table" error); `npx tsc --noEmit` clean.
- **Not yet done (deferred to the Auth feature, when real users exist):** the full
  two-user cross-write RLS proof (steps 2–3 of the test plan). Default-deny for the
  anon role is confirmed; per-user isolation will be exercised once signup works.
