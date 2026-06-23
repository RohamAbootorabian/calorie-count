/**
 * OpenAI (GPT-4o vision) call — request builder, raw REST, robust parsing
 * (plan 0008; provider switched from Gemini, see the plan's Execution log).
 * No SDK: a single `fetch` keeps the dependency surface at zero.
 *
 * DATA PRIVACY (resolves B5): the OpenAI **API does not train on submitted data
 * by default** (an API-wide default, not a special tier), so meal photos
 * (health-adjacent PII) are not used to improve models. (Tracked privacy-policy
 * obligation: the policy must disclose that meal photos + derived nutrition are
 * sent to OpenAI for analysis.)
 *
 * Robustness (B3): we require `finish_reason === "stop"` and null-guard the
 * whole choice/message chain BEFORE reading content, and treat a model
 * `refusal` as a bad response — so a truncated (`length`), filtered
 * (`content_filter`), refused, or malformed reply degrades to a typed
 * `bad_ai_response` instead of throwing.
 */

import {
  coerceMealAnalysis,
  type MealAnalysis,
  OPENAI_RESPONSE_SCHEMA,
} from "./meal-analysis.ts";

// gpt-4o-mini: cheap, vision-capable, supports Structured Outputs (mirrors the
// "flash" intent). Bump to "gpt-4o" if estimation quality proves weak.
const MODEL = "gpt-4o-mini";
const ENDPOINT = "https://api.openai.com/v1/chat/completions";

// Comfortably above a max-length analysis (capped items + per-item nutrients +
// factors + assumptions) so a normal result never truncates (B3/B4).
const MAX_TOKENS = 8192;

const SYSTEM_PROMPT =
  "You are a nutrition estimator. Analyse the meal photo and return ONLY data " +
  "matching the provided JSON schema. For each food item give a free-text " +
  "portion, estimated grams, and nutrients — calories (kcal), protein (g), " +
  "carbs (g), fat (g), sugar (g), fiber (g), and sodium in MILLIGRAMS. Also " +
  "give the overall dish name, your confidence (low | medium | high), a 0–100 " +
  "food-quality score with short factor strings (e.g. \"high protein\", \"high " +
  "sugar\"), and any assumptions the user should confirm. Use metric units; " +
  "sodium in mg. If the image contains NO food (text, a menu, a non-food " +
  "scene), return an EMPTY items array rather than inventing items. If unsure, " +
  "LOWER your confidence rather than inventing precision.";

const USER_PROMPT = "Analyse this meal photo.";

/** OpenAI-specific outcomes. `timeout`/`network` are caller-abort vs. transport. */
export type OpenAIResult =
  | { ok: true; analysis: MealAnalysis }
  | {
    ok: false;
    kind: "bad_ai_response" | "rate_limited" | "timeout" | "network" | "unknown";
  };

interface OpenAIArgs {
  apiKey: string;
  base64: string;
  mimeType: string;
  /** Aborted by the caller's timeout AbortController (plan B4). */
  signal: AbortSignal;
}

export async function analyzeWithOpenAI(
  { apiKey, base64, mimeType, signal }: OpenAIArgs,
): Promise<OpenAIResult> {
  const body = {
    model: MODEL,
    temperature: 0.2,
    max_tokens: MAX_TOKENS,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: USER_PROMPT },
          {
            type: "image_url",
            image_url: { url: `data:${mimeType};base64,${base64}`, detail: "auto" },
          },
        ],
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "meal_analysis",
        strict: true,
        schema: OPENAI_RESPONSE_SCHEMA,
      },
    },
  };

  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (_e) {
    // Our timeout AbortController aborts → typed `timeout`; else transport.
    // The error object is never logged (no upstream PII).
    return { ok: false, kind: signal.aborted ? "timeout" : "network" };
  }

  if (!res.ok) {
    await res.body?.cancel(); // free the connection; NEVER log the body.
    // 429 also covers `insufficient_quota` — surface as "busy, try later".
    if (res.status === 429) return { ok: false, kind: "rate_limited" };
    if (res.status === 401 || res.status === 403) {
      // Key rejected. Permanent server fault (copy = "service unavailable"),
      // distinct from a MISSING key. Value never logged.
      console.error(`openai key rejected (status ${res.status})`);
      return { ok: false, kind: "unknown" };
    }
    if (res.status >= 500) return { ok: false, kind: "network" }; // transient
    console.error(`openai unexpected status ${res.status}`);
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
 * a non-`stop` finish_reason (`length` truncation, `content_filter`), a model
 * `refusal`, or any missing link in the choice/message chain. Fully
 * null-guarded so a malformed shape can never throw (B3).
 */
function extractText(json: unknown): string | null {
  const root = json as {
    choices?: Array<{
      finish_reason?: string;
      message?: { content?: string | null; refusal?: string | null };
    }>;
  };

  const choice = root?.choices?.[0];
  if (!choice) return null;
  // A model refusal (safety) → not usable; treat as bad response (bounded retry).
  if (choice.message?.refusal) return null;
  if (choice.finish_reason && choice.finish_reason !== "stop") return null;

  const content = choice.message?.content;
  return typeof content === "string" && content.length > 0 ? content : null;
}
