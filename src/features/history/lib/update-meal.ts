/**
 * Update a saved meal via the `update_meal_log` RPC (plan 0015). One atomic,
 * self-validating round-trip: the RPC updates the parent's editable columns +
 * replaces ALL children in a single transaction. Lives in `history/lib` because
 * HISTORY owns the edit *flow*; it reuses capture's `callMealRpc` primitive and
 * `SavePayload` model (same history→capture split as `delete-meal`).
 *
 * DEDICATED result type (review B2 — do NOT reuse `SaveResult`/`classifyCode`):
 * an update has no `conflict` and returns no `id`; it adds a `not_found` kind
 * (the meal was deleted between open and Save). Mapped from a DISTINCT `P0002`
 * the RPC raises after a 0-row UPDATE, plus a `23503` (FK) backstop — so the
 * user sees "this meal no longer exists", never "check your values".
 *
 * PII discipline: maps by `error.code` (SQLSTATE) only; logs only the typed
 * `kind` — never the PostgrestError message/details, the payload, or the id.
 */
import { callMealRpc } from '@/features/capture/lib/meal-rpc';
import type { SavePayload } from '@/features/capture/lib/meal-form';

const RPC_TIMEOUT_MS = 20_000;

/** `not_found` = the meal was deleted before Save; `network` is the only transient. */
export type UpdateMealErrorKind =
  | 'unauthorized'
  | 'invalid'
  | 'not_found'
  | 'network'
  | 'unknown';

export type UpdateMealResult = { ok: true } | { ok: false; kind: UpdateMealErrorKind };

/** Map a SQLSTATE to a typed kind. The RPC raises explicit errcodes (B2). */
function classifyCode(code: string | undefined): UpdateMealErrorKind {
  switch (code) {
    case 'P0002': // our explicit "meal not found" raise (0-row UPDATE).
    case '23503': // foreign_key_violation — parent vanished mid-txn; treat as gone.
      return 'not_found';
    case '23514': // check_violation — bad bounds / item count.
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

export async function updateMeal({
  id,
  payload,
}: {
  id: string;
  payload: SavePayload;
}): Promise<UpdateMealResult> {
  // `image_path` rides along in `payload.log` but the RPC never reads it (harmless).
  const outcome = await callMealRpc(
    'update_meal_log',
    { p_id: id, p_log: payload.log, p_items: payload.items },
    { timeoutMs: RPC_TIMEOUT_MS },
  );

  if (outcome.status === 'network') return { ok: false, kind: 'network' };

  if (outcome.status === 'error') {
    const kind = classifyCode(outcome.code);
    // Log ONLY the typed kind — never the PostgrestError message/details (PII).
    console.warn('[updateMeal] failed:', kind);
    return { ok: false, kind };
  }

  return { ok: true };
}
