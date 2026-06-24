/**
 * Shared meal-RPC primitive (plan 0015 — factored out of `saveMeal`).
 *
 * `create_meal_log` (save) and `update_meal_log` (edit) share the exact same
 * call machinery: wrap the thenable builder so a timeout race typechecks, race
 * it against a timeout, and normalize the result to a transport-agnostic outcome
 * carrying ONLY the SQLSTATE (`error.code`) — never the PostgrestError
 * message/details/hint, which can echo row VALUES (dish, path, numbers = health
 * PII). Each caller maps the SQLSTATE to its OWN typed kind (save has
 * `conflict`+`id`; update has `not_found` and no id) and logs only that kind.
 *
 * The client is untyped (`src/lib/supabase.ts` builds it without the
 * `<Database>` generic), so `.rpc(...)` returns `any`; `data` rides out as
 * `unknown` for the caller to narrow.
 */
import { supabase } from '@/lib/supabase';

/**
 * Transport-agnostic RPC outcome. `error` carries the SQLSTATE only (no message
 * → no PII). `network` is a thrown transport failure or a timeout (transient).
 */
export type RpcOutcome =
  | { status: 'ok'; data: unknown }
  | { status: 'error'; code: string | undefined }
  | { status: 'network' };

const TIMEOUT = Symbol('timeout');

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | typeof TIMEOUT> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<typeof TIMEOUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMEOUT), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

/**
 * Invoke a meal RPC with a timeout, returning a normalized outcome. Never
 * throws; never logs (the caller logs its own typed kind). `args` is the RPC's
 * named-parameter object (e.g. `{ p_log, p_items }` / `{ p_id, p_log, p_items }`).
 */
export async function callMealRpc(
  fn: string,
  args: Record<string, unknown>,
  { timeoutMs }: { timeoutMs: number },
): Promise<RpcOutcome> {
  // `supabase.rpc()` returns a thenable builder, not a Promise — wrap it so the
  // timeout race typechecks (Promise.resolve adopts the thenable at runtime).
  const invocation = Promise.resolve(supabase.rpc(fn, args));

  let raced: Awaited<typeof invocation> | typeof TIMEOUT;
  try {
    raced = await withTimeout(invocation, timeoutMs);
  } catch {
    // A thrown (vs. returned) error is a transport/fetch failure → transient.
    return { status: 'network' };
  }

  if (raced === TIMEOUT) return { status: 'network' };

  const { data, error } = raced;
  if (error) return { status: 'error', code: (error as { code?: string }).code };
  return { status: 'ok', data };
}
