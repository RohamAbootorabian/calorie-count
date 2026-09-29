-- ============================================================================
-- Calorie Counter — drop the default EXECUTE grant on the two trigger functions
-- Plan: docs/plans/0042-meal-logs-image-path-namespace.md (hardening; found by
-- plan 0041's SQL inventory — every OTHER function already has explicit revokes)
--
-- `handle_new_user` (SECURITY DEFINER) and `set_updated_at` (SECURITY INVOKER)
-- are trigger functions that were never revoked, so they kept Supabase's default
-- grants. PostgREST does not expose them (`PGRST202`, proven by plan 0041), but a
-- SECURITY DEFINER function with a standing EXECUTE grant is the kind of thing
-- that becomes a hole later.
--
-- SAFE because a trigger function's EXECUTE privilege is checked at CREATE
-- TRIGGER time, not on each fire — the signup and updated_at triggers keep
-- working. (Verified by plan 0042's `control auto-profile` check + a real signup.)
--
-- Revoking from PUBLIC alone is NOT enough: Supabase's defaults also grant
-- EXECUTE to `anon`/`authenticated` directly. `service_role` is left alone.
-- Rollback = `grant execute on function … to public, anon, authenticated;`
-- ============================================================================

revoke all on function public.handle_new_user() from public;
revoke all on function public.handle_new_user() from anon;
revoke all on function public.handle_new_user() from authenticated;

revoke all on function public.set_updated_at() from public;
revoke all on function public.set_updated_at() from anon;
revoke all on function public.set_updated_at() from authenticated;
