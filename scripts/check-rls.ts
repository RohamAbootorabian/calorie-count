/**
 * Two-user RLS isolation proof (plan 0041). PROD + service_role.
 *
 * Creates two throwaway users (A = attacker, B = victim) on the prod project,
 * seeds B with every kind of owned data, then attacks it as A through the real
 * public APIs (PostgREST, Storage, RPC, the analyze-meal Edge Function). Each
 * case is PASS (denied + service-role snapshot unchanged), FAIL (a hole) or
 * INVALID (unexpected result — never counts as PASS). Both users and their
 * objects are deleted at the end, on Ctrl-C, and on crash.
 *
 * Run ONLY via this exact command (the key lives in this one shell env; never
 * put it in `.env`, never echo it):
 *
 *   SUPABASE_SERVICE_ROLE_KEY="$(npx --no-install supabase projects api-keys --project-ref vldpfoczswakghkrkyrm -o json | jq -r '.[]|select(.name=="service_role").api_key')" \
 *     node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --env-file=.env scripts/check-rls.ts [--self-test | --sweep]
 *
 * `--self-test` makes B attack ITSELF: every self-testable case must come out
 * FAIL, proving each case can actually detect a leak. analyze-meal is never
 * called in self-test (it would reach OpenAI).
 *
 * `--sweep` deletes every leftover `rls-[ab]-*@example.com` test user (and its
 * objects) right away — use it after a run whose teardown reported LEFTOVER.
 * (Normal runs also self-heal leftovers older than one hour.)
 *
 * Output is case names + error codes only — never rows, notes, emails or keys.
 * Exits non-zero on any FAIL/INVALID or a teardown problem.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../src/types/database';

// Loose client: attacks deliberately send payloads/RPC names outside the typed schema.
type Client = SupabaseClient<any, 'public', any>;
type GoalsInsert = Database['public']['Tables']['goals']['Insert'];
type ProfileSeed = Database['public']['Tables']['profiles']['Insert'];

const PROJECT_REF = 'vldpfoczswakghkrkyrm';
const BUCKET = 'meal-photos';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TEST_EMAIL_RE = /^rls-[ab]-[0-9a-z]{8}@example\.com$/;
const STALE_MS = 60 * 60 * 1000;
const SELF_TEST = process.argv.includes('--self-test');
const SWEEP = process.argv.includes('--sweep');
const SYNTHETIC = 'RLS-TEST synthetic';
const SENTINEL = 'rls-sentinel';

// 1×1 baseline JPEG (bucket allows only image/jpeg|png).
const JPEG = Uint8Array.from(
  atob(
    '/9j/4AAQSkZJRgABAQAASABIAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmA' +
      'CZjs+EJ+/8AAEQgAAQABAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMF' +
      'BQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElK' +
      'U1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV' +
      '1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQH' +
      'BQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJ' +
      'SlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT' +
      '1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMAGxsbGxsbLxsbL0IvLy9CWUJCQkJZcFlZWVlZcIhwcHBwcHCIiIiIiIiI' +
      'iKOjo6Ojo76+vr6+1dXV1dXV1dXV1f/bAEMBISMjNjI2XTIyXd+XfJff39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f' +
      '39/f39/f39/f39/f39/f39/f3//dAAQAAf/aAAwDAQACEQMRAD8A6WiiigD/2Q==',
  ),
  (c) => c.charCodeAt(0),
);
const JPEG_OPTS = { contentType: 'image/jpeg' };

// ---------------------------------------------------------------------------
// Output + redaction
// ---------------------------------------------------------------------------

const secrets: string[] = [];

function redact(text: string): string {
  let out = text;
  for (const s of secrets) if (s.length >= 8) out = out.split(s).join('[redacted]');
  return out.replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[jwt]');
}

function say(line: string): void {
  console.log(redact(line));
}

/** name/code/status + a short redacted message — never the whole error object. */
function errInfo(e: unknown): string {
  if (!e || typeof e !== 'object') return redact(String(e).slice(0, 100));
  const o = e as Record<string, unknown>;
  const cause = o.cause as Record<string, unknown> | undefined;
  const parts = [o.name, o.code, o.status ?? o.statusCode, o.message, cause?.code]
    .filter((p) => p !== undefined && p !== null && p !== '')
    .map((p) => String(p).slice(0, 100));
  return redact(parts.join(' '));
}

class Invalid extends Error {}

// ---------------------------------------------------------------------------
// Env + guards
// ---------------------------------------------------------------------------

const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
secrets.push(anonKey, serviceKey);

if (!url.includes(PROJECT_REF)) {
  console.log(`refusing: EXPO_PUBLIC_SUPABASE_URL is not project ${PROJECT_REF}`);
  process.exit(2);
}
if (!anonKey) {
  console.log('refusing: EXPO_PUBLIC_SUPABASE_ANON_KEY missing (run with --env-file=.env)');
  process.exit(2);
}
if (!serviceKey || serviceKey === 'null' || serviceKey.length < 40) {
  console.log('refusing: SUPABASE_SERVICE_ROLE_KEY missing/invalid (see the run command)');
  process.exit(2);
}

// supabase-js logs some transport failures itself; route those through redaction too.
console.error = (...args: unknown[]) => say(`(lib) ${args.map((a) => errInfo(a)).join(' ')}`);
console.warn = console.error;

const TRANSIENT = /ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|UND_ERR_|socket|TLS/i;

/** fetch that retries (up to 3 tries) only when the connection itself failed. */
const retryingFetch: typeof fetch = async (input, init) => {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fetch(input, init);
    } catch (e) {
      const cause = (e as { cause?: unknown }).cause;
      if (attempt >= 3 || !TRANSIENT.test(`${errInfo(e)} ${errInfo(cause)}`)) throw e;
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
};

const AUTH_OPTS = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: retryingFetch },
};
const admin: Client = createClient(url, serviceKey, AUTH_OPTS);
const anon: Client = createClient(url, anonKey, AUTH_OPTS);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function randomBase36(n: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(bytes, (b) => (b % 36).toString(36)).join('');
}

function randomPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const b64 = btoa(String.fromCharCode(...bytes));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') + 'Aa1!';
}

async function sha256(data: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await data.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

const runId = randomBase36(8);
const photoPath = (uid: string, tag: string) => `${uid}/${runId}-${tag}-${crypto.randomUUID()}.jpg`;

const ITEMS = [
  { name: SYNTHETIC, portion: '1', estimatedGrams: 100, calories: 100, protein: 5, carbs: 10, fat: 3, sugar: 1, fiber: 1, sodium: 50 },
  { name: SYNTHETIC, portion: '1', estimatedGrams: 100, calories: 100, protein: 5, carbs: 10, fat: 3, sugar: 1, fiber: 1, sodium: 50 },
];

/** RPC `p_log` payload (create/update_meal_log). */
function logPayload(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    dish_name: SYNTHETIC, confidence: 'high',
    total_calories: 200, total_protein: 10, total_carbs: 20, total_fat: 6,
    total_sugar: 2, total_fiber: 2, total_sodium: 100,
    ...extra,
  };
}

/** Direct `meal_logs` row (PostgREST insert). */
function logRow(userId: string, imagePath: string | null): Record<string, unknown> {
  return { ...logPayload(), user_id: userId, image_path: imagePath };
}

function itemRow(mealLogId: string, position: number): Record<string, unknown> {
  return {
    meal_log_id: mealLogId, position, name: SYNTHETIC, portion: '1', estimated_grams: 100,
    calories: 100, protein: 5, carbs: 10, fat: 3, sugar: 1, fiber: 1, sodium: 50,
  };
}

function goalsRow(userId: string): GoalsInsert {
  return {
    user_id: userId, calories: 2000, protein: 100, carbs: 250, fat: 70,
    weight_goal: 'maintain', activity_level: 'moderate',
  };
}

function profileRow(id: string): ProfileSeed {
  return {
    id, display_name: 'rls-test', has_allergies: true, allergies_note: SYNTHETIC,
    has_conditions: true, conditions_note: SYNTHETIC,
  };
}

// ---------------------------------------------------------------------------
// Users, teardown, self-heal
// ---------------------------------------------------------------------------

type TestUser = {
  id: string;
  client: Client;
  token: string;
  meal: string;
  item: string;
  path: string;
};

const createdIds: string[] = [];

async function createTestUser(tag: 'a' | 'b'): Promise<TestUser> {
  const email = `rls-${tag}-${runId}@example.com`;
  const password = randomPassword();
  secrets.push(password);
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Invalid(`createUser(${tag}): ${errInfo(error)}`);
  createdIds.push(data.user.id);

  const client: Client = createClient(url, anonKey, AUTH_OPTS);
  const { data: auth, error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError || !auth.session) throw new Invalid(`signIn(${tag}): ${errInfo(signInError)}`);
  secrets.push(auth.session.access_token, auth.session.refresh_token);
  return { id: data.user.id, client, token: auth.session.access_token, meal: '', item: '', path: '' };
}

/** Remove every object under `<uid>/` — never the bucket root. */
async function removeFolder(uid: string): Promise<void> {
  if (!UUID_RE.test(uid)) throw new Error('removeFolder: not a uuid');
  for (let i = 0; i < 10; i++) {
    const { data, error } = await admin.storage.from(BUCKET).list(uid, { limit: 100 });
    if (error) throw new Error(`list ${errInfo(error)}`);
    const files = (data ?? []).filter((o) => o.id);
    if (files.length === 0) return;
    const { error: rmError } = await admin.storage.from(BUCKET).remove(files.map((o) => `${uid}/${o.name}`));
    if (rmError) throw new Error(`remove ${errInfo(rmError)}`);
  }
  throw new Error('removeFolder: objects remain after 10 passes');
}

/** Guarded purge: only a user whose email is a test email, re-checked right before deleting. */
async function purgeTestUser(uid: string): Promise<boolean> {
  if (!UUID_RE.test(uid)) return false;
  const { data, error } = await admin.auth.admin.getUserById(uid);
  if (error || !data.user) return error?.status === 404; // already gone
  if (!TEST_EMAIL_RE.test(data.user.email ?? '')) {
    say(`teardown: refusing to delete ${uid} (not a test email)`);
    return false;
  }
  await removeFolder(uid);
  const { error: delError } = await admin.auth.admin.deleteUser(uid);
  return !delError;
}

async function listTestUsers(): Promise<{ id: string; email: string; createdAt: number }[]> {
  const out: { id: string; email: string; createdAt: number }[] = [];
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Invalid(`listUsers: ${errInfo(error)}`);
    for (const u of data.users) {
      if (TEST_EMAIL_RE.test(u.email ?? '')) {
        out.push({ id: u.id, email: u.email ?? '', createdAt: Date.parse(u.created_at) });
      }
    }
    if (data.users.length < 1000) break;
  }
  return out;
}

/** Startup self-heal: purge test users left by a crashed run more than an hour ago. */
async function selfHeal(): Promise<void> {
  const stale = (await listTestUsers()).filter((u) => Date.now() - u.createdAt > STALE_MS);
  for (const u of stale) {
    const ok = await purgeTestUser(u.id);
    say(`self-heal: stale test user ${u.id} ${ok ? 'removed' : 'NOT removed'}`);
  }
}

let teardownPromise: Promise<boolean> | null = null;

/** Idempotent. Returns true when nothing of this run is left behind. */
function teardown(): Promise<boolean> {
  teardownPromise ??= (async () => {
    const ids = new Set(createdIds);
    try {
      // Also catch a user whose createUser ack was lost (email carries this runId).
      for (const u of await listTestUsers()) if (u.email.includes(`-${runId}@`)) ids.add(u.id);
    } catch (e) {
      say(`teardown: listUsers failed ${errInfo(e)}`);
    }
    const leftovers: string[] = [];
    for (const id of ids) {
      let ok = false;
      for (let attempt = 0; attempt < 2 && !ok; attempt++) {
        try {
          ok = await purgeTestUser(id);
        } catch (e) {
          say(`teardown: ${id} ${errInfo(e)}`);
        }
      }
      if (!ok) leftovers.push(id);
    }
    if (leftovers.length) say(`teardown: LEFTOVER test users: ${leftovers.join(', ')}`);
    else say(`teardown: removed ${ids.size} test users and their objects`);
    return leftovers.length === 0;
  })();
  return teardownPromise;
}

function onFatal(label: string) {
  return (e: unknown) => {
    say(`${label}: ${errInfo(e)}`);
    void teardown().finally(() => process.exit(1));
  };
}
process.on('SIGINT', onFatal('interrupted'));
process.on('SIGTERM', onFatal('terminated'));
process.on('uncaughtException', onFatal('uncaught'));
process.on('unhandledRejection', onFatal('unhandled rejection'));

// ---------------------------------------------------------------------------
// Seed + reset (service role, so a successful attack can be undone between cases)
// ---------------------------------------------------------------------------

let A: TestUser;
let B: TestUser;

async function must<T>(label: string, p: PromiseLike<{ data: T; error: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Invalid(`${label}: ${errInfo(error)}`);
  return data;
}

async function seedUser(u: TestUser): Promise<void> {
  const prof = await must('seed profile', admin.from('profiles').upsert(profileRow(u.id)).select('id'));
  if ((prof as unknown[]).length !== 1) throw new Invalid('seed profile: expected exactly 1 row');
  await must('seed goals', admin.from('goals').insert(goalsRow(u.id)));
  u.path = photoPath(u.id, 'seed');
  await must('seed object', admin.storage.from(BUCKET).upload(u.path, JPEG, JPEG_OPTS));
  const meal = await must(
    'seed meal',
    admin.from('meal_logs').insert({ ...logRow(u.id, u.path), verified: true }).select('id').single(),
  );
  u.meal = (meal as { id: string }).id;
  const items = await must(
    'seed items',
    admin.from('meal_items').insert([itemRow(u.meal, 0), itemRow(u.meal, 1)]).select('id, position'),
  );
  u.item = (items as { id: string; position: number }[]).find((i) => i.position === 0)?.id ?? '';
  if (!u.item) throw new Invalid('seed items: first item missing');
  await must('seed usage', admin.from('analyze_usage').insert({ user_id: u.id, count: 1 }));
}

/** Wipe both users' data + objects and seed again. */
async function resetData(): Promise<void> {
  for (const u of [A, B]) {
    await must('reset meals', admin.from('meal_logs').delete().eq('user_id', u.id));
    await must('reset goals', admin.from('goals').delete().eq('user_id', u.id));
    await must('reset usage', admin.from('analyze_usage').delete().eq('user_id', u.id));
    await removeFolder(u.id);
  }
  await seedUser(A);
  await seedUser(B);
}

// ---------------------------------------------------------------------------
// Snapshot (service role) — what "B unchanged" means
// ---------------------------------------------------------------------------

async function snapshot(opts: { ignoreAttackerUsage?: boolean } = {}): Promise<string> {
  const atk = attacker();
  const logs = await must('snap logs', admin.from('meal_logs').select('*').eq('user_id', B.id).order('id'));
  const logIds = (logs as { id: string }[]).map((l) => l.id);
  const objects = await must('snap objects', admin.storage.from(BUCKET).list(B.id, { limit: 100 }));
  const objectList = (objects as { name: string; updated_at: string; metadata: unknown }[])
    .map((o) => ({ name: o.name, updated_at: o.updated_at, metadata: o.metadata }))
    .sort((x, y) => x.name.localeCompare(y.name));
  const { data: blob } = await admin.storage.from(BUCKET).download(B.path);
  const parts = {
    profile: await must('snap profile', admin.from('profiles').select('*').eq('id', B.id)),
    goals: await must('snap goals', admin.from('goals').select('*').eq('user_id', B.id)),
    logs,
    items: logIds.length
      ? await must('snap items', admin.from('meal_items').select('*').in('meal_log_id', logIds).order('id'))
      : [],
    usage: await must('snap usage', admin.from('analyze_usage').select('*').eq('user_id', B.id).order('day')),
    attackerUsage:
      opts.ignoreAttackerUsage || atk === B
        ? null
        : await must('snap atk usage', admin.from('analyze_usage').select('*').eq('user_id', atk.id).order('day')),
    // B1: rows owned by someone else that point into B's namespace.
    foreignInB: await must(
      'snap foreign',
      admin.from('meal_logs').select('id').like('image_path', `${B.id}/%`).neq('user_id', B.id),
    ),
    objects: objectList,
    seedBytes: blob ? await sha256(blob) : null,
    cleanupRun: await must('snap cleanup', admin.from('cleanup_run').select('*')),
  };
  return JSON.stringify(parts);
}

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

type Outcome = { v: 'denied' | 'allowed' | 'unexpected'; info: string };
const denied = (info = ''): Outcome => ({ v: 'denied', info });
const allowed = (info = ''): Outcome => ({ v: 'allowed', info });
const unexpected = (info: string): Outcome => ({ v: 'unexpected', info });

type PgResult = { data: unknown; error: { code?: string; message?: string } | null; count?: number | null };

/** Filtered select/update/delete: denial = no error and zero rows. */
function zeroRows(r: PgResult): Outcome {
  if (r.error) return unexpected(`error ${errInfo(r.error)}`);
  const n = Array.isArray(r.data) ? r.data.length : r.data ? 1 : 0;
  return n === 0 ? denied('0 rows') : allowed(`${n} rows`);
}

/** HEAD count: denial = count 0. */
function zeroCount(r: PgResult): Outcome {
  if (r.error) return unexpected(`error ${errInfo(r.error)}`);
  return r.count === 0 ? denied('count 0') : allowed(`count ${r.count}`);
}

/** Insert / WITH CHECK: denial = exactly this code (+ optional message). `leakCodes` = the attempt revealed something. */
function code(r: PgResult, want: string, opts: { msg?: string; leakCodes?: string[] } = {}): Outcome {
  if (!r.error) return allowed('no error');
  const c = r.error.code ?? '';
  if (opts.leakCodes?.includes(c)) return allowed(`leak ${c}`);
  if (c === want && (!opts.msg || (r.error.message ?? '').includes(opts.msg))) return denied(c);
  return unexpected(`error ${errInfo(r.error)}`);
}

/** Any error = denied (only for surfaces with no single documented code). */
function anyError(r: { error: unknown }): Outcome {
  return r.error ? denied(errInfo(r.error)) : allowed('no error');
}

/** Storage call on an object the caller must not see/write: RLS or not-found error = denied. */
function storageDenied(r: { data: unknown; error: unknown }): Outcome {
  if (!r.error) return allowed('no error');
  const info = errInfo(r.error);
  return /row-level security|not found|unauthorized|403|404|400/i.test(info)
    ? denied(info)
    : unexpected(info);
}

type Case = {
  name: string;
  /** Can B-attacking-itself make this succeed? (false = also denied for the owner, or costs money) */
  selfTestable: boolean;
  ignoreAttackerUsage?: boolean;
  run: () => Promise<Outcome>;
};

const attacker = (): TestUser => (SELF_TEST ? B : A);

function tableCases(): Case[] {
  const atk = () => attacker().client;
  const out: Case[] = [];

  // profiles (health data lives here)
  out.push(
    { name: 'profiles.select', selfTestable: true, run: async () => zeroRows(await atk().from('profiles').select('id').eq('id', B.id)) },
    { name: 'profiles.head-count', selfTestable: true, run: async () => zeroCount(await atk().from('profiles').select('id', { count: 'exact', head: true }).eq('id', B.id)) },
    { name: 'profiles.update', selfTestable: true, run: async () => zeroRows(await atk().from('profiles').update({ display_name: SENTINEL, allergies_note: SENTINEL }).eq('id', B.id).select('id')) },
    { name: 'profiles.insert-as-victim', selfTestable: false, run: async () => code(await atk().from('profiles').insert({ id: B.id, display_name: SENTINEL }), '42501') },
    { name: 'profiles.upsert-as-victim', selfTestable: true, run: async () => code(await atk().from('profiles').upsert({ id: B.id, display_name: SENTINEL }).select('id'), '42501') },
  );

  // goals
  out.push(
    { name: 'goals.select', selfTestable: true, run: async () => zeroRows(await atk().from('goals').select('user_id').eq('user_id', B.id)) },
    { name: 'goals.head-count', selfTestable: true, run: async () => zeroCount(await atk().from('goals').select('user_id', { count: 'exact', head: true }).eq('user_id', B.id)) },
    { name: 'goals.update', selfTestable: true, run: async () => zeroRows(await atk().from('goals').update({ calories: 1234 }).eq('user_id', B.id).select('user_id')) },
    { name: 'goals.insert-as-victim', selfTestable: false, run: async () => code(await atk().from('goals').insert(goalsRow(B.id)), '42501') },
    { name: 'goals.upsert-as-victim', selfTestable: true, run: async () => code(await atk().from('goals').upsert({ ...goalsRow(B.id), calories: 1111 }, { onConflict: 'user_id' }).select('user_id'), '42501') },
    { name: 'goals.reparent-own-to-victim', selfTestable: true, run: async () => code(await atk().from('goals').update({ user_id: B.id }).eq('user_id', attacker().id).select('user_id'), '42501') },
  );

  // meal_logs
  out.push(
    { name: 'meal_logs.select', selfTestable: true, run: async () => zeroRows(await atk().from('meal_logs').select('id').eq('id', B.meal)) },
    { name: 'meal_logs.head-count', selfTestable: true, run: async () => zeroCount(await atk().from('meal_logs').select('id', { count: 'exact', head: true }).eq('user_id', B.id)) },
    {
      name: 'meal_logs.unfiltered-select-only-own',
      selfTestable: false,
      run: async () => {
        const r = await atk().from('meal_logs').select('user_id').limit(1000);
        if (r.error) return unexpected(errInfo(r.error));
        const foreign = (r.data as { user_id: string }[]).filter((x) => x.user_id !== attacker().id).length;
        return foreign === 0 ? denied(`${r.data.length} own rows`) : allowed(`${foreign} foreign rows`);
      },
    },
    { name: 'meal_logs.update', selfTestable: true, run: async () => zeroRows(await atk().from('meal_logs').update({ dish_name: SENTINEL }).eq('id', B.meal).select('id')) },
    { name: 'meal_logs.insert-as-victim', selfTestable: true, run: async () => code(await atk().from('meal_logs').insert(logRow(B.id, null)).select('id'), '42501') },
    { name: 'meal_logs.reparent-own-to-victim', selfTestable: true, run: async () => code(await atk().from('meal_logs').update({ user_id: B.id }).eq('id', attacker().meal).select('id'), '42501') },
    // B1 — image_path namespace bypass via direct table writes (create_meal_log checks it; the policy does not).
    { name: 'meal_logs.B1-insert-own-row-fresh-victim-path', selfTestable: true, run: async () => code(await atk().from('meal_logs').insert(logRow(attacker().id, photoPath(B.id, 'planted'))).select('id'), '42501') },
    { name: 'meal_logs.B1-insert-own-row-existing-victim-path', selfTestable: true, run: async () => code(await atk().from('meal_logs').insert(logRow(attacker().id, B.path)).select('id'), '42501', { leakCodes: ['23505'] }) },
    { name: 'meal_logs.B1-patch-own-image_path-to-victim', selfTestable: true, run: async () => code(await atk().from('meal_logs').update({ image_path: photoPath(B.id, 'planted') }).eq('id', attacker().meal).select('id'), '42501') },
  );

  // meal_items
  out.push(
    { name: 'meal_items.select', selfTestable: true, run: async () => zeroRows(await atk().from('meal_items').select('id').eq('id', B.item)) },
    { name: 'meal_items.head-count', selfTestable: true, run: async () => zeroCount(await atk().from('meal_items').select('id', { count: 'exact', head: true }).eq('meal_log_id', B.meal)) },
    { name: 'meal_items.update', selfTestable: true, run: async () => zeroRows(await atk().from('meal_items').update({ name: SENTINEL }).eq('id', B.item).select('id')) },
    { name: 'meal_items.insert-into-victim-log', selfTestable: true, run: async () => code(await atk().from('meal_items').insert(itemRow(B.meal, 9)).select('id'), '42501') },
    { name: 'meal_items.move-own-item-into-victim-log', selfTestable: true, run: async () => code(await atk().from('meal_items').update({ meal_log_id: B.meal, name: SENTINEL }).eq('id', attacker().item).select('id'), '42501') },
  );

  // analyze_usage (no write policies at all; the only writer is the SECURITY DEFINER rpc)
  out.push(
    { name: 'analyze_usage.select', selfTestable: true, run: async () => zeroRows(await atk().from('analyze_usage').select('user_id').eq('user_id', B.id)) },
    { name: 'analyze_usage.head-count', selfTestable: true, run: async () => zeroCount(await atk().from('analyze_usage').select('user_id', { count: 'exact', head: true }).eq('user_id', B.id)) },
    { name: 'analyze_usage.update-victim', selfTestable: false, run: async () => zeroRows(await atk().from('analyze_usage').update({ count: 0 }).eq('user_id', B.id).select('user_id')) },
    { name: 'analyze_usage.insert-as-victim', selfTestable: false, run: async () => code(await atk().from('analyze_usage').insert({ user_id: B.id, day: '2000-01-01', count: 0 }), '42501') },
    { name: 'analyze_usage.reset-own-cap', selfTestable: false, run: async () => zeroRows(await atk().from('analyze_usage').update({ count: 0 }).eq('user_id', attacker().id).select('user_id')) },
    { name: 'analyze_usage.delete-own-row', selfTestable: false, run: async () => zeroRows(await atk().from('analyze_usage').delete().eq('user_id', attacker().id).select('user_id')) },
  );

  // cleanup_run (RLS on, zero policies)
  out.push(
    { name: 'cleanup_run.select', selfTestable: false, run: async () => zeroRows(await atk().from('cleanup_run').select('id')) },
    {
      name: 'cleanup_run.update-same-value',
      selfTestable: false,
      run: async () => {
        // Write back the CURRENT value so even a hole cannot pause the prod cron.
        const cur = await must('cleanup_run read', admin.from('cleanup_run').select('last_run_at').single());
        return zeroRows(await atk().from('cleanup_run').update({ last_run_at: (cur as { last_run_at: string }).last_run_at }).eq('id', true).select('id'));
      },
    },
  );

  // Deletes last (they remove the rows the cases above target; reset restores after a FAIL).
  out.push(
    { name: 'meal_items.delete', selfTestable: true, run: async () => zeroRows(await atk().from('meal_items').delete().eq('id', B.item).select('id')) },
    { name: 'meal_logs.delete', selfTestable: true, run: async () => zeroRows(await atk().from('meal_logs').delete().eq('id', B.meal).select('id')) },
    { name: 'goals.delete', selfTestable: true, run: async () => zeroRows(await atk().from('goals').delete().eq('user_id', B.id).select('user_id')) },
    { name: 'profiles.delete', selfTestable: true, run: async () => zeroRows(await atk().from('profiles').delete().eq('id', B.id).select('id')) },
  );
  return out;
}

function rpcCases(): Case[] {
  const atk = () => attacker().client;
  return [
    { name: 'rpc.update_meal_log-victim-meal', selfTestable: true, run: async () => code(await atk().rpc('update_meal_log', { p_id: B.meal, p_log: logPayload({ dish_name: SENTINEL }), p_items: ITEMS }), 'P0002') },
    { name: 'rpc.create_meal_log-victim-path', selfTestable: true, run: async () => code(await atk().rpc('create_meal_log', { p_log: logPayload({ image_path: photoPath(B.id, 'rpc') }), p_items: ITEMS }), '23514', { msg: 'image_path outside caller namespace' }) },
    {
      name: 'rpc.create_meal_log-payload-user_id-ignored',
      selfTestable: true,
      run: async () => {
        const r = await atk().rpc('create_meal_log', { p_log: logPayload({ user_id: B.id }), p_items: ITEMS });
        if (r.error) return unexpected(errInfo(r.error));
        const row = await must('owner read', admin.from('meal_logs').select('user_id').eq('id', r.data as string).single());
        const owner = (row as { user_id: string }).user_id;
        if (owner === B.id) return allowed('row owned by victim');
        await must('cleanup own row', admin.from('meal_logs').delete().eq('id', r.data as string));
        return denied('row owned by caller');
      },
    },
    {
      name: 'rpc.bump_analyze_usage-only-own-counter',
      selfTestable: true,
      ignoreAttackerUsage: true,
      run: async () => {
        const r = await atk().rpc('bump_analyze_usage', { p_limit: 50 });
        // Victim unchanged is verified by the snapshot; the call itself is legitimate.
        return r.error ? unexpected(errInfo(r.error)) : denied(`own count ${String(r.data)}`);
      },
    },
    { name: 'rpc.claim_cleanup_run', selfTestable: false, run: async () => code(await atk().rpc('claim_cleanup_run', { p_min_interval_seconds: 600 }), '42501') },
    { name: 'rpc.handle_new_user', selfTestable: false, run: async () => anyError(await atk().rpc('handle_new_user')) },
    { name: 'rpc.set_updated_at', selfTestable: false, run: async () => anyError(await atk().rpc('set_updated_at')) },
  ];
}

function storageCases(): Case[] {
  const st = () => attacker().client.storage.from(BUCKET);
  const raw = (path: string, mode: 'public' | 'authenticated', token?: string) =>
    fetch(`${url}/storage/v1/object/${mode}/${BUCKET}/${path}`, {
      headers: token ? { Authorization: `Bearer ${token}`, apikey: anonKey } : { apikey: anonKey },
    });
  return [
    {
      name: 'storage.list-root-hides-victim',
      selfTestable: true,
      run: async () => {
        const r = await st().list('', { limit: 1000 });
        if (r.error) return unexpected(errInfo(r.error));
        return r.data.some((o) => o.name === B.id) ? allowed('victim folder visible') : denied(`${r.data.length} entries`);
      },
    },
    {
      name: 'storage.list-victim-folder',
      selfTestable: true,
      run: async () => {
        const r = await st().list(B.id);
        if (r.error) return storageDenied(r);
        return r.data.length === 0 ? denied('empty') : allowed(`${r.data.length} objects`);
      },
    },
    { name: 'storage.download', selfTestable: true, run: async () => storageDenied(await st().download(B.path)) },
    {
      name: 'storage.exists',
      selfTestable: true,
      run: async () => {
        const r = await st().exists(B.path);
        return r.data === true ? allowed('exists=true') : denied('exists=false');
      },
    },
    { name: 'storage.info', selfTestable: true, run: async () => storageDenied(await st().info(B.path)) },
    { name: 'storage.createSignedUrl', selfTestable: true, run: async () => storageDenied(await st().createSignedUrl(B.path, 60)) },
    {
      name: 'storage.createSignedUrls-batch',
      selfTestable: true,
      run: async () => {
        const r = await st().createSignedUrls([B.path], 60);
        if (r.error) return storageDenied(r);
        const got = r.data?.[0];
        return got?.signedUrl && !got.error ? allowed('signed url issued') : denied(String(got?.error ?? 'no url'));
      },
    },
    {
      name: 'storage.http-public-endpoint',
      selfTestable: false,
      run: async () => {
        const res = await raw(B.path, 'public');
        return res.status === 200 ? allowed('200') : denied(`HTTP ${res.status}`);
      },
    },
    {
      name: 'storage.http-authenticated-endpoint',
      selfTestable: true,
      run: async () => {
        const res = await raw(B.path, 'authenticated', attacker().token);
        return res.status === 200 ? allowed('200') : denied(`HTTP ${res.status}`);
      },
    },
    { name: 'storage.upload-new-into-victim-folder', selfTestable: true, run: async () => storageDenied(await st().upload(photoPath(B.id, 'upload'), JPEG, JPEG_OPTS)) },
    { name: 'storage.upsert-over-victim-object', selfTestable: true, run: async () => storageDenied(await st().upload(B.path, JPEG, { ...JPEG_OPTS, upsert: true })) },
    { name: 'storage.update-victim-object', selfTestable: true, run: async () => storageDenied(await st().update(B.path, JPEG, JPEG_OPTS)) },
    { name: 'storage.copy-victim-to-own', selfTestable: true, run: async () => storageDenied(await st().copy(B.path, photoPath(attacker().id, 'stolen'))) },
    { name: 'storage.copy-own-into-victim', selfTestable: true, run: async () => storageDenied(await st().copy(attacker().path, photoPath(B.id, 'planted'))) },
    { name: 'storage.move-own-into-victim', selfTestable: true, run: async () => storageDenied(await st().move(attacker().path, photoPath(B.id, 'planted'))) },
    {
      name: 'storage.remove-victim-object',
      selfTestable: true,
      run: async () => {
        const r = await st().remove([B.path]);
        if (r.error) return storageDenied(r);
        return (r.data ?? []).length > 0 ? allowed(`${r.data.length} removed`) : denied('0 removed');
      },
    },
    { name: 'storage.move-victim-to-own', selfTestable: true, run: async () => storageDenied(await st().move(B.path, photoPath(attacker().id, 'stolen'))) },
  ];
}

function functionCases(): Case[] {
  const invoke = async (path: string): Promise<Outcome> => {
    const r = await A.client.functions.invoke('analyze-meal', { body: { path } });
    if (r.error) return unexpected(errInfo(r.error));
    const body = r.data as { ok?: boolean; kind?: string };
    if (body?.ok === true) return allowed('analysis returned');
    return body?.kind === 'not_found' ? denied('not_found') : unexpected(`kind ${String(body?.kind)}`);
  };
  // Never self-testable: an owned path would reach OpenAI.
  return [
    { name: 'analyze-meal.victim-path (path-prefix check)', selfTestable: false, run: () => invoke(B.path) },
    { name: 'analyze-meal.dotdot-traversal', selfTestable: false, run: () => invoke(`${A.id}/../${B.path}`) },
    { name: 'analyze-meal.encoded-slash', selfTestable: false, run: () => invoke(B.path.replace('/', '%2F')) },
    { name: 'analyze-meal.own-shaped-missing-object', selfTestable: false, run: () => invoke(photoPath(A.id, 'missing')) },
  ];
}

function anonCases(): Case[] {
  return [
    { name: 'anon.profiles.select', selfTestable: false, run: async () => zeroRows(await anon.from('profiles').select('id').eq('id', B.id)) },
    { name: 'anon.rpc.create_meal_log', selfTestable: false, run: async () => anyError(await anon.rpc('create_meal_log', { p_log: logPayload(), p_items: ITEMS })) },
  ];
}

// ---------------------------------------------------------------------------
// Positive controls — a failure here makes the whole run INVALID
// ---------------------------------------------------------------------------

async function positiveControls(): Promise<void> {
  const own = async (label: string, p: PromiseLike<PgResult>) => {
    const r = await p;
    const n = Array.isArray(r.data) ? r.data.length : 0;
    if (r.error || n === 0) throw new Invalid(`control ${label}: ${r.error ? errInfo(r.error) : '0 rows'}`);
  };
  await own('B profile', B.client.from('profiles').select('id').eq('id', B.id));
  await own('B goals', B.client.from('goals').select('user_id').eq('user_id', B.id));
  await own('B meal', B.client.from('meal_logs').select('id').eq('id', B.meal));
  await own('B items', B.client.from('meal_items').select('id').eq('meal_log_id', B.meal));
  await own('B usage', B.client.from('analyze_usage').select('user_id').eq('user_id', B.id));
  await own('A meal', A.client.from('meal_logs').select('id').eq('id', A.meal));

  const list = await B.client.storage.from(BUCKET).list(B.id);
  if (list.error || list.data.length !== 1) throw new Invalid(`control B list: ${errInfo(list.error) || `${list.data?.length} objects`}`);
  const dl = await B.client.storage.from(BUCKET).download(B.path);
  if (dl.error || !dl.data) throw new Invalid(`control B download: ${errInfo(dl.error)}`);

  // Identical upload into the caller's OWN folder must work → storage denials below are RLS, not MIME.
  const ctrlPath = photoPath(A.id, 'control');
  const up = await A.client.storage.from(BUCKET).upload(ctrlPath, JPEG, JPEG_OPTS);
  if (up.error) throw new Invalid(`control A own upload: ${errInfo(up.error)}`);
  await A.client.storage.from(BUCKET).remove([ctrlPath]);

  // The B1 payload shape is valid in the caller's OWN namespace.
  const ins = await A.client.from('meal_logs').insert(logRow(A.id, photoPath(A.id, 'control'))).select('id');
  if (ins.error || ins.data.length !== 1) throw new Invalid(`control A own direct insert: ${errInfo(ins.error)}`);
  await A.client.from('meal_logs').delete().eq('id', (ins.data[0] as { id: string }).id);
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

type Verdict = 'PASS' | 'FAIL' | 'INVALID';

async function runCase(c: Case): Promise<{ verdict: Verdict; info: string }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const before = await snapshot({ ignoreAttackerUsage: c.ignoreAttackerUsage });
    let outcome: Outcome;
    try {
      outcome = await c.run();
    } catch (e) {
      outcome = unexpected(errInfo(e));
    }
    const after = await snapshot({ ignoreAttackerUsage: c.ignoreAttackerUsage });
    const changed = before !== after;
    if (changed || outcome.v === 'allowed') await resetData();
    if (outcome.v === 'allowed' || changed) {
      return { verdict: 'FAIL', info: changed ? `${outcome.info}; victim state CHANGED` : outcome.info };
    }
    if (outcome.v === 'denied') return { verdict: 'PASS', info: outcome.info };
    if (attempt === 1) return { verdict: 'INVALID', info: outcome.info };
  }
  return { verdict: 'INVALID', info: 'unreachable' };
}

/** `--sweep`: purge every test user now (any age), then exit. Same guarded purge. */
async function sweep(): Promise<number> {
  const users = await listTestUsers();
  let left = 0;
  for (const u of users) {
    const ok = await purgeTestUser(u.id);
    if (!ok) left++;
    say(`sweep: test user ${u.id} ${ok ? 'removed' : 'NOT removed'}`);
  }
  say(`sweep: ${users.length} found, ${left} left`);
  return left ? 1 : 0;
}

async function main(): Promise<number> {
  if (SWEEP) return sweep();
  say(`check-rls run ${runId}${SELF_TEST ? ' (SELF-TEST: B attacks itself)' : ''}`);
  await selfHeal();
  A = await createTestUser('a');
  B = await createTestUser('b');
  await resetData();
  await positiveControls();
  say('positive controls: ok');

  const all = [...tableCases(), ...rpcCases(), ...storageCases(), ...functionCases(), ...anonCases()];
  const cases = SELF_TEST ? all.filter((c) => c.selfTestable) : all;
  const tally: Record<Verdict, number> = { PASS: 0, FAIL: 0, INVALID: 0 };
  for (const c of cases) {
    const { verdict, info } = await runCase(c);
    tally[verdict]++;
    say(`${verdict.padEnd(7)} ${c.name}${info ? `  [${info}]` : ''}`);
  }
  say(`summary: ${cases.length} cases — PASS ${tally.PASS}, FAIL ${tally.FAIL}, INVALID ${tally.INVALID}`);
  if (SELF_TEST) {
    const ok = tally.FAIL === cases.length;
    say(`self-test: ${tally.FAIL}/${cases.length} cases detected the (legitimate) self-access — ${ok ? 'harness OK' : 'HARNESS BROKEN'}`);
  }
  return tally.FAIL || tally.INVALID ? 1 : 0;
}

let exitCode = 1;
try {
  exitCode = await main();
} catch (e) {
  say(e instanceof Invalid ? `INVALID run: ${e.message}` : `crashed: ${errInfo(e)}`);
  exitCode = 1;
} finally {
  const clean = await teardown();
  if (!clean) exitCode = 1;
}
process.exit(exitCode);
