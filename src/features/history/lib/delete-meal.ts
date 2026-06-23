/**
 * Delete a logged meal (plan 0012). Lives in `history/lib` because HISTORY owns
 * the delete *flow*; it reuses `capture/lib/delete-meal-photo.ts` (capture owns
 * the photo helper) for the best-effort blob cleanup.
 *
 * Order — ROW first, PHOTO second:
 *   1. `delete from meal_logs where id = …` — RLS scopes it to the owner
 *      (`auth.uid() = user_id`); `meal_items` is `on delete cascade`, so the
 *      children vanish in the same statement. No manual child delete.
 *   2. ONLY after the row delete succeeds, fire `deleteMealPhoto` best-effort
 *      (not awaited) from this same authed session so it never becomes an orphan.
 *      If it's already gone (0011 sweep), offline, or the path is null, it's
 *      swallowed — the 0011 daily sweep is the backstop. We NEVER delete the
 *      photo before the row is confirmed gone (a failed row-delete leaves it).
 *
 * Idempotent: Supabase `.delete().eq('id', id)` resolves `{ error: null }`
 * whether it matched 0 or 1 rows — `.select()`/count is not needed. A 0-row
 * delete (row already gone on another device) IS success: the user's intent
 * ("this meal should not exist") is satisfied.
 *
 * PII discipline: never log the `id`, `imagePath`, the PostgrestError
 * message/details, or a row count — only the typed `kind` (mirrors `saveMeal`).
 */
import { deleteMealPhoto } from '@/features/capture/lib/delete-meal-photo';
import { supabase } from '@/lib/supabase';

const DELETE_TIMEOUT_MS = 15_000;

export type DeleteMealErrorKind = 'unauthorized' | 'network' | 'unknown';

export type DeleteMealResult = { ok: true } | { ok: false; kind: DeleteMealErrorKind };

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

/** Map a SQLSTATE to a typed kind. RLS rejection / not-authenticated → unauthorized. */
function classifyCode(code: string | undefined): DeleteMealErrorKind {
  switch (code) {
    case '28000': // not authenticated
    case '42501': // insufficient_privilege — RLS rejected the delete.
      return 'unauthorized';
    default:
      return 'unknown';
  }
}

export async function deleteMeal(
  id: string,
  imagePath: string | null,
): Promise<DeleteMealResult> {
  // `.delete()` returns a thenable builder, not a Promise — wrap it so the
  // timeout race typechecks (Promise.resolve adopts the thenable at runtime).
  const invocation = Promise.resolve(supabase.from('meal_logs').delete().eq('id', id));

  let raced: Awaited<typeof invocation> | typeof TIMEOUT;
  try {
    raced = await withTimeout(invocation, DELETE_TIMEOUT_MS);
  } catch {
    // A thrown (vs. returned) error is a transport/fetch failure → transient.
    return { ok: false, kind: 'network' };
  }

  if (raced === TIMEOUT) return { ok: false, kind: 'network' };

  const { error } = raced;
  if (error) {
    const kind = classifyCode((error as { code?: string }).code);
    // Log ONLY the typed kind — never the PostgrestError message/details (PII).
    console.warn('[deleteMeal]', kind);
    return { ok: false, kind };
  }

  // Row gone (0 or 1 matched — both success). Best-effort photo cleanup so it
  // never orphans; not awaited, never throws, swallows a null/already-gone path.
  if (imagePath) void deleteMealPhoto(imagePath);

  console.warn('[deleteMeal]', 'ok');
  return { ok: true };
}
