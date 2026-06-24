/**
 * Race a promise against a timer (plan 0013 — extracted so the signed-URL minter
 * and the upload/delete helpers don't each carry their own copy).
 *
 * Resolves to the promise's value, or the `TIMEOUT` sentinel if it doesn't settle
 * within `ms`. NOTE: this does NOT abort the underlying request (the storage-js
 * calls expose no abort signal in this version); a stall simply surfaces as
 * `TIMEOUT` so callers can treat it as a transient failure instead of hanging.
 */
export const TIMEOUT = Symbol('timeout');

export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
): Promise<T | typeof TIMEOUT> {
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
