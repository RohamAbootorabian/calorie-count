/**
 * Shared CORS for Edge Functions (plan 0008).
 *
 * Web calls (`supabase.functions.invoke` from Expo web) are cross-origin, so the
 * browser sends a preflight `OPTIONS` and enforces the response's CORS headers.
 * Native (iOS/Android) fetch does NOT enforce CORS, so this only gates the web
 * surface — but we still pin an allow-list rather than `*` because this endpoint
 * handles health-adjacent data (B-fix: CORS pinned to known origins, not `*`).
 *
 * Allow-headers are limited to what supabase-js actually sends: `Authorization`
 * (the caller JWT), `apikey` (the anon key), and `Content-Type` (JSON body).
 */

/**
 * Exact origins permitted to call our functions from a browser.
 * - Expo web dev defaults to `http://localhost:8081` (and the 127.0.0.1 alias).
 * - The production web origin is filled in once it exists (TODO before web prod).
 * An Origin not on this list gets no ACAO header → the browser blocks the
 * response, while native (no Origin header) is unaffected.
 */
const ALLOWED_ORIGINS = new Set<string>([
  "http://localhost:8081",
  "http://127.0.0.1:8081",
  // "https://app.example.com", // TODO: add the production web origin here.
]);

/** CORS headers for a given request Origin (echoes only allow-listed origins). */
export function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

/** Handle a CORS preflight; returns a 204 Response for OPTIONS, else null. */
export function handlePreflight(req: Request): Response | null {
  if (req.method !== "OPTIONS") return null;
  return new Response(null, {
    status: 204,
    headers: corsHeaders(req.headers.get("Origin")),
  });
}
