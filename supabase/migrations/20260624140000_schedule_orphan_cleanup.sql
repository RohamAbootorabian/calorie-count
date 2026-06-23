-- ============================================================================
-- Calorie Counter — schedule the orphan-photo sweep (plan 0011, Layer 2)
--
-- Daily backstop that calls the `cleanup-orphans` Edge Function, which deletes
-- meal photos the client delete-on-abandon (Layer 1) missed. Three parts:
--   1. pg_cron + pg_net (confirmed AVAILABLE on this project before writing this).
--   2. A single-row run-lock / rate-limit (`cleanup_run` + `claim_cleanup_run`),
--      mirroring the `analyze_usage` SECURITY DEFINER pattern — the function
--      claims a run atomically; overlapping/too-frequent calls are denied (SF).
--   3. An idempotent daily `cron.schedule` whose command reads the shared secret
--      as a LIVE Vault subquery (B3) so the literal never lands in
--      `cron.job.command`. The function URL is NOT a secret — inlined here (B4).
--
-- Prereqs (set out of band, documented here):
--   * Edge secret  CLEANUP_SECRET  (>=256-bit) — the function's gate.
--   * Vault secret cleanup_secret  — the SAME value, for the cron subquery below.
--     (create: select vault.create_secret('<value>', 'cleanup_secret');)
--   * Edge secret  CLEANUP_DRY_RUN=true for the first cycle (observe-only, B2),
--     flipped to false only after one real run is confirmed sane.
-- ============================================================================

-- 1. Extensions -------------------------------------------------------------
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 2. Run-lock / rate-limit --------------------------------------------------
-- One row; `claim_cleanup_run` atomically updates it only when the last run is
-- old enough, so two sweeps can't overlap and the public endpoint can't be
-- hammered into repeated full-bucket scans.
create table if not exists public.cleanup_run (
  id           boolean primary key default true check (id),
  last_run_at  timestamptz not null
);

-- Seed the single row with a far-past timestamp so the first claim succeeds.
insert into public.cleanup_run (id, last_run_at)
values (true, 'epoch'::timestamptz)
on conflict (id) do nothing;

-- No client should ever read/write this: RLS on, zero policies. The only writer
-- is the SECURITY DEFINER function below; service_role (the function's role)
-- bypasses RLS regardless.
alter table public.cleanup_run enable row level security;

-- Atomically claim a run: update (and stamp now()) ONLY if the previous run is
-- older than p_min_interval_seconds. RETURNING yields a row only when the update
-- fired → true; otherwise NULL → false (too soon / overlapping). SECURITY
-- DEFINER + pinned empty search_path (all objects schema-qualified).
create or replace function public.claim_cleanup_run(p_min_interval_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed boolean;
begin
  update public.cleanup_run
    set last_run_at = now()
    where id = true
      and last_run_at < now() - make_interval(secs => p_min_interval_seconds)
  returning true into claimed;

  return coalesce(claimed, false);
end;
$$;

-- Only the service role (the Edge Function) may claim a run; never anon/authenticated.
revoke all on function public.claim_cleanup_run(integer) from public;
revoke all on function public.claim_cleanup_run(integer) from anon;
revoke all on function public.claim_cleanup_run(integer) from authenticated;
grant execute on function public.claim_cleanup_run(integer) to service_role;

-- 3. Daily schedule ---------------------------------------------------------
-- Idempotent: drop the existing job (if any) before (re)creating it.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'cleanup-orphans-daily') then
    perform cron.unschedule('cleanup-orphans-daily');
  end if;
end
$$;

-- 03:17 UTC daily (off-peak). The secret is a LIVE subquery (B3): cron.job.command
-- stores only the reference, never the value. The function URL is not a secret.
select cron.schedule(
  'cleanup-orphans-daily',
  '17 3 * * *',
  $cron$
  select net.http_post(
    url := 'https://vldpfoczswakghkrkyrm.supabase.co/functions/v1/cleanup-orphans',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cleanup-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cleanup_secret')
    ),
    body := '{}'::jsonb
  );
  $cron$
);
