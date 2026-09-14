-- Plan 0035: manual (custom) calorie + macro targets.
--
-- One boolean on `goals`: when true, the stored calories/macros are user-set (a
-- coach's numbers, a specific cut) rather than the TDEE-formula output, so the
-- Settings editor must not silently recompute/overwrite them. Existing rows
-- backfill to false (computed) — no behavior change until a user opts in.
--
-- Constant default → metadata-only add (no table rewrite). RLS unchanged: `goals`
-- is already owner-scoped for every verb; a non-key boolean inherits that.

alter table public.goals
  add column if not exists is_custom boolean not null default false;
