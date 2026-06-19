-- ============================================================================
-- Calorie Counter — initial schema, triggers, RLS, and storage policies
-- Plan: docs/plans/0001-database-schema-rls.md
--
-- NaN note: for Postgres `numeric`, NaN = NaN is TRUE and NaN > all non-NaN, so
-- `>= 0` alone accepts NaN. A bounded range (`<= MAX`) rejects NaN *and* caps
-- absurd values, so every numeric column uses an explicit upper bound.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- TABLES
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text check (char_length(display_name) <= 80),
  units        text not null default 'metric' check (units in ('metric','imperial')),
  timezone     text not null default 'UTC',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.goals (
  user_id        uuid primary key references auth.users (id) on delete cascade,
  calories       integer not null check (calories between 0 and 20000),
  protein        numeric not null check (protein between 0 and 5000),
  carbs          numeric not null check (carbs   between 0 and 5000),
  fat            numeric not null check (fat     between 0 and 5000),
  weight_goal    text not null check (weight_goal in ('lose','maintain','gain')),
  activity_level text not null check (activity_level in ('sedentary','light','moderate','active','very_active')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists public.meal_logs (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  image_path     text unique,
  eaten_at       timestamptz not null default now(),
  dish_name      text not null check (char_length(dish_name) <= 200),
  confidence     text not null check (confidence in ('low','medium','high')),
  quality_score  integer check (quality_score between 0 and 100),
  quality_factors text[],
  assumptions    text[],
  total_calories numeric not null check (total_calories between 0 and 100000),
  total_protein  numeric not null check (total_protein  between 0 and 10000),
  total_carbs    numeric not null check (total_carbs    between 0 and 10000),
  total_fat      numeric not null check (total_fat      between 0 and 10000),
  total_sugar    numeric not null check (total_sugar    between 0 and 10000),
  total_fiber    numeric not null check (total_fiber    between 0 and 10000),
  total_sodium   numeric not null check (total_sodium   between 0 and 1000000),
  verified       boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists public.meal_items (
  id              uuid primary key default gen_random_uuid(),
  meal_log_id     uuid not null references public.meal_logs (id) on delete cascade,
  position        integer not null default 0,
  name            text not null check (char_length(name) <= 200),
  portion         text check (char_length(portion) <= 200),
  estimated_grams numeric check (estimated_grams between 0 and 100000),
  calories        numeric not null check (calories between 0 and 100000),
  protein         numeric not null check (protein  between 0 and 10000),
  carbs           numeric not null check (carbs    between 0 and 10000),
  fat             numeric not null check (fat      between 0 and 10000),
  sugar           numeric not null check (sugar    between 0 and 10000),
  fiber           numeric not null check (fiber    between 0 and 10000),
  sodium          numeric not null check (sodium   between 0 and 1000000)
);

comment on column public.meal_logs.total_sodium is 'sodium in milligrams (mg)';
comment on column public.meal_items.sodium is 'sodium in milligrams (mg)';

create index if not exists meal_logs_user_eaten_idx on public.meal_logs (user_id, eaten_at desc);
create index if not exists meal_items_meal_log_idx on public.meal_items (meal_log_id);

-- ---------------------------------------------------------------------------
-- TRIGGERS
-- ---------------------------------------------------------------------------

-- updated_at maintenance (SECURITY INVOKER — only touches the row being changed).
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists set_updated_at on public.profiles;
create trigger set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at on public.goals;
create trigger set_updated_at before update on public.goals
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at on public.meal_logs;
create trigger set_updated_at before update on public.meal_logs
  for each row execute function public.set_updated_at();

-- Auto-create a profile on signup. SECURITY DEFINER with a pinned, empty
-- search_path (all objects schema-qualified). Swallows errors so a failed
-- profile insert can never abort the auth.users insert (signup).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
exception when others then
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill profiles for any pre-existing auth users (harmless on greenfield).
insert into public.profiles (id)
select id from auth.users
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- ROW-LEVEL SECURITY (default-deny; per-verb policies with WITH CHECK)
-- ---------------------------------------------------------------------------

alter table public.profiles  enable row level security;
alter table public.goals     enable row level security;
alter table public.meal_logs enable row level security;
alter table public.meal_items enable row level security;

-- profiles (owner = id) -----------------------------------------------------
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select using (auth.uid() = id);
drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles
  for insert with check (auth.uid() = id);
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);
drop policy if exists profiles_delete on public.profiles;
create policy profiles_delete on public.profiles
  for delete using (auth.uid() = id);

-- goals (owner = user_id) ---------------------------------------------------
drop policy if exists goals_select on public.goals;
create policy goals_select on public.goals
  for select using (auth.uid() = user_id);
drop policy if exists goals_insert on public.goals;
create policy goals_insert on public.goals
  for insert with check (auth.uid() = user_id);
drop policy if exists goals_update on public.goals;
create policy goals_update on public.goals
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists goals_delete on public.goals;
create policy goals_delete on public.goals
  for delete using (auth.uid() = user_id);

-- meal_logs (owner = user_id) ----------------------------------------------
drop policy if exists meal_logs_select on public.meal_logs;
create policy meal_logs_select on public.meal_logs
  for select using (auth.uid() = user_id);
drop policy if exists meal_logs_insert on public.meal_logs;
create policy meal_logs_insert on public.meal_logs
  for insert with check (auth.uid() = user_id);
drop policy if exists meal_logs_update on public.meal_logs;
create policy meal_logs_update on public.meal_logs
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists meal_logs_delete on public.meal_logs;
create policy meal_logs_delete on public.meal_logs
  for delete using (auth.uid() = user_id);

-- meal_items (owner via parent meal_logs) ----------------------------------
drop policy if exists meal_items_select on public.meal_items;
create policy meal_items_select on public.meal_items
  for select using (
    exists (select 1 from public.meal_logs ml
            where ml.id = meal_items.meal_log_id and ml.user_id = auth.uid())
  );
drop policy if exists meal_items_insert on public.meal_items;
create policy meal_items_insert on public.meal_items
  for insert with check (
    exists (select 1 from public.meal_logs ml
            where ml.id = meal_items.meal_log_id and ml.user_id = auth.uid())
  );
drop policy if exists meal_items_update on public.meal_items;
create policy meal_items_update on public.meal_items
  for update using (
    exists (select 1 from public.meal_logs ml
            where ml.id = meal_items.meal_log_id and ml.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.meal_logs ml
            where ml.id = meal_items.meal_log_id and ml.user_id = auth.uid())
  );
drop policy if exists meal_items_delete on public.meal_items;
create policy meal_items_delete on public.meal_items
  for delete using (
    exists (select 1 from public.meal_logs ml
            where ml.id = meal_items.meal_log_id and ml.user_id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- STORAGE — private meal-photos bucket + per-verb policies
-- (Created via SQL so it deploys to the linked project with `db push`; a
--  declarative config.toml bucket only applies to local `supabase start`.)
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('meal-photos', 'meal-photos', false, 10485760, array['image/jpeg','image/png'])
on conflict (id) do nothing;

drop policy if exists meal_photos_select on storage.objects;
create policy meal_photos_select on storage.objects
  for select using (
    bucket_id = 'meal-photos' and (storage.foldername(name))[1] = auth.uid()::text
  );
drop policy if exists meal_photos_insert on storage.objects;
create policy meal_photos_insert on storage.objects
  for insert with check (
    bucket_id = 'meal-photos' and (storage.foldername(name))[1] = auth.uid()::text
  );
drop policy if exists meal_photos_update on storage.objects;
create policy meal_photos_update on storage.objects
  for update using (
    bucket_id = 'meal-photos' and (storage.foldername(name))[1] = auth.uid()::text
  ) with check (
    bucket_id = 'meal-photos' and (storage.foldername(name))[1] = auth.uid()::text
  );
drop policy if exists meal_photos_delete on storage.objects;
create policy meal_photos_delete on storage.objects
  for delete using (
    bucket_id = 'meal-photos' and (storage.foldername(name))[1] = auth.uid()::text
  );
