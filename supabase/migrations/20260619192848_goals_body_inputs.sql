-- ============================================================================
-- Calorie Counter — add raw body inputs to `goals` (onboarding + TDEE)
-- Plan: docs/plans/0005-onboarding-tdee.md (B4)
--
-- The `goals` table only stored *computed* targets. Onboarding now persists the
-- raw inputs that produced them (age/sex/height/weight) so piece 3 can edit and
-- recompute TDEE without re-asking everything. `goals` is 1-row-per-user;
-- `profiles` stays identity/preferences only.
--
-- NaN note (plan 0001 lesson): for Postgres `numeric`, `NaN >= 0` is TRUE, so a
-- lower bound alone accepts NaN. Bounded `between` checks reject NaN *and* cap
-- absurd values. Client validation mirrors these exact bounds so a valid form is
-- never rejected by Postgres.
--
-- Columns are nullable: existing rows predate onboarding. A completed onboarding
-- always sets all four; piece 3 keeps them populated on edit (SF5 invariant).
-- No RLS change (existing owner-scoped policies cover new columns); no
-- `DEFAULT auth.uid()` on `user_id` (client supplies it, B5). The existing
-- `set_updated_at` trigger bumps `updated_at` on these updates automatically (N3).
-- ============================================================================

alter table public.goals
  add column if not exists age       integer check (age       between 13 and 120),
  add column if not exists sex       text    check (sex       in ('male','female')),
  add column if not exists height_cm numeric check (height_cm between 50 and 272),
  add column if not exists weight_kg numeric check (weight_kg between 20 and 500);
