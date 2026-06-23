/**
 * Save a reviewed meal via the `create_meal_log` RPC (plan 0009 — S2 piece 3).
 * One atomic, idempotent, self-validating round-trip: the RPC inserts the
 * parent + children in a single transaction and returns the `meal_logs.id`.
 *
 * Error contract: `supabase.rpc()` resolves to `{ data, error }` where `error`
 * is a **PostgrestError** (`code`, `message`, `details`, `hint`) — NOT the
 * `Functions*Error` classes the analyze helper throws. Its `message/details/
 * hint` can echo row VALUES (dish, path, numbers = health PII), so we map
 * **by `error.code` (SQLSTATE) only** and log **only the typed kind**.
 *
 * The client is untyped (`src/lib/supabase.ts` builds the client without the
 * `<Database>` generic), so `.rpc(...)` returns `any`; we cast the result to a
 * string id. No type regen needed.
 *
 * PII discipline: never logs the payload, dish, item names, path, or uid —
 * only the typed `kind` (mirrors `upload-meal-photo.ts`).
 */
import { supabase } from '@/lib/supabase';

import type { SavePayload } from './meal-form';

const RPC_TIMEOUT_MS = 20_000;

/**
 * Permanent kinds tell the user what to change; transient kinds (`network`)
 * are the only ones the review offers a bare retry for. `conflict` is handled
 * upstream as SUCCESS (the RPC is idempotent on `image_path`, B3) and so is
 * routed to the Saved state, not surfaced as an error.
 */
export type SaveErrorKind = 'unauthorized' | 'invalid' | 'conflict' | 'network' | 'unknown';

export type SaveResult =
  | { ok: true; id: string }
  | { ok: false; kind: SaveErrorKind };

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

/** Map a SQLSTATE to a typed kind. The RPC raises explicit errcodes (B2/B3). */
function classifyCode(code: string | undefined): SaveErrorKind {
  switch (code) {
    case '23505': // unique_violation — shouldn't reach us (RPC is idempotent), success upstream.
      return 'conflict';
    case '23514': // check_violation — bad bounds / item count / image_path namespace.
    case '23502': // not_null_violation — a required column was null.
    case '22P02': // invalid_text_representation — a bad numeric/uuid cast.
      return 'invalid';
    case '28000': // our explicit "not authenticated" raise.
    case '42501': // insufficient_privilege — RLS rejected the write.
      return 'unauthorized';
    default:
      return 'unknown';
  }
}

export async function saveMeal({ payload }: { payload: SavePayload }): Promise<SaveResult> {
  // `supabase.rpc()` returns a thenable builder, not a Promise — wrap it so the
  // timeout race typechecks (Promise.resolve adopts the thenable at runtime).
  const invocation = Promise.resolve(
    supabase.rpc('create_meal_log', { p_log: payload.log, p_items: payload.items }),
  );

  let raced: Awaited<typeof invocation> | typeof TIMEOUT;
  try {
    raced = await withTimeout(invocation, RPC_TIMEOUT_MS);
  } catch {
    // A thrown (vs. returned) error is a transport/fetch failure → transient.
    return { ok: false, kind: 'network' };
  }

  if (raced === TIMEOUT) return { ok: false, kind: 'network' };

  const { data, error } = raced;

  if (error) {
    const kind = classifyCode((error as { code?: string }).code);
    // Log ONLY the typed kind — never the PostgrestError message/details (PII).
    console.warn('[saveMeal] failed:', kind);
    return { ok: false, kind };
  }

  // Untyped client → `data` is `any`; the RPC returns the new (or existing) id.
  const id = data as unknown;
  if (typeof id === 'string' && id) return { ok: true, id };
  return { ok: false, kind: 'unknown' };
}
