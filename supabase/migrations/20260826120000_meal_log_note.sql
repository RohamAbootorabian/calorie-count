-- ============================================================================
-- Calorie Counter — meal note (plan 0020)
--
-- Adds an OPTIONAL free-text `note` the user writes in Capture (sent to OpenAI
-- as authoritative-on-conflict AND stored on the meal, editable later). One new
-- nullable column + a bounded-length check (mirrors the NAME_MAX-style pattern);
-- `note` is threaded into BOTH RPCs' explicit column allowlists.
--
-- The 500 char cap is a SYNC-SET with the client `NOTE_MAX` (meal-form.ts) and
-- the edge function's code-point slice — all three must move together. Postgres
-- `char_length` counts code points, so the client/edge cap (also by code point)
-- can never trip this check.
-- ============================================================================

alter table public.meal_logs add column if not exists note text;

alter table public.meal_logs drop constraint if exists meal_logs_note_len;
alter table public.meal_logs
  add constraint meal_logs_note_len
  check (note is null or pg_catalog.char_length(note) <= 500);

-- --- create_meal_log: add `note` to the allowlisted parent insert -----------
-- (Full body re-declared per `create or replace`; ONLY the note column/value is
-- new vs. 20260623132156_create_meal_log.sql — every other line is identical.)
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
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if pg_catalog.jsonb_array_length(p_items) not between 1 and 50 then
    raise exception 'item count out of range' using errcode = '23514';
  end if;

  if v_path is not null and pg_catalog.split_part(v_path, '/', 1) <> v_uid::text then
    raise exception 'image_path outside caller namespace' using errcode = '23514';
  end if;

  insert into public.meal_logs
    (user_id, image_path, dish_name, confidence, quality_score, quality_factors, assumptions, note,
     total_calories, total_protein, total_carbs, total_fat, total_sugar, total_fiber, total_sodium,
     verified)
  values
    (v_uid, v_path, p_log->>'dish_name', p_log->>'confidence',
     (p_log->>'quality_score')::int,                                 -- nullable
     case when p_log ? 'quality_factors'
          then array(select pg_catalog.jsonb_array_elements_text(p_log->'quality_factors')) end,
     case when p_log ? 'assumptions'
          then array(select pg_catalog.jsonb_array_elements_text(p_log->'assumptions')) end,
     p_log->>'note',                                                 -- nullable (bounded by check)
     (p_log->>'total_calories')::numeric, (p_log->>'total_protein')::numeric,
     (p_log->>'total_carbs')::numeric, (p_log->>'total_fat')::numeric,
     (p_log->>'total_sugar')::numeric, (p_log->>'total_fiber')::numeric,
     (p_log->>'total_sodium')::numeric, true)
  on conflict (image_path) do nothing
  returning id into v_log_id;

  if v_log_id is null then
    select id into v_log_id
    from public.meal_logs
    where image_path = v_path and user_id = v_uid;
    return v_log_id;
  end if;

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

revoke all on function public.create_meal_log(jsonb, jsonb) from public;
revoke all on function public.create_meal_log(jsonb, jsonb) from anon;
grant execute on function public.create_meal_log(jsonb, jsonb) to authenticated;

-- --- update_meal_log: add `note` to the allowlisted parent UPDATE ------------
-- (Full body re-declared; ONLY the note assignment is new vs.
-- 20260624150000_update_meal_log.sql.)
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
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if pg_catalog.jsonb_array_length(p_items) not between 1 and 50 then
    raise exception 'item count out of range' using errcode = '23514';
  end if;

  update public.meal_logs set
    dish_name       = p_log->>'dish_name',
    confidence      = p_log->>'confidence',
    quality_score   = (p_log->>'quality_score')::int,                 -- nullable
    quality_factors = case when p_log ? 'quality_factors'
         then array(select pg_catalog.jsonb_array_elements_text(p_log->'quality_factors')) end,
    assumptions     = case when p_log ? 'assumptions'
         then array(select pg_catalog.jsonb_array_elements_text(p_log->'assumptions')) end,
    note            = p_log->>'note',                                 -- nullable (bounded by check)
    total_calories  = (p_log->>'total_calories')::numeric,
    total_protein   = (p_log->>'total_protein')::numeric,
    total_carbs     = (p_log->>'total_carbs')::numeric,
    total_fat       = (p_log->>'total_fat')::numeric,
    total_sugar     = (p_log->>'total_sugar')::numeric,
    total_fiber     = (p_log->>'total_fiber')::numeric,
    total_sodium    = (p_log->>'total_sodium')::numeric
  where id = p_id and user_id = v_uid;

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'meal not found' using errcode = 'P0002';
  end if;

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

revoke all on function public.update_meal_log(uuid, jsonb, jsonb) from public;
revoke all on function public.update_meal_log(uuid, jsonb, jsonb) from anon;
grant execute on function public.update_meal_log(uuid, jsonb, jsonb) to authenticated;
