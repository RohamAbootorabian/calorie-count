/**
 * Best-effort delete of an abandoned meal photo from the private `meal-photos`
 * bucket (plan 0011 — Layer 1, client delete-on-abandon).
 *
 * The orphan is born exactly when a user abandons an uploaded-but-unsaved photo
 * (fresh re-pick, or "Choose another"). We delete it there using the existing
 * owner-scoped DELETE policy (`(storage.foldername(name))[1] = auth.uid()`) — no
 * service role, no migration.
 *
 * Contract:
 *   - **Fire-and-forget** (`Promise<void>`): callers never await-block the UI and
 *     never inspect the outcome. A failure (offline, race, expired session) is
 *     swallowed — the scheduled server sweep (Layer 2) is the backstop.
 *   - **Never throws.** Any error is caught and logged as a typed outcome only.
 *   - **PII discipline:** never log the path; only `err.message` / a status code
 *     (Storage error objects can carry the path).
 *   - The caller is responsible for the do-not-delete guard (never call this for a
 *     path a save was initiated for) — see `capture-screen.tsx`'s `savedPath` ref.
 */
import { supabase } from '@/lib/supabase';

import { MEAL_PHOTOS_BUCKET } from './storage';

export async function deleteMealPhoto(path: string): Promise<void> {
  try {
    const { error } = await supabase.storage.from(MEAL_PHOTOS_BUCKET).remove([path]);
    if (error) {
      // Best-effort: the sweep reaps it later. Log message only, never the path.
      console.warn('[deleteMealPhoto] remove failed', error.message);
    }
  } catch (err) {
    console.warn(
      '[deleteMealPhoto] remove threw',
      err instanceof Error ? err.message : 'unknown',
    );
  }
}
