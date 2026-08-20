/**
 * `analyze-meal` Edge Function (plan 0008, S2 piece 2).
 *
 * Realises the core architecture rule: the phone NEVER calls OpenAI. Given a
 * Storage `{ path }` from a signed-in user, this:
 *   1. verifies the caller (JWT → `getUser()`; the anon key is itself a valid
 *      JWT, so `getUser()` — not `verify_jwt` — is the real anonymous gate),
 *   2. confirms ownership by reading the image through the CALLER'S client so
 *      the bucket RLS (`foldername[1] = auth.uid()`) is the load-bearing
 *      authorization (never the regex; we never use the service-role key),
 *   3. bounds per-user daily cost (B6), downloads the bytes, calls OpenAI
 *      (GPT-4o-mini vision) with structured output, validates/coerces the JSON
 *      into a `MealAnalysis`, and returns it.
 *
 * ERROR CONTRACT (B1): this ALWAYS returns HTTP 200 with `{ ok, kind }` for
 * app-level outcomes, because `supabase.functions.invoke` wraps any non-2xx in a
 * `FunctionsHttpError` with `data = null`, hiding our typed `kind`. (The one real
 * non-2xx is `verify_jwt`'s gateway 401, which the client maps to `unauthorized`.)
 *
 * LOGGING DISCIPLINE: SAFE = error kind, status, coarse timing. FORBIDDEN =
 * path/uid, the Authorization header/JWT, photo bytes/base64, any signed URL,
 * the parsed MealAnalysis (health data), and the raw OpenAI response body.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encodeBase64 } from "jsr:@std/encoding@1/base64";

import { corsHeaders, handlePreflight } from "../_shared/cors.ts";
import { analyzeWithOpenAI } from "./openai.ts";
import { isNoFood } from "./meal-analysis.ts";

const BUCKET = "meal-photos";
const MAX_BYTES = 10 * 1024 * 1024; // matches the bucket's 10 MB cap.
const DOWNLOAD_TIMEOUT_MS = 15_000; // → `network`
const AI_TIMEOUT_MS = 30_000; //      → `timeout` (client withTimeout is ~35 s)
const DAILY_CAP = 50; // analyses per user per day (B6). Tune from real usage.

/** Exhaustive typed outcomes (mirrors the client helper's union). */
type ErrorKind =
  | "unauthorized"
  | "not_found"
  | "no_food"
  | "bad_ai_response"
  | "rate_limited"
  | "too_large"
  | "timeout"
  | "network"
  | "unknown";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXT_BY_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
};

function json(origin: string | null, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
  });
}

function fail(origin: string | null, kind: ErrorKind): Response {
  return json(origin, { ok: false, kind });
}

/** Race a promise against a timer; resolves to TIMEOUT if it stalls. */
const TIMEOUT = Symbol("timeout");
async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | typeof TIMEOUT> {
  let timer: ReturnType<typeof setTimeout>;
  const t = new Promise<typeof TIMEOUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMEOUT), ms);
  });
  try {
    return await Promise.race([p, t]);
  } finally {
    clearTimeout(timer!);
  }
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  const origin = req.headers.get("Origin");
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: corsHeaders(origin),
    });
  }

  try {
    // --- Config (server-only secrets) -------------------------------------
    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!openaiKey) {
      console.error("missing OPENAI_API_KEY"); // value never logged.
      return fail(origin, "unknown");
    }
    if (!supabaseUrl || !anonKey) {
      console.error("missing SUPABASE_URL / SUPABASE_ANON_KEY");
      return fail(origin, "unknown");
    }

    // --- Identify caller (anon key + forwarded Authorization, RLS-scoped) --
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData } = await supabase.auth.getUser();
    const uid = userData.user?.id;
    // No uid → anon key alone, or a valid token for a deleted user.
    if (!uid || !UUID_RE.test(uid)) return fail(origin, "unauthorized");

    // --- Parse + cost-guard pre-check (NOT authorization) -----------------
    let body: { path?: unknown };
    try {
      body = await req.json();
    } catch {
      return fail(origin, "not_found"); // unreadable body → no valid path.
    }
    const path = typeof body.path === "string" ? body.path : "";
    // Shape: `<uid>/<name>.<jpg|jpeg|png>`, first segment === caller uid.
    const match = path.match(/^([^/]+)\/[^/]+\.(jpg|jpeg|png)$/i);
    if (!match || match[1] !== uid) return fail(origin, "not_found");
    const mimeType = EXT_BY_MIME[match[2].toLowerCase()];

    // --- Download bytes through the caller's client (RLS = authorization) -
    const downloaded = await withTimeout(
      supabase.storage.from(BUCKET).download(path),
      DOWNLOAD_TIMEOUT_MS,
    );
    if (downloaded === TIMEOUT) return fail(origin, "network");
    const { data: blob, error: dlError } = downloaded;
    // RLS makes "not owned" and "missing" indistinguishable → one not_found.
    if (dlError || !blob) return fail(origin, "not_found");

    const buffer = await blob.arrayBuffer();
    if (buffer.byteLength === 0) return fail(origin, "not_found");
    if (buffer.byteLength > MAX_BYTES) return fail(origin, "too_large");

    // --- Daily cost cap, charged just before the paid call (B6) -----------
    const { data: usageCount, error: usageError } = await supabase.rpc(
      "bump_analyze_usage",
      { p_limit: DAILY_CAP },
    );
    if (usageError) {
      console.error("bump_analyze_usage failed");
      return fail(origin, "unknown");
    }
    // NULL → already at/over the cap (the rpc didn't increment).
    if (usageCount === null) return fail(origin, "rate_limited");

    // --- Call OpenAI with its own abort-timeout (B4) ----------------------
    const base64 = encodeBase64(new Uint8Array(buffer));
    const controller = new AbortController();
    const aiTimer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
    let result;
    try {
      result = await analyzeWithOpenAI({
        apiKey: openaiKey,
        base64,
        mimeType,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(aiTimer);
    }

    if (!result.ok) return fail(origin, result.kind);

    // Empty / degenerate result → typed `no_food` (plan Q4).
    if (isNoFood(result.analysis)) return fail(origin, "no_food");

    return json(origin, { ok: true, analysis: result.analysis });
  } catch (err) {
    // Catch-all: log OUR typed message only — never the upstream/PII payload.
    console.error("analyze-meal error:", err instanceof Error ? err.message : "unknown");
    return fail(origin, "unknown");
  }
});
