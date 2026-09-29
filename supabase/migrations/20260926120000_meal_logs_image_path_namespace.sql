-- ============================================================================
-- Calorie Counter — `meal_logs.image_path` must live in the OWNER's namespace
-- Plan: docs/plans/0042-meal-logs-image-path-namespace.md (closes finding B1
-- from docs/plans/0041-two-user-rls-proof.md, confirmed on prod 2026-09-19)
--
-- WHY: `create_meal_log` rejects a foreign `image_path`, but `meal_logs_insert`
-- / `meal_logs_update` check only `user_id`, so a direct PostgREST write went
-- around that guard: plant a row on ANOTHER user's photo path (their later save
-- then hits `on conflict (image_path) do nothing` → NULL → silent save loss, and
-- the orphan sweep treats their photo as referenced), probe path existence via
-- `23505`, or repoint an own row into a foreign folder.
--
-- WHY A CHECK (not RLS): this is a DATA INVARIANT — it reads only the row's own
-- columns, never `auth.uid()` — so it holds for every writer, including
-- `service_role`, which bypasses RLS but not constraints. Ownership rules stay
-- in RLS. Postgres evaluates RLS WITH CHECK → table CHECK → unique index, so a
-- foreign path now fails with `23514` BEFORE the unique index is reached: the
-- `23505` existence oracle closes with the same statement (also via ON CONFLICT).
--
-- FULL SHAPE, not just the prefix: `split_part(image_path,'/',1) = user_id` would
-- still accept `<uid>/../<victim>/x.jpg` and `<uid>/a/b.jpg`. The app mints signed
-- URLs from whatever this column holds, so a `..` key would reach Storage's HTTP
-- layer. The regex pins exactly ONE segment after the uid — the same shape
-- `analyze-meal` enforces (`^([^/]+)/[^/]+\.(jpg|jpeg|png)$`) and the only shape
-- `upload-meal-photo.ts` produces. A uuid's text form has no regex metacharacters,
-- so interpolating it is safe.
--
-- Verified before applying (prod, 2026-09-26): 9 rows, 0 null `image_path`,
-- 0 violating under both the loose and the strict predicate.
-- ============================================================================

alter table public.meal_logs
  drop constraint if exists meal_logs_image_path_namespace;

alter table public.meal_logs
  add constraint meal_logs_image_path_namespace
  check (image_path is null or image_path ~ ('^' || user_id::text || '/[^/]+$'));
