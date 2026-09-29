# Plan: Close the `meal_logs.image_path` namespace hole (B1)

- **Status**: ~~Draft~~ → ~~In Review~~ → ~~Approved~~ → ~~In Progress~~ → **Done** (prod green; phone smoke test pending)
- **Created**: 2026-09-26
- **Plan #**: 0042

## Problem / Goal
Plan 0041's harness proved on prod that a signed-in user can write a `meal_logs` row pointing at
**another user's** photo namespace. `create_meal_log` rejects that
(`20260906120000_meal_log_eaten_at.sql:37-39`), but the table policies check only `user_id`
(`20260619102510_initial_schema.sql:174-178`), and nothing revokes direct table INSERT/UPDATE. So
PostgREST accepts it.

Confirmed FAILs from the 2026-09-19 run (everything else passed):
```
meal_logs.B1-insert-own-row-fresh-victim-path     [no error; victim state CHANGED]
meal_logs.B1-insert-own-row-existing-victim-path  [leak 23505]
meal_logs.B1-patch-own-image_path-to-victim       [no error; victim state CHANGED]
```

**Impact** (no cross-user *read* is possible):
1. **Silent save loss.** A planted row claims the victim's `image_path`, which is `unique`
   (`initial_schema.sql:38`). The victim's later `create_meal_log` hits
   `on conflict (image_path) do nothing`, and the fallback `select … where user_id = v_uid` finds
   nothing, so the RPC returns NULL and the meal is never saved.
2. **Existence oracle.** A `23505` on an existing path tells the attacker that path exists.
3. **Sweep bypass.** `cleanup-orphans` treats a referenced path as "saved", so the victim's orphaned
   photo is never swept.

Paths are random UUIDs, so an attacker can't *guess* a victim path; the practical risk is low. But
it is a real cross-user write, and it bypasses a guard the code claims to enforce.

**Done =** `scripts/check-rls.ts` reports **68 PASS / 0 FAIL / 0 INVALID** on prod (the three B1
cases flip to PASS, the other 64 stay PASS), and the app's normal save/edit flows still work.

## Non-goals
- No app (`src/`) change and no Edge Function change.
- No change to `create_meal_log` / `update_meal_log` logic. **Their guard is load-bearing, not just
  a nicer error:** `check-rls.ts` asserts the RPC's message `image_path outside caller namespace`,
  so removing it would turn that case INVALID. Don't "clean it up" later.
- Not removing the `image_path` unique index (it makes the RPC's lost-ack retry idempotent, 0009 B3).
- **No column-level GRANT surgery.** `revoke insert(image_path) … from authenticated` would break
  every photo save, because `create_meal_log` is SECURITY **INVOKER** and inserts `image_path` as the
  caller. Revoking only `update(image_path)`/`update(user_id)` would work but closes just the PATCH
  half — strictly weaker than the constraint.
- **Knowingly left open (own-data only, no cross-user effect), to be named so a green run isn't
  misread:** direct PostgREST writes still bypass the RPCs' *self-inflicted* guards — the 1–50 item
  count, the far-future/`infinity` `eaten_at` guard, `verified = true`, and a parent row with zero
  items. The `eaten_at` one has the same shape as B1 and the same CHECK remedy; worth a follow-up.
- **Also out of scope:** unbounded `meal_items` / storage writes are a shared-resource availability
  risk (`analyze_usage` caps only paid AI calls). Recorded as residual, not fixed here.
- No backfill or deletion of existing rows.

## Proposed approach
**A table CHECK constraint.** The rule is a **data invariant**, not an authorization decision: it
references only the row's own columns (`image_path`, `user_id`), never `auth.uid()`, so it is true of
a well-formed row no matter who writes it. That is what CHECK is for, and it sits naturally beside
the value CHECKs already on `meal_logs`. Ownership rules stay in RLS.

```sql
alter table public.meal_logs drop constraint if exists meal_logs_image_path_namespace;
alter table public.meal_logs
  add constraint meal_logs_image_path_namespace
  check (image_path is null or image_path ~ ('^' || user_id::text || '/[^/]+$'));
```

**Full shape, not just the prefix (review B1).** `split_part(image_path,'/',1) = user_id::text`
would still accept `<own uid>/../<victim uid>/x.jpg` and `<own uid>/a/b.jpg`. The app mints a signed
URL from whatever the row holds, so a `..` key reaches the Storage HTTP layer — where path
normalization is a plausible cross-namespace read. The regex pins **exactly one** segment after the
uid, matching what `analyze-meal` already enforces (`index.ts:206-208`) and what every real upload
produces (`upload-meal-photo.ts:94`). A uuid's text form has no regex metacharacters, so
interpolating it is safe; `~` and the cast are resolved to OIDs at creation, so no `search_path`
shadowing applies.

**Considered and rejected — adding the condition to the RLS `WITH CHECK`s.** It matches the house
idiom and would need no `check-rls.ts` edit (still `42501`). Rejected because it binds only
RLS-subject roles and duplicates the rule across two policies, while the invariant belongs to the
row itself.

**Evaluation order (why the codes come out as they do).** Postgres runs BEFORE triggers → RLS
`WITH CHECK` → table CHECK → unique index. Therefore:
- The three B1 rows satisfy RLS by construction (`user_id = auth.uid()`), so only the CHECK can
  fail → `23514`, **before** the unique index is reached, which is what closes the `23505` oracle —
  including via `ON CONFLICT`.
- `meal_logs.reparent-own-to-victim` now violates **both** RLS and the CHECK; its code is whichever
  Postgres reaches first, so the harness must accept either (see below).

**Hardening in a second migration file** (same push, so it can be rolled back separately):

```sql
revoke all on function public.handle_new_user() from public;
revoke all on function public.handle_new_user() from anon;
revoke all on function public.handle_new_user() from authenticated;
-- …and the same three for public.set_updated_at()
```

Revoking from `PUBLIC` alone is not enough: Supabase's defaults grant EXECUTE to `anon`/
`authenticated` directly, which is why plan 0041's inventory saw them as executable. **Why it is
safe:** EXECUTE on a trigger function is checked at `CREATE TRIGGER` time, not at fire time.
(`set_updated_at` is SECURITY INVOKER, so the earlier "runs as the table owner" reasoning was
wrong.) `service_role` keeps nothing it needs; nothing calls these over RPC.

## Files to change
- `supabase/migrations/<ts>_meal_logs_image_path_namespace.sql` — **new.** The constraint, with a
  `drop constraint if exists` first (house idiom) and comments naming plan 0042 / finding B1.
- `supabase/migrations/<ts>_revoke_trigger_function_execute.sql` — **new.** The six revokes, one
  statement per grantee.
- `scripts/check-rls.ts`:
  - the three `meal_logs.B1-*` cases expect `23514` **pinned to the constraint name** via
    `{ msg: 'meal_logs_image_path_namespace' }`, with `leakCodes: ['23505']` on all three (after the
    fix, any `23505` means the unique index is being reached again);
  - **new case** `meal_logs.B1-upsert-onconflict-victim-path` — `upsert(logRow(attacker().id, B.path),
    { onConflict: 'image_path' })`, expecting the same, with `leakCodes: ['23505','42501']`;
  - `meal_logs.reparent-own-to-victim` accepts **either** `42501` or `23514` (`code()`'s `want`
    widens to `string | string[]`);
  - **new positive control** `control auto-profile`: right after `createTestUser`, assert
    `profiles` already has exactly 1 row for the new uid **before** any seed upsert — today's
    `upsert` masks a broken signup trigger, which is the only thing the revokes could plausibly
    break;
  - `rpc.handle_new_user` / `rpc.set_updated_at` tighten from `anyError` to `PGRST202`, so the run
    proves they stay unexposed after the grant change.
- `docs/plans/0042-…`, `docs/JOURNAL.md`, `docs/sessions/HANDOFF.md`, and **0041's execution log +
  Status line** (its "must turn PASS after 0042" pointer and its now-stale grant inventory).

No `src/` change, so no app rebuild.

## Data model / schema impact
- One CHECK constraint on `public.meal_logs`; six EXECUTE revokes on two trigger functions.
- `ADD CONSTRAINT` takes ACCESS EXCLUSIVE and full-scans the table. At 9 rows this is instant; a save
  in flight would see a brief lock wait.
- **Existing rows must satisfy it.** Pre-check run on prod 2026-09-26, **with the strict regex**:
  9 rows, 4 distinct owners, 0 rows with a null `image_path`, **0 violating** under the loose prefix
  rule, **0 violating** under the strict shape rule, and 0 non-standard object keys in the bucket.
  Re-run immediately before `db push` (a real save could land in between).
- **Security conclusion:** 0 violations + unguessable random-UUID paths ⇒ no evidence of
  exploitation ⇒ no user notification needed. Honest limit: deleted rows leave no audit trail, so no
  historical proof is possible; the residual is accepted on the unguessability argument.

## Edge cases & failure modes
- **A legacy violating row** → `ALTER TABLE` fails with `23514`, nothing half-applies. **Resolved
  policy (was Open question 2): stop and re-plan.** `NOT VALID` is *not* benign — a NOT VALID CHECK
  is still enforced on UPDATE, so the owner of a violating row would get a permanent save error, and
  both the claimed-path and sweep-bypass impacts would stay alive. Remediation if one is ever found:
  a service-role `delete` of the planted row frees the victim's path.
- **`db push` applying more than intended:** `supabase migration list` must show **only** the two new
  files as pending. Otherwise stop (repair history first); never `--include-all`.
- **The `create_meal_log` NULL-return branch stays reachable** — not via B1 any more, but under a
  concurrent same-path race (READ COMMITTED: the conflicting row may be invisible to the fallback
  SELECT). Symptom: `save-meal.ts` maps `data:null` to `kind:'unknown'` → a retryable
  "Something went wrong", and the photo is already marked do-not-delete. **Accepted residual**, named
  here so it isn't re-diagnosed as B1 later. (The constraint does restore 0009 B3 idempotency for the
  normal case: the fallback's `user_id = v_uid` filter can no longer exclude anything.)
- **Path with no `/`, nested paths, `..` segments:** all rejected by the shape regex.
- **Uppercase uid in a path:** `user_id::text` is lowercase and every reader compares against
  `auth.uid()::text`, so such a row could never have been used anyway; now it is rejected outright.
- **Deleted users:** `user_id` is `not null` with `on delete cascade`, so there are no orphan rows.
- **Harness behaviour change:** the B1 cases now leave the victim snapshot unchanged, so `resetData()`
  no longer runs after them. Nothing later depends on that reseed (each case reads live handles).
- **`--self-test` stays valid:** with `attacker() === B` all B1 payloads land in B's own namespace,
  satisfy the constraint, and still register as detected.
- **Rollback:** `alter table public.meal_logs drop constraint meal_logs_image_path_namespace;` and,
  separately, `grant execute on function public.handle_new_user() to public;` (+ `anon`,
  `authenticated`, and the same for `set_updated_at()`) — restoring PUBLIC alone would not restore
  the prior state.

## Test / verify plan
1. **Re-run the violating-row pre-check** (strict regex) immediately before pushing; must be 0.
2. `npx supabase db push`; `supabase migration list` shows only the two new files pending
   beforehand, and local == remote afterwards.
3. **SQL verification** (Management API, read-only):
   - the constraint exists on `meal_logs` and is `convalidated`;
   - `has_function_privilege('anon', 'public.handle_new_user()', 'EXECUTE')` is false, and likewise
     for `authenticated` and for `set_updated_at()` — ACL inspection alone would be misleading,
     since the grant arrives via PUBLIC.
4. **Rerun the 0041 harness** (after the script edits): expect **68 PASS / 0 FAIL / 0 INVALID**,
   exit 0, clean teardown, and the `control auto-profile` control passing (which proves the signup
   trigger still fires after the revokes).
5. **Rerun with `--self-test`:** expect 49/49 detected ("harness OK").
6. `npx tsc --noEmit` + `npx expo lint`.
7. **App smoke test (user, on the phone):** analyze and save a photo meal; edit it from History;
   change something on Profile **and** on Goals (those tables carry `set_updated_at`, which the
   harness never fires as `authenticated`); and **sign up a brand-new account** to exercise
   `handle_new_user` end to end.
8. Record aggregate results only in the Execution log — no prod uuids or object paths.

## Rollout
1. Pre-check → 2. write both migrations → 3. `migration list` → `db push` → 4. SQL verification →
5. script edits, then harness rerun + `--self-test` → 6. tsc/lint → 7. user smoke test →
8. JOURNAL + HANDOFF + 0041 pointer → commit and push.

No secrets, no function deploy, no app rebuild.

## Open questions — RESOLVED in review
1. **Trigger-function revokes here or separately?** → Here, but in **their own migration file**, so
   they can be rolled back independently of the constraint.
2. **If the pre-check finds violating rows?** → **Stop and re-plan** (see Edge cases). A violating
   row would mean someone used the hole, which deserves its own investigation.

---

## Review
Four-agent review (2026-09-26): correctness, architecture, edge cases, privacy. Consolidated and
deduped; every resolution is folded into the body above.
**Verdict: NEEDS CHANGES (3 blockers) → all resolved in body → APPROVED.**

### BLOCKER (resolved)
- **B1: `split_part(…,'/',1)` pins only the first segment** *(edge; correctness raised it as a nit)*.
  It still accepts `<own uid>/../<victim uid>/x.jpg` and `<own uid>/a/b.jpg`. The app mints a signed
  URL from the stored path, so a `..` key reaches Storage's HTTP layer, where normalization is a
  plausible cross-namespace read. → **Resolved:** the constraint is a full-shape regex
  `^<user_id>/[^/]+$`, matching `analyze-meal`'s own path gate. The prod pre-check was re-run with
  the strict predicate: still 0 violating rows, and 0 non-standard object keys.
- **B2: `meal_logs.reparent-own-to-victim` breaks the rerun** *(correctness)*. That case updates
  `user_id = B.id` on a row whose `image_path` is in A's namespace, so it now violates the CHECK as
  well as RLS. It expects exactly `42501`, so if Postgres reports the constraint first the case goes
  **INVALID** and "67 PASS" is unreachable. → **Resolved:** `code()`'s `want` widens to
  `string | string[]`; that case accepts `['42501','23514']`, with the evaluation order documented.
- **B3: nothing would notice if the revokes broke signup** *(edge, correctness)*. `handle_new_user`
  swallows body errors, and the harness's `seedUser` **upserts** the profile, which masks a missing
  auto-created row; the phone smoke test used an existing account. → **Resolved:** a new
  `control auto-profile` asserts the profile exists *before* any seed upsert, plus a real signup in
  the smoke test. (Substantively the revoke is inert — EXECUTE is checked at `CREATE TRIGGER` time —
  but the plan now proves it.)

### SHOULD-FIX (resolved)
- **`23514` alone is a vacuous assertion** *(correctness, edge, privacy)* — `meal_logs` has ~10 other
  value CHECKs, so a future `logRow` drift would false-PASS. → Pin `{ msg:
  'meal_logs_image_path_namespace' }` on all three B1 cases; `leakCodes: ['23505']` on all three.
- **The upsert surface is untested** *(correctness, privacy)* — `Prefer: resolution=merge-duplicates`
  on `on_conflict=image_path` is the natural next probe and is a *different* oracle today. → New
  case; Done becomes **68 PASS**.
- **`--self-test` missing from verify** *(correctness, privacy)* — it was 0041's anti-vacuity gate and
  costs nothing. → Added, expect 49/49.
- **Wrong justification for the revokes** *(architecture)* — `set_updated_at` is SECURITY INVOKER, so
  "runs as the table owner" was wrong; and revoking from PUBLIC alone is insufficient because
  Supabase grants `anon`/`authenticated` directly *(correctness)*. → Both corrected; the real reason
  (ACL checked at `CREATE TRIGGER`) is stated.
- **Revokes belong in their own migration file** *(architecture)* — the plan's own rollback wants them
  droppable separately. → Two files, one push.
- **Weak "why a constraint" argument** *(architecture)* — "covers service_role" is future-tense (no
  service-role writer exists) and "one rule instead of two" is thin. → Rewritten as invariant vs.
  permission, with the RLS variant recorded as considered-and-rejected.
- **`NOT VALID` fallback is not benign** *(edge)* — still enforced on UPDATE, so a legacy row's owner
  would be permanently unable to save, and both impacts would stay alive. → Open question 2 resolved
  as stop-and-re-plan, with the remediation recipe recorded.
- **`db push` scope not actually guarded** *(edge)* — → `migration list` must show only the two new
  files pending; never `--include-all`.
- **Verification of the revokes must use `has_function_privilege`** *(edge)* — an ACL/`proacl` check
  would read as "already revoked" because the grant comes via PUBLIC. → Specified, plus the exact
  rollback grants.
- **`rpc.handle_new_user` / `set_updated_at` use the weakest assertion** (`anyError`) *(privacy)* → 
  tightened to `PGRST202`.
- **The "manual meals have a null `image_path`" claim is wrong** *(privacy)* — no create path produces
  NULL (the create path passes `uploadedPath ?? ''`), which the pre-check confirms (0 null rows). →
  Claim corrected and the impossible smoke-test step replaced.
- **`create_meal_log`'s NULL-return branch stays reachable** under a concurrent same-path race
  *(edge)* → recorded as accepted residual with its user-visible symptom.
- **Name the surviving same-family siblings** *(correctness, privacy)* — own-data RPC-guard bypasses
  (`eaten_at`, item count, `verified`) and unbounded `meal_items`/storage writes as an availability
  risk → added to Non-goals so a green run isn't over-read.
- **Keep the RPC guard deliberately** *(architecture)* — the harness asserts its message, so removing
  it would turn that case INVALID → recorded in Non-goals.
- **Re-run the pre-check in the same session as the push** *(privacy)* → added as verify step 1.
- **`drop constraint if exists` missing from the snippet** *(architecture, edge)* → added.
- **Update 0041's execution log + Status, and HANDOFF, when this lands** *(privacy)* → in Files to
  change.

### NIT (addressed)
- Schema-qualification: `~` and the cast resolve to OIDs at creation, so no `search_path` shadow
  applies; noted rather than switching to `pg_catalog.split_part` (the regex replaces `split_part`
  entirely) *(privacy)*.
- `ADD CONSTRAINT` takes ACCESS EXCLUSIVE — instant at 9 rows, brief lock wait for an in-flight save
  *(edge)*.
- Fewer `resetData()` calls after the fix; nothing later depends on them *(edge)*.
- The `foreignInB` snapshot probe would miss a path of exactly `<B.id>`; moot once the constraint
  exists *(privacy)*.
- The conflict fallback's `user_id = v_uid` filter becomes unfilterable — keep it as belt-and-braces
  *(correctness)*.
- Paste only aggregates into the execution log, never prod uuids or object paths *(privacy)*.
- **Confirmed by review:** the constraint makes the global `unique(image_path)` index effectively
  per-uid, which is why one statement kills all three impacts; `23514` surfaces through PostgREST as
  `error.code`; its `DETAIL` describes only the attacker's own tuple, and `errInfo` never prints
  `details`; no legitimate flow writes `meal_logs` outside the two RPCs and a delete;
  `cleanup-orphans` only reads; no storage path squatting is possible; the privacy policy needs no
  change (B1 was write-only); harness teardown is well guarded.

## Execution log
**2026-09-26 implemented + applied to prod. Harness green; phone smoke test still pending.**

**What was built (per the approved plan)**
- `supabase/migrations/20260926120000_meal_logs_image_path_namespace.sql` — the CHECK constraint
  with the **full-shape** regex `^<user_id>/[^/]+$` (blocker B1), preceded by
  `drop constraint if exists`, and a comment block explaining invariant-vs-permission, the
  evaluation order, and why the prefix form was not enough.
- `supabase/migrations/20260926120100_revoke_trigger_function_execute.sql` — six revokes (PUBLIC,
  anon, authenticated × 2 functions), in their own file so they can be rolled back separately.
- `scripts/check-rls.ts`:
  - `code()`'s `want` widened to `string | string[]`;
  - the three B1 cases → `23514` pinned to `{ msg: 'meal_logs_image_path_namespace' }` with
    `leakCodes: ['23505']`;
  - new `meal_logs.B1-upsert-onconflict-victim-path` (ON CONFLICT probe);
  - `meal_logs.reparent-own-to-victim` accepts `['42501','23514']`;
  - `rpc.handle_new_user` / `rpc.set_updated_at` tightened to `PGRST202`;
  - **`control auto-profile`** inside `createTestUser`: the signup trigger's row must exist
    *before* any seed upsert (the only check that can see the revokes breaking signup).

**Deviations:** none of substance. The auto-profile control lives inside `createTestUser` rather
than in `positiveControls()`, because it has to run before `resetData()` seeds anything.

**Verification (all on prod)**
- Pre-check re-run immediately before the push: 9 rows, 0 null `image_path`, **0 violating** under
  both the loose and the strict predicate, 0 non-standard object keys.
- `migration list`: the two new files were the only pending entries; `db push` applied both.
- SQL verification: `meal_logs_image_path_namespace` present and `convalidated = true`;
  `has_function_privilege` is **false** for anon and authenticated on both trigger functions; 4
  non-internal triggers still attached; 0 rows violating the constraint.
- **Harness rerun: 68 cases — PASS 68, FAIL 0, INVALID 0**, exit 0, clean teardown, positive
  controls ok (including `control auto-profile`, so the signup trigger still fires after the
  revokes).
- **`--self-test`: 49 cases — 49/49 detected, harness OK**, clean teardown. (The first attempt died
  on a network drop and left 2 test users; `--sweep` removed them, as designed.)
- `npx tsc --noEmit` 0; `npx expo lint` 0.
- **Still pending: the phone smoke test** (verify step 7) — save a photo meal, edit it from History,
  change something on Profile and on Goals, and sign up a brand-new account.

**Result:** B1 is closed. The `23505` existence oracle, the path pre-claim (silent save loss) and
the sweep bypass all die with the one constraint, and plan 0001's proof now runs fully green.
