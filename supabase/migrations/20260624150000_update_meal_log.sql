-- ============================================================================
-- Calorie Counter — update_meal_log RPC (plan 0015, the first UPDATE surface)
--
-- Replaces a saved meal's editable fields + ALL its children in a SINGLE
-- transaction (atomic: the whole edit applies or nothing does — children are
-- never lost on a failed re-insert). One round-trip, RLS-enforced. Mirrors
-- `create_meal_log` (plan 0009) so the edit path is the same shape, not a
-- parallel invention.
--
-- SECURITY MODEL: `SECURITY INVOKER` + `set search_path = ''`, directly callable
-- by any authenticated user with crafted jsonb, so the RPC — not the client — is
-- the security boundary. It reads ONLY an explicit column allowlist from the
-- payload (never jsonb_populate_record), sets `meal_log_id`/`position` as SERVER
-- literals, and scopes the parent UPDATE to `id = p_id AND user_id = auth.uid()`.
-- RLS `meal_logs_update` (USING + WITH CHECK `auth.uid() = user_id`) backstops it.
--
-- NEVER touched: `user_id`, `image_path`, `eaten_at`, `created_at`, `verified`,
-- and `updated_at` — the existing `set_updated_at` BEFORE-UPDATE trigger owns
-- `updated_at` (setting it here would be redundant). No `image_path`/namespace
-- check (unlike create) because the column is never written here.
--
-- BODY ORDER (the ownership check MUST precede any child mutation):
--   1. auth guard            → 28000
--   2. item count 1..50      → 23514
--   3. parent UPDATE + 0-row → P0002 (distinct "no longer exists", not "invalid")
--   4. delete children
--   5. re-insert children (with ordinality → positions 0..n-1)
-- The whole body is one implicit transaction → a re-insert that violates a
-- column `check` (23514) or FK (23503) rolls everything back; children survive.
--
-- NaN note (mirrors create_meal_log / initial_schema): every numeric column is
-- bounded (`<= MAX`), so crafted NaN/Infinity is rejected by the column `check`s.
-- ============================================================================

create or replace function public.update_meal_log(p_id uuid, p_log jsonb, p_items jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
volatile
as $$
declare
  v_uid  uuid := auth.uid();
  v_rows integer;
begin
  -- Guards first. Each raises a distinct SQLSTATE the client maps to a kind.
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if pg_catalog.jsonb_array_length(p_items) not between 1 and 50 then
    raise exception 'item count out of range' using errcode = '23514';
  end if;

  -- Parent UPDATE: allowlisted columns only; scoped to the caller's own row.
  -- `image_path` may ride along in p_log but is never read. `updated_at` is the
  -- trigger's; `user_id`/`eaten_at`/`created_at`/`verified` are immutable here.
  update public.meal_logs set
    dish_name       = p_log->>'dish_name',
    confidence      = p_log->>'confidence',
    quality_score   = (p_log->>'quality_score')::int,                 -- nullable
    quality_factors = case when p_log ? 'quality_factors'
         then array(select pg_catalog.jsonb_array_elements_text(p_log->'quality_factors')) end,
    assumptions     = case when p_log ? 'assumptions'
         then array(select pg_catalog.jsonb_array_elements_text(p_log->'assumptions')) end,
    total_calories  = (p_log->>'total_calories')::numeric,
    total_protein   = (p_log->>'total_protein')::numeric,
    total_carbs     = (p_log->>'total_carbs')::numeric,
    total_fat       = (p_log->>'total_fat')::numeric,
    total_sugar     = (p_log->>'total_sugar')::numeric,
    total_fiber     = (p_log->>'total_fiber')::numeric,
    total_sodium    = (p_log->>'total_sodium')::numeric
  where id = p_id and user_id = v_uid;

  -- 0 rows → the meal was deleted (another device / the 0011 sweep) OR isn't the
  -- caller's. A DISTINCT SQLSTATE (P0002 no_data_found) so the client shows "this
  -- meal no longer exists", NOT "check your values". Raised BEFORE any child
  -- mutation, so a cross-user/missing p_id writes nothing.
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'meal not found' using errcode = 'P0002';
  end if;

  -- Replace children: delete all, re-insert from the payload. meal_log_id/position
  -- are server-set; any id/meal_log_id/user_id smuggled into an item is ignored.
  delete from public.meal_items where meal_log_id = p_id;

  insert into public.meal_items
    (meal_log_id, position, name, portion, estimated_grams,
     calories, protein, carbs, fat, sugar, fiber, sodium)
  select p_id, (ord - 1)::int, e->>'name', e->>'portion', (e->>'estimatedGrams')::numeric,
         (e->>'calories')::numeric, (e->>'protein')::numeric, (e->>'carbs')::numeric,
         (e->>'fat')::numeric, (e->>'sugar')::numeric, (e->>'fiber')::numeric, (e->>'sodium')::numeric
  from pg_catalog.jsonb_array_elements(p_items) with ordinality as t(e, ord);

  return p_id;
end;
$$;

-- Only signed-in users may call it; never anon/public (mirrors create_meal_log).
revoke all on function public.update_meal_log(uuid, jsonb, jsonb) from public;
revoke all on function public.update_meal_log(uuid, jsonb, jsonb) from anon;
grant execute on function public.update_meal_log(uuid, jsonb, jsonb) to authenticated;
