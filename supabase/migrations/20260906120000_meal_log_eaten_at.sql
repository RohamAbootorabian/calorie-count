-- ============================================================================
-- Calorie Counter — user-settable meal date `eaten_at` (plan 0028)
--
-- `eaten_at` was `now()`-defaulted and immutable. This makes it owner-settable to a
-- meal's actual date (today or a PAST day) via both RPCs' explicit allowlists:
--   - create: coalesce((p_log->>'eaten_at')::timestamptz, now())  (omitted → now())
--   - update: coalesce((p_log->>'eaten_at')::timestamptz, eaten_at) (omitted → keep)
-- Both add a LOOSE server guard: reject a far-future (> now()+1 day) or non-finite
-- value (23514). The STRICT "not after today, in the user's local zone" check is
-- client-side (the RPC gets no tz); the daily/weekly/monthly `<= todayKey` bucket
-- guards are the real safety net for any stray future/edge row. `created_at` stays the
-- immutable audit timestamp. No injection: explicit `->>` + `::timestamptz` cast, not
-- jsonb_populate_record; server still sets user_id/verified/image_path.
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
  v_eaten  timestamptz := (p_log->>'eaten_at')::timestamptz; -- NULL when omitted.
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

  -- Loose date guard (value-free message): far-future or non-finite is invalid.
  if v_eaten is not null and (v_eaten > now() + interval '1 day'
       or v_eaten in ('infinity'::timestamptz, '-infinity'::timestamptz)) then
    raise exception 'eaten_at out of range' using errcode = '23514';
  end if;

  insert into public.meal_logs
    (user_id, image_path, dish_name, confidence, quality_score, quality_factors, assumptions, note,
     eaten_at,
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
     coalesce(v_eaten, now()),                                       -- omitted → now() (plan 0028)
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

-- --- update_meal_log: eaten_at now owner-settable (was NEVER touched) ----------
create or replace function public.update_meal_log(p_id uuid, p_log jsonb, p_items jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
volatile
as $$
declare
  v_uid   uuid := auth.uid();
  v_eaten timestamptz := (p_log->>'eaten_at')::timestamptz; -- NULL when omitted → keep existing.
  v_rows  integer;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if pg_catalog.jsonb_array_length(p_items) not between 1 and 50 then
    raise exception 'item count out of range' using errcode = '23514';
  end if;

  if v_eaten is not null and (v_eaten > now() + interval '1 day'
       or v_eaten in ('infinity'::timestamptz, '-infinity'::timestamptz)) then
    raise exception 'eaten_at out of range' using errcode = '23514';
  end if;

  -- Parent UPDATE: allowlisted columns only; scoped to the caller's own row.
  -- `eaten_at` is now owner-settable (plan 0028; omitted → keep). `updated_at` is the
  -- trigger's; `user_id`/`image_path`/`created_at`/`verified` remain immutable here.
  update public.meal_logs set
    dish_name       = p_log->>'dish_name',
    confidence      = p_log->>'confidence',
    quality_score   = (p_log->>'quality_score')::int,                 -- nullable
    quality_factors = case when p_log ? 'quality_factors'
         then array(select pg_catalog.jsonb_array_elements_text(p_log->'quality_factors')) end,
    assumptions     = case when p_log ? 'assumptions'
         then array(select pg_catalog.jsonb_array_elements_text(p_log->'assumptions')) end,
    note            = p_log->>'note',                                 -- nullable (bounded by check)
    eaten_at        = coalesce(v_eaten, eaten_at),                    -- owner-settable (plan 0028)
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
