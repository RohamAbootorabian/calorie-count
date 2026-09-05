/**
 * Save a reviewed meal via the `create_meal_log` RPC (plan 0009 — S2 piece 3).
 * One atomic, idempotent, self-validating round-trip: the RPC inserts the
 * parent + children in a single transaction and returns the `meal_logs.id`.
 *
 * The call machinery (timeout race + PII-safe SQLSTATE-only outcome) lives in
 * the shared `callMealRpc` primitive (plan 0015); this file owns only the
 * save-specific result type, SQLSTATE→kind classify, and typed-kind logging.
 *
 * Error contract: `supabase.rpc()` resolves to `{ data, error }` where `error`
 * is a **PostgrestError** whose `message/details/hint` can echo row VALUES
 * (dish, path, numbers = health PII), so we map **by `error.code` (SQLSTATE)
 * only** and log **only the typed kind**.
 *
 * PII discipline: never logs the payload, dish, item names, path, or uid —
 * only the typed `kind` (mirrors `upload-meal-photo.ts`).
 */
import { callMealRpc } from './meal-rpc';
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

/** Map a SQLSTATE to a typed kind. The RPC raises explicit errcodes (B2/B3). */
function classifyCode(code: string | undefined): SaveErrorKind {
  switch (code) {
    case '23505': // unique_violation — shouldn't reach us (RPC is idempotent), success upstream.
      return 'conflict';
    case '23514': // check_violation — bad bounds / item count / image_path namespace.
    case '23502': // not_null_violation — a required column was null.
    case '22P02': // invalid_text_representation — a bad numeric/uuid cast.
    case '22007': // invalid_datetime_format — a malformed eaten_at cast (plan 0028).
    case '22008': // datetime_field_overflow — an out-of-range eaten_at cast (plan 0028).
      return 'invalid';
    case '28000': // our explicit "not authenticated" raise.
    case '42501': // insufficient_privilege — RLS rejected the write.
      return 'unauthorized';
    default:
      return 'unknown';
  }
}

export async function saveMeal({ payload }: { payload: SavePayload }): Promise<SaveResult> {
  const outcome = await callMealRpc(
    'create_meal_log',
    { p_log: payload.log, p_items: payload.items },
    { timeoutMs: RPC_TIMEOUT_MS },
  );

  if (outcome.status === 'network') return { ok: false, kind: 'network' };

  if (outcome.status === 'error') {
    const kind = classifyCode(outcome.code);
    // Log ONLY the typed kind — never the PostgrestError message/details (PII).
    console.warn('[saveMeal] failed:', kind);
    return { ok: false, kind };
  }

  // Untyped client → `data` is `unknown`; the RPC returns the new (or existing) id.
  const id = outcome.data;
  if (typeof id === 'string' && id) return { ok: true, id };
  return { ok: false, kind: 'unknown' };
}
