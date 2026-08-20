# ADR 0003 — AI provider (photo → nutrition)

- **Status**: Accepted
- **Date**: 2026-06-23
- **Supersedes**: the AI-model sub-decision of [ADR 0001 — Tech stack](0001-tech-stack.md)

## Context
ADR 0001 chose "Claude vision" for the photo → nutrition step, but that was an
early assumption made before any model was integrated. The actual choice evolved
during implementation of the `analyze-meal` Edge Function (plan 0008), and the code
is now the source of truth. This ADR records the current decision and the path to it
so the docs stop disagreeing with the code.

## Decision
The `analyze-meal` Edge Function calls **OpenAI's `gpt-4o-mini` vision model** with
Structured Outputs, forcing a JSON response matching `MealAnalysis`. The key is the
Edge Function secret `OPENAI_API_KEY`; the phone never calls OpenAI directly.

**Source of truth (verify against these, not the prose):**
- Model: `supabase/functions/analyze-meal/openai.ts` → `const MODEL = "gpt-4o-mini"`
- Endpoint: `https://api.openai.com/v1/chat/completions`
- Secret: `supabase/functions/analyze-meal/index.ts` → `Deno.env.get("OPENAI_API_KEY")`

## How we got here
1. **Claude vision** — the initial assumption in ADR 0001 (2026-06-14), never built.
2. **Gemini 2.5 Flash** — chosen at kickoff/step 1 (≈7–35× cheaper than Claude for
   this workload, strong vision, free dev tier). Built as the first `analyze-meal`
   implementation.
3. **OpenAI `gpt-4o-mini`** — switched mid-execution of plan 0008 (2026-06-23). The
   user already held an OpenAI account with billing, and — decisively — OpenAI's API
   **does not train on submitted data by default**, which resolved the free-Gemini-tier
   privacy risk (B5) for health-adjacent meal photos without a "which tier?" footgun.
   OpenAI Structured Outputs gave an equivalent strict-schema guarantee. The switch was
   provider-agnostic by design: only `gemini.ts → openai.ts`, the response-schema
   format, and the secret name changed — the `MealAnalysis` contract, the DB, the
   client helper, and the Capture screen were untouched.

## Why not the alternatives
- **Gemini 2.5 Flash** — cheapest, but the free tier's data-retention/training terms
  are a poor fit for health data, and paid-tier gating was an easy misconfiguration.
- **Claude vision** — capable, but more expensive for this high-volume, low-complexity
  extraction, and we already had OpenAI billing in hand.
- **`gpt-4o` (full)** — higher quality but pricier; `gpt-4o-mini` is the cost/quality
  pick for MVP. Bumping to `gpt-4o` remains a one-line change if accuracy proves weak.

## Consequences
- The privacy policy must disclose that meal photos + nutrition are sent to **OpenAI**
  (handled in `src/features/legal/privacy-content.ts`, with the no-training claim
  attributed + date-anchored, not self-guaranteed).
- The phone must never hold the OpenAI key — it stays an Edge Function secret.
- If the model or provider changes again, update the code first, then supersede this
  ADR (do not edit it in place) and add a new dated JOURNAL entry.
