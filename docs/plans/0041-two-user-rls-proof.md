# Plan: Two-user RLS isolation proof (closes plan 0001's deferred test)

- **Status**: ~~Draft~~ → ~~In Review~~ → ~~Approved~~ → ~~In Progress~~ → **Done** (B1 hole confirmed → plan 0042)
- **Created**: 2026-09-19
- **Plan #**: 0041

## Problem / Goal
Plan 0001 shipped owner-only RLS on every table and on the `meal-photos` bucket. It only proved
**default-deny for `anon`**. Its test-plan steps 2–3 (two real users, cross-read/cross-write) were
deferred "until signup works", and no later plan recorded running them (JOURNAL line 71; plan 0009
only said "confirm"). The app now stores special-category health data (allergies/conditions, 0031),
so per-user isolation must be **proven against prod**, not assumed from reading SQL.

**Done =** a re-runnable script, `scripts/check-rls.ts`, that:
1. creates two throwaway users, **A** (attacker) and **B** (victim), on prod,
2. seeds B with one of every kind of owned data,
3. runs every cross-user attack through the **real public APIs** (PostgREST, Storage,
   RPC, Edge Function), exactly as a malicious signed-in client would,
4. checks that every attack is denied **and** that B's data is byte-for-byte unchanged,
5. deletes both users and their objects,
6. exits 0 only if every case passes.

We run it once against prod and record the result in this plan's Execution log.

## Non-goals
- **No schema or RLS changes in this plan.** This plan only *measures*. A found hole is recorded as
  FAIL, the run finishes, and the fix gets its own plan. Plan 0042 is pre-committed for the
  expected `image_path` hole (B1).
- No test framework or CI. We follow the `scripts/check-tdee.ts` precedent: a one-off script with
  no new dependency.
- No local `supabase start` target. The proof has to hit prod: the deployed function code, bucket
  flags and grants only exist there.
- Not testing `service_role` paths such as `cleanup-orphans`, whose gate is a shared secret, not
  RLS.
- No OpenAI calls and no rate-limit testing.
- **Realtime:** no table is in the `supabase_realtime` publication. The inventory check guards that
  this stays true.
- **GraphQL:** `pg_graphql` introspection exposes the schema but not rows. Rows go through the same
  RLS.

## Proposed approach
**Why real HTTP instead of SQL `set role`:** an attacker uses PostgREST, Storage and the Edge
Function. Each of those has its own code path on top of the policies (JWT handling, the Storage
MIME/RLS order, the function's path-prefix check). The proof goes through the same HTTP APIs, and
uses SQL only for the inventory check and for teardown verification.

### Runner and env (S1, S3)
- Run command, used exactly as written:
  `SUPABASE_SERVICE_ROLE_KEY="$(npx --no-install supabase projects api-keys --project-ref vldpfoczswakghkrkyrm -o json | jq -r '.[]|select(.name=="service_role").api_key')" node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --env-file=.env scripts/check-rls.ts [--self-test | --sweep]`
- Node 24 strips the types natively, so no `tsx` download and no new dependency.
  `--env-file` loads the URL and anon key.
- Never run the CLI without the `$(…)` capture, and never `echo`/`env` in that shell.
- The script refuses to run if the key is empty or the literal `null`, and never prints it.
- **Guards before anything else runs (B3):**
  - `EXPO_PUBLIC_SUPABASE_URL` must contain `vldpfoczswakghkrkyrm`.
  - The only `src/` import is `import type { Database }`. Never import `src/lib/supabase.ts`
    (AsyncStorage/RN).
  - No `Buffer`; use `Uint8Array`/`Blob`.

### Clients (S2)
- Four standalone `createClient` instances: `admin` (service role), `A`, `B`, `anon`.
- Each uses `auth:{persistSession:false, autoRefreshToken:false}`.
- `signInWithPassword` is called only on A and B.
- The script ends with `process.exit(code)`.

### Safety and teardown (B3, S4, S9)
- **Run identity:** a `runId` (8 base36 chars). Emails are `rls-a-<runId>@example.com` and
  `rls-b-<runId>@example.com`. Passwords are random base64url with an `Aa1!` suffix.
- **Tracked uids:** created uids go into one array, set **only** from `createUser` results.
- **Startup self-heal:** `admin.listUsers` (paged) finds users matching
  `^rls-[ab]-[0-9a-z]{8}@example\.com$` created more than 1 hour ago. It removes their folders,
  then deletes them.
- **Guarded deletes:**
  - Before any `deleteUser`, re-fetch the user and re-check the email regex.
  - Storage removal only lists and removes under `<uid>/`, where the uid matches `UUID_RE` and
    belongs to a user we just verified. Never the bucket root.
- **Always tear down:** teardown runs in `finally` and from the `SIGINT`/`SIGTERM`/
  `uncaughtException`/`unhandledRejection` handlers. Any teardown failure forces exit 1 and prints
  only the leftover uids. The `cleanup-orphans` 72 h sweep is the backstop for stray objects.
- **Redaction:** one `redact()` helper strips the service key, the anon key and every
  access/refresh token from any string before it is printed. Errors print only
  `name`/`code`/`status`/redacted message. Rows, notes, emails and JWTs are never printed.
- **Never touch real users:**
  - Every write attack is filtered to B's primary key.
  - Unfiltered and anon reads select only the owner column (or a HEAD count) and assert every
    value is the caller's own.
  - The `cleanup_run` attack writes back the row's current `last_run_at`, so even a hole cannot
    pause the prod cron.

### Seed (S10, S11)
- All seeded values are synthetic (`RLS-TEST synthetic`).
- **B:**
  - profile `.update(display_name, has_allergies, allergies_note, has_conditions, conditions_note).eq('id',B).select()`,
    which must return exactly 1 row;
  - a typed `goals` insert;
  - a JPEG upload to `B/<runId>-<uuid>.jpg` with `contentType:'image/jpeg'` (a real 1×1 JPEG);
  - `create_meal_log` with that path and two items;
  - `bump_analyze_usage(50)` once. This is a DB counter only, with no OpenAI call.
- **A:**
  - one JPEG at `A/<runId>-<uuid>.jpg`;
  - one meal via `create_meal_log` (no image);
  - a goals row.
- Any setup or auth error makes the run **INVALID**. Teardown still runs, and sign-in is never
  retried in a loop.

### Positive controls (must pass, or the run is INVALID)
- B reads its own profile, goals, meal_log, items and usage.
- B lists `B/` → 1 object, and downloads it.
- A reads its own meal.
- A uploads the *identical* body and options into `A/`, and it succeeds. This proves storage
  denials are RLS, not MIME.
- A direct-inserts a `meal_logs` row in its *own* namespace and it succeeds, then deletes it. This
  proves the B1 payload shape is valid.

### Verdicts (B2)
- **PASS** = the result matches the case's expected-denial allowlist **and** the service-role
  post-checks show nothing changed.
- **FAIL** = the attack succeeded (a hole).
- **INVALID** = anything else: an unexpected error code, a transport error after 1 retry, or a
  failed re-read. INVALID never counts as PASS.

| Attack kind | Expected denial |
|---|---|
| insert / WITH CHECK (incl. upsert, re-parent) | error code `42501` |
| filtered update / delete | no error, `.select()` returns 0 rows |
| filtered select / HEAD count | 0 rows / count 0 |
| `create_meal_log` with a `B/` path | `23514` + message `image_path outside caller namespace` |
| `update_meal_log` on B's meal | `P0002` |
| `claim_cleanup_run`, `handle_new_user`, `set_updated_at` via RPC | an error (`42501` / not callable); the code is logged |
| storage write / read of B's object | a storage error whose message mentions row-level security, or not-found; the post-check confirms no change |
| `analyze-meal` (path-prefix check) | exactly `{ok:false, kind:'not_found'}`, never `unauthorized` |

### Attack matrix (A → B)
A generic `attackTable` descriptor runs select, HEAD count, update (sentinel values), delete and
insert-as-B on each table. Hand-written cases cover the rest.

| Surface | Cases |
|---|---|
| `profiles` | generic; `upsert` with `id=B` |
| `goals` | generic; `upsert` with `user_id=B`; re-parent A's own row to `user_id=B` |
| `meal_logs` | generic; unfiltered select returns only A's ids; re-parent A's meal to `user_id=B`; **B1:** direct insert with `{user_id:A}` and a fresh `B/` path; direct insert with B's existing path; PATCH A's own meal's `image_path` to a `B/` path |
| `meal_items` | generic (by B's item id); insert into B's log; move A's own item into B's log |
| `analyze_usage` | generic; A updates or deletes its **own** row (no write policies → 0 rows, value unchanged) |
| `cleanup_run` | select → 0 rows; update writing back the same value → 0 rows |
| RPCs | `update_meal_log(B's id)`; `create_meal_log` with a `B/` path; `create_meal_log` with `p_log.user_id=B` (the row ends up owned by A, then deleted); `bump_analyze_usage` → only A's counter moves; `claim_cleanup_run`; `handle_new_user`; `set_updated_at` |
| Storage | `list('')` must not show B's uid; `list('B')`; `download`; `exists`; `info`; `createSignedUrl`; `createSignedUrls`; unauthenticated `GET /object/public/…` and A-JWT `GET /object/authenticated/…`; `upload` a new file into `B/`; `upload` with upsert over B's path; `update` of B's path; `remove` of B's path; `copy`/`move` of B's object into `A/`; `copy`/`move` of A's object into `B/` |
| `analyze-meal` | B's path; `A/../B/x.jpg`; a URL-encoded slash; a non-existent `A/<uuid>.jpg`. All return `not_found` with no usage change |
| `anon` | select `profiles` → 0 rows; `rpc('create_meal_log')` → error |

**Post-checks** (service role, after all attacks):
- B's rows and their `updated_at` equal the snapshot.
- `B/` contains only the seeded object, with identical bytes.
- **B1 check:** no `meal_logs` row with `image_path like '<B>/%'` has `user_id <> B`.
- `cleanup_run.last_run_at` is unchanged.
- `analyze_usage` sums are unchanged apart from A's own bump. We compare with service-role sums,
  never a day computed on the client (S12).

### Self-test (S5)
`--self-test` re-runs the whole matrix with **B as the attacker against itself**. Every read or
write case must come out FAIL ("a hole"), and the run exits 1. This proves each case can detect a
leak.

### Inventory (S8)
A Management-API SQL check in the verify step. Each assertion must hold:
- RLS is on for every `public` table.
- The functions `anon`/`authenticated` can execute are exactly `{create_meal_log, update_meal_log,
  bump_analyze_usage}`, plus the trigger functions, which are shown not to be callable.
- There are no views or materialized views in `public`.
- `meal-photos` is the only bucket, and `public=false`.
- `supabase_realtime` contains no `public` tables.

## Files to change
- `scripts/check-rls.ts` — **new.** The harness above: one file, data-driven, with a header
  comment ("PROD, service_role; run only via the documented command; never put the key in
  `.env`").
- `docs/plans/0041-two-user-rls-proof.md` — execution log with the result table (case names and
  codes only).
- `docs/JOURNAL.md`, `docs/sessions/HANDOFF.md` — record the result and close 0001's deferred
  proof. Open plan 0042 if B1 fails.

No app (`src/`) code, no migration, no Edge Function change.

## Data model / schema impact
None. Each run temporarily creates two `auth.users` (plus their cascaded rows and up to 3 storage
objects) and removes them all. Auth audit logs keep the test emails and the runner's IP, and MAU
goes up by 2. Both are accepted.

## Edge cases & failure modes
- **Vacuous pass** is prevented by positive controls, the per-case expected-denial allowlist,
  service-role post-checks and `--self-test`.
- **MIME before RLS:** every upload uses `image/jpeg` and a real JPEG, and an A→`A/` control
  proves the payload is acceptable.
- **`handle_new_user` swallows errors:** the profile seed requires exactly 1 updated row, and the
  service role confirms both profiles exist.
- **Crash, Ctrl-C or a lost `createUser` ack:** signal handlers run teardown, and the next run's
  startup self-heal removes anything left over after 1 hour.
- **Concurrent runs** never delete each other's users: runIds differ, and the self-heal only
  deletes users older than 1 hour.
- **Prod auth differs from `config.toml`** (captcha, password rules): the run becomes INVALID with
  a clear message, and teardown still runs.
- **A real hole is found:** its FAIL line (codes only) is printed before teardown, the run
  finishes, and the fix goes in a new plan.
- **`analyze_usage` day boundary:** compare sums, not a client-computed day.
- **Zero OpenAI cost:** `analyze-meal` rejects on the path-prefix check (`index.ts:188`), which
  runs before `bump_analyze_usage` (`:207`).

## Test / verify plan
1. `npx tsc --noEmit` and `npx expo lint` are clean.
2. Run `--self-test` against prod. Every attack case must be FAIL and the exit code 1. This proves
   the harness detects leaks.
3. Do the real run. Expected: all PASS, **except** the three B1 cases, which are expected to FAIL.
4. Run the inventory SQL through the Management API, and check that nothing matching
   `rls-%@example.com` remains in `auth.users`.
5. Paste the result table into the Execution log.

## Rollout
1. Write the script; tsc and lint must be clean.
2. Run `--self-test`.
3. Do the real run.
4. Run the inventory and teardown check.
5. Record the result in the JOURNAL, this plan and HANDOFF.
6. Commit and push.
7. If B1 fails, start plan 0042.

No deploys, no secrets set, no migration.

## Open questions — RESOLVED (2026-09-19, user)
1. Keep the script committed and re-runnable → **yes** (regression check after RLS/RPC
   migrations).
2. Test email domain → `@example.com` (RFC 2606 reserved; admin-created users get no email).
3. What happens if a hole is found → **record it as FAIL, finish the run, then fix it in its own
   plan (0042).**

---

## Review
Four-agent review (2026-09-19): correctness, architecture, edge cases, data/privacy. Findings are
consolidated and deduped; the tags show which reviewers raised each one.
**Verdict: NEEDS CHANGES (3 blockers) → all blockers and should-fixes folded into the plan body → APPROVED.**

### BLOCKER
- **B1: The matrix misses a likely real hole, `image_path` namespace bypass via direct table
  writes** *(correctness, edge, privacy)*.
  - `create_meal_log` rejects paths outside `auth.uid()/…` (`20260906120000_meal_log_eaten_at.sql:37-39`).
    But `meal_logs_insert`/`meal_logs_update` only check `user_id` (`initial_schema.sql:174-178`),
    and no migration revokes direct table INSERT/UPDATE.
  - So A can PostgREST-insert `{user_id:A, image_path:'<B>/<x>.jpg'}`, or PATCH its own row's
    `image_path`. That opens three problems:
    - (a) **Pre-claim B's path.** B's later `create_meal_log` hits `on conflict do nothing`, the
      fallback select finds nothing, and B's save returns NULL (silent data loss).
    - (b) **Existence oracle.** A `23505` on an existing path confirms the path exists.
    - (c) **Sweep bypass.** `cleanup-orphans` treats the path as referenced, so B's orphan is
      never swept.
  - The current matrix would report all-PASS while this is open.
  - → **Resolution:** add three cases:
    - direct insert with a fresh `B/` path
    - direct insert with B's existing path
    - PATCH A's own meal to a `B/` path
  - Verification must be a service-role query: any `meal_logs` row with `image_path like '<B>/%'`
    and `user_id <> B`. B's own client can't see A's rows.
  - Expected today: **FAIL**. Decide now that a FAIL is recorded, the run finishes, and a fix
    plan (0042) adds a namespace `WITH CHECK` (or column-level grant) on `meal_logs`.
- **B2: "Any error counts as denied" gives false PASSes** *(correctness, edge)*.
  - **Storage.** supabase-js defaults `contentType` to `text/plain` (`storage-js index.mjs:586-621`),
    and the bucket only allows jpeg/png. So upload and upsert attacks are rejected by the MIME
    check, not RLS. The seed upload fails the same way.
  - **RPCs.** They raise `23514` for a bad item count before the namespace check, so a bad
    payload "passes".
  - **Other false passes:** transport errors, 5xx and PGRST204 would also count as PASS.
  - → **Resolution:** give every case an expected-denial allowlist:

    | Attack | Expected denial |
    |---|---|
    | Insert / WITH CHECK | `42501` |
    | `create_meal_log` on B's path | `23514` + message `image_path outside caller namespace` |
    | `update_meal_log` on B's meal | `P0002` |
    | `claim_cleanup_run` | `42501` |
    | Storage | 400/403 with an RLS message |
    | `analyze-meal` | exactly `{ok:false, kind:'not_found'}` (not `unauthorized`) |
    | Filtered update/delete | 0 affected rows via `.select()` |

  - Anything else, including a network error after 1 retry, is **INVALID**, never PASS.
  - Every upload uses `contentType:'image/jpeg'` and a valid JPEG body. Add an owner control:
    the identical payload or upload by A into `A/` must succeed.
  - RPC attacks reuse the valid seed payload (1–50 valid items).
- **B3: Teardown is unguarded service-role deletion on prod and does not survive a crash or
  Ctrl-C** *(edge, architecture, privacy)*.
  - **Unsafe deletes.** An undefined uid can become `list('')`/`list('undefined')`, and a swapped
    variable can delete a real user. Nothing checks the target project.
  - **Skipped cleanup.** SIGINT skips `finally`, and a lost `createUser` ack leaves an unknown
    user behind.
  - → **Resolution:**
    - (1) Hard-code the project ref `vldpfoczswakghkrkyrm` and refuse to run unless the URL
      matches.
    - (2) Store created uids in one array, set **only** from `createUser` results.
    - (3) Before any `deleteUser`, re-fetch the user and require the email to match
      `^rls-[ab]-<runId>@example\.com$`.
    - (4) Remove storage only under a prefix that is a created uid matching `UUID_RE`. Never
      touch the bucket root.
    - (5) Register `SIGINT`/`SIGTERM`/`uncaughtException`/`unhandledRejection` handlers that run
      teardown, then exit 1.
    - (6) **Self-heal at startup:** delete leftover `rls-[ab]-*@example.com` users older than
      1 hour (and their folders) found via `admin.listUsers`. The age filter keeps concurrent
      runs safe.
    - (7) A teardown failure forces exit 1.
    - (8) The `cleanup-orphans` 72 h sweep is the backstop for stray objects.

### SHOULD-FIX
- **S1: Runner and env.**
  - `.env` is never loaded; Expo inlines it at build time, and tsx/Node don't read it.
  - `tsx` isn't a dependency, so `npx` would download unpinned code into a process holding the
    service-role key.
  - → **Resolution:** run with `node --env-file=.env scripts/check-rls.ts` (Node 24 native type
    stripping; no new dependency).
  - The only `src/` import is `import type { Database }`. Never import `src/lib/supabase.ts`
    (AsyncStorage / RN polyfill).
  - No `Buffer` (TS2591, no `@types/node` in the Expo base). Use `Uint8Array` or `Blob`.
  - *(architecture, correctness, privacy)*
- **S2: Four standalone clients** (admin, A, B, anon), each created with
  `auth:{persistSession:false, autoRefreshToken:false}`. Never call `signIn` on the admin client:
  it would swap in a user JWT and break teardown. End with `process.exit(code)`.
- **S3: Exact key-capture command.** `supabase` isn't on PATH. Use
  `SUPABASE_SERVICE_ROLE_KEY="$(npx supabase projects api-keys --project-ref vldpfoczswakghkrkyrm -o json | jq -r '.[]|select(.name=="service_role").api_key')" node --env-file=.env scripts/check-rls.ts`.
  - Never run the CLI without capturing its output, and never `echo`/`env`.
  - The script rejects an empty or `null` value without printing it.
  - If legacy keys are disabled, use `--reveal` and the `sb_secret_…` key.
- **S4: Enforce redaction.**
  - A top-level catch plus the crash handlers print only `err.name` / `code` / `status`.
  - One `redact()` helper strips the service key, the anon key and all access/refresh tokens.
  - Never log `createUser`, `signIn`, snapshot or row values. A failure prints the case name plus
    which field differed.
- **S5: Replace the "local sanity check" with a built-in self-attack mode** *(correctness,
  architecture)*. There is no local stack, and flipping one assertion only tests the printer.
  - `--self-test` re-runs the whole attack matrix with **B attacking itself**. Every case must
    then report FAIL, and the run exits 1.
  - This proves each case can detect a leak and catches wrong filters or column names.
- **S6: Stronger unchanged-checks.**
  - The snapshot includes `updated_at`. The trigger bumps it even on same-value updates, which
    makes it the most sensitive tamper signal.
  - Attack writes use sentinel values that differ from the seed.
  - A failed re-read is INVALID, not "unchanged".
  - After all writes, a service-role pass asserts:
    - B's row counts are unchanged;
    - `B/` holds only the seeded object;
    - `cleanup_run.last_run_at` is unchanged;
    - `analyze_usage` for A and B changed only where expected.
- **S7: Matrix additions.**
  - **Re-parenting:** A sets its own `meal_logs.user_id` / `goals.user_id` to B → `42501`.
  - **`profiles` upsert** with `id=B` (merge-duplicates path; the health data lives there).
  - **Own-cap tampering:** A updates or deletes its own `analyze_usage` row → 0 rows, with the
    value confirmed unchanged by the service role.
  - **`rpc('handle_new_user')` / `rpc('set_updated_at')`** as A and as anon → error. They keep
    default grants.
  - **HEAD count requests:** `count:'exact', head:true` filtered to B → 0 on every table.
  - **Storage:**
    - `list('')` at the root, which must not reveal B's uid;
    - positive control: B `list('B')` → 1;
    - `update()` (PUT);
    - `exists()`/`info()`;
    - `createSignedUrls([…])` (the batch call the app uses);
    - unauthenticated `GET /object/public/…` and A-JWT `GET /object/authenticated/…`;
    - seed an A object and `copy`/`move` it **into** `B/…`.
  - **`analyze-meal` variants:** `A/../B/x.jpg`, a URL-encoded slash, a non-existent `A/<uuid>.jpg`.
    All must return `not_found`, with A's and B's usage unchanged.
- **S8: SQL inventory guard** (Management API, in the verify step), so the hand-written matrix
  can't silently go stale. Assert:
  - every `public` table has RLS on;
  - functions executable by `anon`/`authenticated` are exactly the known set;
  - there are no views or materialized views in `public`;
  - `meal-photos` is the only bucket and `public=false`;
  - the `supabase_realtime` publication contains no `public` tables.
- **S9: Never touch or pull real users' data.**
  - Every write attack is scoped to B's primary key.
  - Unfiltered and anon reads select only `user_id`/`id` (or HEAD count) and assert every value
    equals the caller. They never `select('*')`, which would pull real users' health notes into
    memory.
  - The `cleanup_run` attack writes the row's current `last_run_at`, so a hole doesn't pause the
    prod cron.
- **S10: Seed correctness.**
  - The profile seed uses `.update(…).eq('id',B).select()` and requires exactly 1 row.
    `handle_new_user` swallows errors, so a missing profile would otherwise be silent.
  - Goals are typed as `Insert`: `user_id`, calories/protein/carbs/fat, `weight_goal`,
    `activity_level`.
  - Seed both health notes. Every seeded value is obviously synthetic (`RLS-TEST synthetic`).
- **S11: Prod auth may differ from `config.toml`** (captcha, password policy).
  - Use a strong random password with an `Aa1!` suffix.
  - Any setup or auth error → INVALID with a clear message, and teardown still runs.
  - No sign-in retry loops.
- **S12: `analyze_usage` uses the DB's UTC `current_date`.** Compare via service-role sums, not a
  client-computed day.

### NIT
- The `analyze-meal` case exercises the **path-prefix check** (`index.ts:187-188`), not storage RLS.
  Label it that way. The zero-cost claim is confirmed: the check runs before `bump_analyze_usage`
  at `:207`.
- **Record evidence before teardown.** Codes only; deleting the users cascades the rows away.
- **Non-goals, stated explicitly:**
  - Realtime: no table is in `supabase_realtime`; the inventory in S8 guards this.
  - GraphQL: introspection exposes the schema but not rows.
- `bump_analyze_usage(p_limit)` takes a client-supplied limit. This is accepted: it is self-only
  and fail-closed, and the Edge Function always passes `DAILY_CAP`. Optional case: A calls
  `bump(1000000)` → B unchanged.
- Keep it one file but **data-driven**: a generic `attackTable(desc)` for the four CRUD verbs, with
  hand-written cases only for re-parenting, RPCs and storage. Trim `anon` to one table and one RPC.
- Put a header comment in the script: "PROD, service_role; run only via the documented command;
  never put the key in `.env`." Add `runId` to object names.
- Supabase auth audit logs keep the test emails and the runner's IP after deletion, and MAU goes
  up by 2. Both are acceptable.
- **Confirmed correct by review:**
  - RLS-filtered update/delete returns no error and 0 rows.
  - An insert WITH CHECK failure returns `42501`, including on upsert.
  - `update_meal_log` returns `P0002` before touching any child row.
  - `p_log.user_id` is ignored.
  - `claim_cleanup_run` is revoked from `authenticated`.
  - Storage `remove` returns `[]` for objects the caller can't see.
  - `email_confirm:true` sends no email.
  - `handle_new_user` fires on `admin.createUser`.

## Execution log
**2026-09-19 — Executed against prod. Isolation holds everywhere except the predicted B1 hole.**

**Deviations from the plan (and why)**
- **Seed through the service role, not B's own client.** A single `resetData()` wipes and re-seeds
  both users after any case that changed the victim's state, so one hole cannot cascade into later
  cases. Owner visibility is still proven through the users' own JWT clients (positive controls).
- **Per-case snapshot + reset.** A service-role snapshot is taken before and after every case. A
  diff counts as FAIL and triggers a reset, so each verdict is attributable to one case.
- **`--sweep` + retrying fetch.** The first real run hit a TLS drop (`ECONNRESET`) mid-run. The
  snapshot threw, so the run was correctly INVALID, but teardown also lost the network and left the
  2 test users (synthetic data only) on prod. Two fixes followed:
  - a `--sweep` mode (the same guarded purge, any age); it removed both users;
  - a fetch wrapper that retries connection-level failures (3 tries).

  supabase-js's own `console.error` output is now routed through `redact()`.
- **Seed items:** `.order('position')` on an insert-returning select gave `42703`. It now selects
  `id, position` and picks position 0.
- **Run command** adds `--disable-warning=MODULE_TYPELESS_PACKAGE_JSON`, because `package.json`
  has no `"type"` and Node re-parses the file as ESM. The warning is cosmetic.

**Verification**
- tsc 0, `expo lint` 0.
- **`--self-test`: 48/48 self-testable cases FAIL** (B attacking itself is detected on every case).
  The harness can see a leak on every surface it tests.
- **Real run (A → B): 67 cases. PASS 64, FAIL 3, INVALID 0.** Teardown removed both users. The
  three FAILs are exactly B1:
  ```
  FAIL  meal_logs.B1-insert-own-row-fresh-victim-path     [no error; victim state CHANGED]
  FAIL  meal_logs.B1-insert-own-row-existing-victim-path  [leak 23505]
  FAIL  meal_logs.B1-patch-own-image_path-to-victim       [no error; victim state CHANGED]
  ```
  Everything else is denied with the expected code:
  - profiles, goals, meal_logs, meal_items, analyze_usage and cleanup_run for select, HEAD count,
    update, delete, insert and upsert, plus re-parenting (`42501` or 0 rows);
  - the RPCs (`P0002`, `23514`+namespace msg, `42501`; `user_id` in the payload is ignored;
    `bump` only moves the caller's own counter);
  - trigger functions (`PGRST202`, not exposed);
  - all 17 storage cases (RLS / object-not-found; B's uid is not visible from the root);
  - `analyze-meal` (4 × `not_found`);
  - anon.
- **SQL inventory** (Management API, read-only):
  - RLS is on for every `public` table, and there are no views.
  - `meal-photos` is the only bucket, with `public=false`.
  - No `public` table is in `supabase_realtime`.
  - 0 leftover test users or orphan test objects.
  - Executable by `authenticated`: `bump_analyze_usage, create_meal_log, update_meal_log` plus
    the trigger functions `handle_new_user, set_updated_at` (default grant). The trigger functions
    are also executable by `anon`, but PostgREST doesn't expose them (`PGRST202`, proven above).
  - Hardening option for 0042: revoke them anyway.

**Outcome:** plan 0001's deferred two-user proof is **closed**. The B1 hole (direct `meal_logs`
writes bypass `create_meal_log`'s `image_path` namespace check) is confirmed on prod and moves to
**plan 0042**. The script stays in the repo as a regression check: after 0042, the three B1 cases
must turn PASS.
