/**
 * Client helper for the `analyze-meal` Edge Function (plan 0008 — S2 piece 2).
 * Mirrors `uploadMealPhoto`'s typed-result shape.
 *
 * Error contract (B1): the function ALWAYS returns HTTP 200 with a JSON body of
 * `{ ok:true, analysis } | { ok:false, kind }`, because `functions.invoke` wraps
 * any non-2xx in a `FunctionsHttpError` and sets `data = null`, which would hide
 * our typed `kind`. So on a 200 we read `data` directly. We only map TRANSPORT
 * failures ourselves: `FunctionsHttpError` (the one real non-2xx is the gateway
 * 401 from `verify_jwt`) → `unauthorized`, `FunctionsFetchError` → `network`, and
 * a client-side `withTimeout` (~35 s, just above the server's 30 s so the
 * server's typed timeout wins when reachable) → `timeout`.
 *
 * PII discipline: never logs the path, analysis, or raw response.
 */
import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';
import type { MealAnalysis } from '@/types/nutrition';

/** Exhaustive union — mirrors the Edge Function's `ErrorKind`. */
export type AnalyzeErrorKind =
  | 'unauthorized'
  | 'not_found'
  | 'no_food'
  | 'bad_ai_response'
  | 'rate_limited'
  | 'too_large'
  | 'timeout'
  | 'network'
  | 'unknown';

export type AnalyzeResult =
  | { ok: true; analysis: MealAnalysis }
  | { ok: false; kind: AnalyzeErrorKind };

const ANALYZE_TIMEOUT_MS = 35_000;

const ERROR_KINDS: ReadonlySet<string> = new Set<AnalyzeErrorKind>([
  'unauthorized',
  'not_found',
  'no_food',
  'bad_ai_response',
  'rate_limited',
  'too_large',
  'timeout',
  'network',
  'unknown',
]);

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

export async function analyzeMeal({ path }: { path: string }): Promise<AnalyzeResult> {
  const invocation = supabase.functions.invoke('analyze-meal', { body: { path } });

  const raced = await withTimeout(invocation, ANALYZE_TIMEOUT_MS);
  if (raced === TIMEOUT) return { ok: false, kind: 'timeout' };

  const { data, error } = raced;

  if (error) {
    // The only expected non-2xx is the gateway 401 (verify_jwt) → re-auth.
    if (error instanceof FunctionsHttpError) {
      const status = error.context?.status;
      return { ok: false, kind: status === 401 ? 'unauthorized' : 'unknown' };
    }
    if (error instanceof FunctionsFetchError) return { ok: false, kind: 'network' };
    return { ok: false, kind: 'unknown' };
  }

  // 200 path: read our typed body directly.
  const body = data as { ok?: unknown; kind?: unknown; analysis?: unknown } | null;
  if (body && body.ok === true && body.analysis) {
    return { ok: true, analysis: body.analysis as MealAnalysis };
  }
  if (body && body.ok === false && typeof body.kind === 'string' && ERROR_KINDS.has(body.kind)) {
    return { ok: false, kind: body.kind as AnalyzeErrorKind };
  }
  return { ok: false, kind: 'unknown' };
}
