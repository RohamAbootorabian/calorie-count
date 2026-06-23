-- ============================================================================
-- Calorie Counter — create_meal_log RPC (plan 0009, S2 piece 3)
--
-- Persists a reviewed meal as one `meal_logs` parent + N `meal_items` children
-- in a SINGLE transaction (atomic: the whole meal saves or nothing does — no
-- orphan parent on a partial child failure). One round-trip, RLS-enforced.
--
-- SECURITY MODEL (B2): this is `SECURITY INVOKER` and directly callable by any
-- authenticated user with crafted jsonb, so the RPC — not the client — is the
-- security boundary. It reads ONLY an explicit column allowlist from the
-- payload (never jsonb_populate_record), sets `user_id`/`verified`/
-- `meal_log_id`/`position` as SERVER literals (never from the payload), and
-- validates `image_path`'s namespace + the item count. `id`/`eaten_at`/
-- `created_at`/`updated_at` keep their column defaults.
--
-- IDEMPOTENT on `image_path` (B3): a lost-ack retry (the RPC committed but the
-- response was dropped) re-sends the same path → `on conflict do nothing` →
-- we return the EXISTING owned row's id as success and insert no duplicate
-- children. (Postgres treats multiple NULL `image_path`s as distinct, so a
-- photoless save never false-conflicts.)
--
-- NaN note (mirrors initial_schema): a bare `>= 0` accepts NaN, but every
-- numeric column here is bounded (`<= MAX`), so crafted NaN/Infinity is
-- rejected by the column `check`s → rollback → typed `invalid`. We do no
-- unbounded server arithmetic.
-- ============================================================================

create or replace function public.create_meal_log(p_log jsonb, p_items jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
volatile
as $$
declare
  v_uid    uuid := auth.uid();
  v_path   text := p_log->>'image_path';
  v_log_id uuid;
begin
  -- Guards first (B2). Each raises a distinct SQLSTATE the client maps to a kind.
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if pg_catalog.jsonb_array_length(p_items) not between 1 and 50 then
    raise exception 'item count out of range' using errcode = '23514';
  end if;

  -- image_path must be NULL or live in the caller's own `${uid}/…` namespace
  -- (mirrors the storage RLS convention) — stops pointing a row at another
  -- user's path (metadata leak / pre-claiming their unique path to DoS a save).
  if v_path is not null and pg_catalog.split_part(v_path, '/', 1) <> v_uid::text then
    raise exception 'image_path outside caller namespace' using errcode = '23514';
  end if;

  -- Parent insert: allowlisted columns only; user_id/verified are server
  -- literals; idempotent on image_path (B2/B3).
  insert into public.meal_logs
    (user_id, image_path, dish_name, confidence, quality_score, quality_factors, assumptions,
     total_calories, total_protein, total_carbs, total_fat, total_sugar, total_fiber, total_sodium,
     verified)
  values
    (v_uid, v_path, p_log->>'dish_name', p_log->>'confidence',
     (p_log->>'quality_score')::int,                                 -- nullable
     case when p_log ? 'quality_factors'
          then array(select pg_catalog.jsonb_array_elements_text(p_log->'quality_factors')) end,
     case when p_log ? 'assumptions'
          then array(select pg_catalog.jsonb_array_elements_text(p_log->'assumptions')) end,
     (p_log->>'total_calories')::numeric, (p_log->>'total_protein')::numeric,
     (p_log->>'total_carbs')::numeric, (p_log->>'total_fat')::numeric,
     (p_log->>'total_sugar')::numeric, (p_log->>'total_fiber')::numeric,
     (p_log->>'total_sodium')::numeric, true)
  on conflict (image_path) do nothing
  returning id into v_log_id;

  -- Conflict → this photo was already saved. Return the existing owned row's id
  -- as success; insert no children (the parent insert was a no-op). (B3.)
  if v_log_id is null then
    select id into v_log_id
    from public.meal_logs
    where image_path = v_path and user_id = v_uid;
    return v_log_id;
  end if;

  -- Children insert (B1): explicit `->>` + casts; `with ordinality` aliased as
  -- t(e, ord). meal_log_id/position are server-set; any id/meal_log_id/user_id
  -- smuggled into an item is ignored.
  insert into public.meal_items
    (meal_log_id, position, name, portion, estimated_grams,
     calories, protein, carbs, fat, sugar, fiber, sodium)
  select v_log_id, (ord - 1)::int, e->>'name', e->>'portion', (e->>'estimatedGrams')::numeric,
         (e->>'calories')::numeric, (e->>'protein')::numeric, (e->>'carbs')::numeric,
         (e->>'fat')::numeric, (e->>'sugar')::numeric, (e->>'fiber')::numeric, (e->>'sodium')::numeric
  from pg_catalog.jsonb_array_elements(p_items) with ordinality as t(e, ord);

  return v_log_id;
end;
$$;

-- Only signed-in users may call it; never anon/public (mirrors bump_analyze_usage).
revoke all on function public.create_meal_log(jsonb, jsonb) from public;
revoke all on function public.create_meal_log(jsonb, jsonb) from anon;
grant execute on function public.create_meal_log(jsonb, jsonb) to authenticated;
