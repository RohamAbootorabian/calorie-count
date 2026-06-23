/**
 * `cleanup-orphans` Edge Function (plan 0011, Layer 2 — the scheduled backstop).
 *
 * Deletes meal photos that the client delete-on-abandon (Layer 1) missed
 * (force-close / crash / sign-out mid-flow): objects in the private
 * `meal-photos` bucket that are (a) NOT referenced by any
 * `meal_logs.image_path` and (b) older than a grace window. It uses the
 * SERVICE ROLE (bypasses RLS) and the Storage API `.remove()` — required
 * because raw `delete from storage.objects` is BLOCKED on this project
 * (`protect_objects_delete` trigger) and would orphan the S3 blob anyway (B4).
 *
 * SAFETY — the whole design fails CLOSED (B2). A degraded saved-paths read
 * aborts the run deleting nothing; a per-folder list error skips that folder;
 * a circuit-breaker aborts if a run would delete an implausible share; and the
 * first production cycle runs in DRY_RUN (observe-only) until proven sane.
 *
 * AUTH — not user-invoked (`verify_jwt = false`); a shared `x-cleanup-secret`
 * header is the gate, plus a DB-side claim (single-run lock + rate-limit). The
 * cron job sends this header via a live Vault subquery (B3), never a baked secret.
 *
 * LOGGING DISCIPLINE: counts only — never a path, uid, the secret, or an object
 * name. On Storage/DB errors log `err.message` / a code, never the error object.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BUCKET = "meal-photos";
/** A photo younger than this (from upload) is never an orphan — covers an open
 *  review. Hard invariant: max review-open duration < grace (SF). */
const GRACE_PERIOD_HOURS = 72;
/** Storage `list` caps at 100; we page both levels to completion (SF). */
const LIST_PAGE = 100;
/** `.remove()` batch size, matched to paging (SF). */
const DELETE_BATCH = 100;
/** Circuit breaker (B2): a correct sweep deletes a trickle. Abort a run that
 *  would delete more than ABS objects OR more than PCT of those scanned. */
const BREAKER_ABS = 500;
const BREAKER_PCT = 0.5;
const BREAKER_MIN_SCANNED = 20; // don't apply the % rule to tiny buckets.
/** Reject invocations closer together than this (rate-limit + single-run lock). */
const MIN_INTERVAL_SECONDS = 600;

/** Build the service-role client. Aliased via the factory's return type so the
 *  helpers below take the exact call-site type (createClient's overloads make a
 *  bare `ReturnType<typeof createClient>` diverge from the real instance). */
function makeServiceClient(url: string, key: string) {
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
type DbClient = ReturnType<typeof makeServiceClient>;

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  const startedAtMs = Date.now(); // single server clock for the whole run.

  // --- AuthN: shared secret (never logged) ---------------------------------
  const secret = Deno.env.get("CLEANUP_SECRET");
  if (!secret || req.headers.get("x-cleanup-secret") !== secret) {
    console.warn("cleanup-orphans: 401 bad secret");
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  // --- Config (service role bypasses RLS) ----------------------------------
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    console.error("cleanup-orphans: missing SUPABASE_URL / SERVICE_ROLE_KEY");
    return json({ ok: false, error: "misconfigured" }, 500);
  }
  // Observe-only unless explicitly turned live (B2): default (unset) = DRY RUN.
  const dryRun = Deno.env.get("CLEANUP_DRY_RUN") !== "false";

  const supabase = makeServiceClient(supabaseUrl, serviceKey);

  // --- Single-run lock + rate-limit (SF) -----------------------------------
  // Atomic DB-side claim; false → another run is too recent / overlapping.
  const { data: claimed, error: claimErr } = await supabase.rpc(
    "claim_cleanup_run",
    { p_min_interval_seconds: MIN_INTERVAL_SECONDS },
  );
  if (claimErr) {
    console.error("cleanup-orphans: claim failed", claimErr.message);
    return json({ ok: false, error: "claim_failed" }, 500);
  }
  if (claimed !== true) {
    console.warn("cleanup-orphans: 429 rate-limited (claim denied)");
    return json({ ok: false, error: "rate_limited" }, 429);
  }

  // --- Saved-paths reference set: FAIL CLOSED on any degraded read (B2) -----
  const { data: savedRows, error: savedErr } = await supabase
    .from("meal_logs")
    .select("image_path")
    .not("image_path", "is", null);
  if (savedErr || savedRows == null) {
    // An empty/errored read must NEVER be treated as "everything is an orphan".
    console.error(
      "cleanup-orphans: ABORT — saved-paths read failed",
      savedErr?.message ?? "null result",
    );
    return json({ ok: false, error: "saved_read_failed" }, 500);
  }
  const savedSet = new Set<string>(
    savedRows
      .map((r) => (r as { image_path: string | null }).image_path)
      .filter((p): p is string => typeof p === "string" && p.length > 0),
  );

  const cutoffMs = startedAtMs - GRACE_PERIOD_HOURS * 3_600_000;

  // --- Enumerate uid folders (page the TOP level too — SF) -----------------
  let folders: string[];
  try {
    folders = await listFolders(supabase);
  } catch (err) {
    console.error(
      "cleanup-orphans: ABORT — top-level list failed",
      err instanceof Error ? err.message : "unknown",
    );
    return json({ ok: false, error: "list_failed" }, 500);
  }

  // --- Collect orphan candidates, with per-folder containment (B2) ---------
  let scanned = 0;
  let skippedFolders = 0;
  const orphanPaths: string[] = [];
  for (const uid of folders) {
    let objects: StorageObject[];
    try {
      objects = await listObjects(supabase, uid);
    } catch (err) {
      // Containment: a folder we can't read cleanly is left untouched, never
      // treated as all-orphan. Count it; don't abort the whole run.
      skippedFolders += 1;
      console.warn(
        "cleanup-orphans: skipped a folder (list error)",
        err instanceof Error ? err.message : "unknown",
      );
      continue;
    }
    for (const obj of objects) {
      scanned += 1;
      // Reconstruct the byte-identical `{uid}/{name}` key — never compare bare
      // name (a prefix/slash mismatch would misclassify a saved photo) (SF).
      const key = `${uid}/${obj.name}`;
      if (savedSet.has(key)) continue;
      const createdMs = Date.parse(obj.created_at ?? "");
      // Fail-safe KEEP on any missing/ambiguous timestamp (SF).
      if (!Number.isFinite(createdMs)) continue;
      if (createdMs < cutoffMs) orphanPaths.push(key);
    }
  }

  // --- Circuit breaker (B2) ------------------------------------------------
  const tooMany =
    orphanPaths.length > BREAKER_ABS ||
    (scanned >= BREAKER_MIN_SCANNED &&
      orphanPaths.length > scanned * BREAKER_PCT);
  if (tooMany) {
    console.error(
      `cleanup-orphans: ABORT — circuit breaker (orphaned=${orphanPaths.length} scanned=${scanned})`,
    );
    return json(
      { ok: false, error: "circuit_breaker", scanned, orphaned: orphanPaths.length },
      500,
    );
  }

  // --- Observe-only first rollout (B2) -------------------------------------
  if (dryRun) {
    console.log(
      `cleanup-orphans: DRY RUN — scanned=${scanned} wouldDelete=${orphanPaths.length} skippedFolders=${skippedFolders}`,
    );
    return json({
      ok: true,
      dryRun: true,
      scanned,
      orphaned: orphanPaths.length,
      deleted: 0,
      skippedFolders,
    });
  }

  // --- Delete in batches; TOCTOU re-check per batch (SF) -------------------
  let deleted = 0;
  for (let i = 0; i < orphanPaths.length; i += DELETE_BATCH) {
    const batch = orphanPaths.slice(i, i + DELETE_BATCH);
    let toRemove: string[];
    try {
      toRemove = await dropNowSaved(supabase, batch);
    } catch (err) {
      // A failed re-check means we can't prove these are still orphans → skip
      // this batch (fail closed), don't delete blindly.
      console.warn(
        "cleanup-orphans: skipped a batch (recheck failed)",
        err instanceof Error ? err.message : "unknown",
      );
      continue;
    }
    if (toRemove.length === 0) continue;
    const { data, error } = await supabase.storage.from(BUCKET).remove(toRemove);
    if (error) {
      // Eventually-consistent: one bad batch never fails the whole run.
      console.warn("cleanup-orphans: batch remove error", error.message);
      continue;
    }
    deleted += data?.length ?? 0;
  }

  console.log(
    `cleanup-orphans: scanned=${scanned} orphaned=${orphanPaths.length} deleted=${deleted} skippedFolders=${skippedFolders}`,
  );
  return json({ ok: true, dryRun: false, scanned, orphaned: orphanPaths.length, deleted, skippedFolders });
});

// --- helpers ---------------------------------------------------------------

type StorageObject = { name: string; id: string | null; created_at: string | null };

/** Page `list('')` to completion; a folder is an entry with a null `id`. */
async function listFolders(supabase: DbClient): Promise<string[]> {
  const names: string[] = [];
  for (let offset = 0; ; offset += LIST_PAGE) {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .list("", { limit: LIST_PAGE, offset, sortBy: { column: "name", order: "asc" } });
    if (error) throw new Error(error.message);
    const page = (data ?? []) as StorageObject[];
    for (const entry of page) {
      if (entry.id === null) names.push(entry.name); // folder (prefix)
    }
    if (page.length < LIST_PAGE) break; // last page
  }
  return names;
}

/** Page `list('{uid}')` to completion; return only objects (non-null id). */
async function listObjects(supabase: DbClient, uid: string): Promise<StorageObject[]> {
  const objects: StorageObject[] = [];
  for (let offset = 0; ; offset += LIST_PAGE) {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .list(uid, { limit: LIST_PAGE, offset, sortBy: { column: "name", order: "asc" } });
    if (error) throw new Error(error.message);
    const page = (data ?? []) as StorageObject[];
    for (const entry of page) {
      if (entry.id !== null) objects.push(entry); // real object, not a sub-prefix
    }
    if (page.length < LIST_PAGE) break;
  }
  return objects;
}

/** TOCTOU guard: re-query the saved set for exactly these paths and drop any
 *  that became referenced since the initial read. */
async function dropNowSaved(supabase: DbClient, batch: string[]): Promise<string[]> {
  const { data, error } = await supabase
    .from("meal_logs")
    .select("image_path")
    .in("image_path", batch);
  if (error) throw new Error(error.message);
  const nowSaved = new Set<string>(
    (data ?? [])
      .map((r) => (r as { image_path: string | null }).image_path)
      .filter((p): p is string => typeof p === "string"),
  );
  return batch.filter((p) => !nowSaved.has(p));
}
