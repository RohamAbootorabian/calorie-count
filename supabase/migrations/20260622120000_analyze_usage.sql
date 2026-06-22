-- ============================================================================
-- Calorie Counter — analyze_usage daily cost cap (plan 0008, B6)
--
-- `verify_jwt` stops anonymous abuse but NOT an authenticated user (or an
-- automated account) looping `analyze-meal` — each call is a real paid Gemini
-- vision charge and Supabase has no default per-invocation rate limit. This is a
-- crude per-user/day counter, incremented atomically by a SECURITY DEFINER rpc
-- so the count can't be tampered with from the client. Past N/day the function
-- returns a typed `rate_limited`. (A sophisticated quota system is a follow-up.)
-- ============================================================================

create table if not exists public.analyze_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day     date not null default current_date,
  count   integer not null default 0 check (count >= 0),
  primary key (user_id, day)
);

-- Owner-only RLS. No user-facing write policies: the ONLY writer is the
-- SECURITY DEFINER rpc below, which runs as the function owner and bypasses RLS.
-- A user may read their own usage (e.g. to show "N analyses left today").
alter table public.analyze_usage enable row level security;

drop policy if exists analyze_usage_select on public.analyze_usage;
create policy analyze_usage_select on public.analyze_usage
  for select using (auth.uid() = user_id);

-- Atomically bump today's counter for the calling user and return the new count,
-- but ONLY while still under p_limit. The conditional ON CONFLICT means once the
-- cap is reached the row is NOT updated and RETURNING yields no row → NULL, which
-- the Edge Function reads as "already at/over the cap" → `rate_limited` (so the
-- count never grows unbounded past the limit). The first call of the day always
-- inserts count = 1. Exactly p_limit calls per user per day are allowed.
--
-- SECURITY DEFINER + pinned empty search_path (all objects schema-qualified) so
-- the count is server-authoritative and tamper-proof; uses auth.uid() (never a
-- client-supplied user id).
create or replace function public.bump_analyze_usage(p_limit integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  new_count integer;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  insert into public.analyze_usage (user_id, day, count)
  values (uid, current_date, 1)
  on conflict (user_id, day) do update
    set count = public.analyze_usage.count + 1
    where public.analyze_usage.count < p_limit
  returning count into new_count;

  -- NULL → the conflict row existed and was already at/over p_limit (no update).
  return new_count;
end;
$$;

-- Only signed-in users may call it; never anon.
revoke all on function public.bump_analyze_usage(integer) from public;
revoke all on function public.bump_analyze_usage(integer) from anon;
grant execute on function public.bump_analyze_usage(integer) to authenticated;
