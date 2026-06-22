/**
 * Gemini 2.5 Flash (vision) call — request builder, raw REST, robust parsing
 * (plan 0008). No SDK: a single `fetch` keeps the dependency surface at zero.
 *
 * DATA TIER (plan B5): this MUST run against a paid / billing-enabled Gemini
 * tier (or Vertex AI). Meal photos are health-adjacent PII; Google's FREE
 * `generativelanguage` tier may retain images and use them to improve products
 * (training), whereas the paid tier carries the no-training / no-retention-for-
 * training commitment. See Google's API data-use terms. (Tracked privacy-policy
 * obligation: the policy must disclose meal photos + derived nutrition go to
 * Google for analysis.)
 *
 * Robustness (plan B3): we check `finishReason === "STOP"` and null-guard the
 * whole candidate / promptFeedback chain BEFORE reading any text, so a
 * truncated (`MAX_TOKENS`), empty, or SAFETY-blocked response degrades to a
 * typed `bad_ai_response` instead of throwing a `TypeError` → 500.
 */

import {
  coerceMealAnalysis,
  GEMINI_RESPONSE_SCHEMA,
  type MealAnalysis,
} from "./meal-analysis.ts";

const MODEL = "gemini-2.5-flash";
const ENDPOINT =
  `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

// Comfortably above a max-length analysis (capped items + per-item nutrients +
// factors + assumptions) so a normal result never truncates (B3/B4).
const MAX_OUTPUT_TOKENS = 8192;

const PROMPT =
  "You are a nutrition estimator. From this meal photo, identify each food " +
  "item and estimate, per item: portion (free text), estimated grams, and " +
  "nutrients — calories (kcal), protein (g), carbs (g), fat (g), sugar (g), " +
  "fiber (g), and sodium in MILLIGRAMS. Also give the overall dish name, your " +
  "confidence (low | medium | high), a 0–100 food-quality score with short " +
  "factor strings (e.g. \"high protein\", \"high sugar\"), and any assumptions " +
  "the user should confirm (e.g. \"assumed cooked in oil\"). Use metric units; " +
  "sodium in mg. If the image contains NO food (text, a menu, a non-food " +
  "scene), return an EMPTY items array rather than inventing items. If unsure, " +
  "LOWER your confidence rather than inventing precision.";

/** Gemini-specific outcomes. `timeout`/`network` are caller-abort vs. transport. */
export type GeminiResult =
  | { ok: true; analysis: MealAnalysis }
  | {
    ok: false;
    kind: "bad_ai_response" | "rate_limited" | "timeout" | "network" | "unknown";
  };

interface GeminiArgs {
  apiKey: string;
  base64: string;
  mimeType: string;
  /** Aborted by the caller's timeout AbortController (plan B4). */
  signal: AbortSignal;
}

export async function analyzeWithGemini(
  { apiKey, base64, mimeType, signal }: GeminiArgs,
): Promise<GeminiResult> {
  const body = {
    contents: [
      {
        parts: [
          { text: PROMPT },
          { inlineData: { mimeType, data: base64 } },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      responseMimeType: "application/json",
      responseSchema: GEMINI_RESPONSE_SCHEMA,
    },
  };

  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Key as a header, NEVER a `?key=` query param that could land in a log.
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (_e) {
    // Our timeout AbortController aborts → typed `timeout`; anything else is
    // transport. We deliberately do NOT log the error object (no upstream PII).
    return { ok: false, kind: signal.aborted ? "timeout" : "network" };
  }

  if (!res.ok) {
    // Drain the body so the connection is freed, but NEVER log it (may echo
    // request content). Map status → typed kind.
    await res.body?.cancel();
    if (res.status === 429) return { ok: false, kind: "rate_limited" };
    if (res.status === 400 || res.status === 403) {
      // API_KEY_INVALID / PERMISSION_DENIED — key rejected. Permanent server
      // fault (copy = "service unavailable"), distinct from a MISSING key.
      console.error(`gemini key rejected (status ${res.status})`);
      return { ok: false, kind: "unknown" };
    }
    if (res.status >= 500) return { ok: false, kind: "network" }; // transient
    console.error(`gemini unexpected status ${res.status}`);
    return { ok: false, kind: "unknown" };
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return { ok: false, kind: "bad_ai_response" };
  }

  const text = extractText(json);
  if (text === null) return { ok: false, kind: "bad_ai_response" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, kind: "bad_ai_response" };
  }

  return { ok: true, analysis: coerceMealAnalysis(parsed) };
}

/**
 * Pull the model's JSON text out of the response, or null if anything is off:
 * a non-STOP finishReason (MAX_TOKENS truncation, SAFETY, RECITATION, OTHER), a
 * prompt-level block, or any missing link in the candidate chain. Fully
 * null-guarded so a malformed shape can never throw (B3).
 */
function extractText(json: unknown): string | null {
  const root = json as {
    candidates?: Array<{
      finishReason?: string;
      content?: { parts?: Array<{ text?: string }> };
    }>;
    promptFeedback?: { blockReason?: string };
  };

  // A prompt-level block (e.g. SAFETY on the request) → no usable candidate.
  if (root?.promptFeedback?.blockReason) return null;

  const candidate = root?.candidates?.[0];
  if (!candidate) return null;
  // A SAFETY block on a *food* photo is almost always spurious → treat as a bad
  // AI response (retryable, bounded), not a real "no food" signal.
  if (candidate.finishReason && candidate.finishReason !== "STOP") return null;

  const text = candidate.content?.parts?.[0]?.text;
  return typeof text === "string" && text.length > 0 ? text : null;
}
