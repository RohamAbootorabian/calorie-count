/**
 * Pure helpers for MANUAL (custom) calorie + macro targets (plan 0035). No UI, no
 * I/O, no logging (validators never echo the rejected value — PII discipline N4).
 *
 * Targets are stored in `goals` (`calories` INTEGER 0–20000; `protein/carbs/fat`
 * NUMERIC 0–5000). We require WHOLE numbers for all four (calories is an integer
 * column — a decimal would be silently rounded by Postgres, drifting stored ≠ typed;
 * macros are kept integer for a clean round-trip too) and strip grouping separators
 * so "2,200" / "2 200" parse as 2200 rather than 2.2 (the single-comma `parseNumber`
 * would mangle a thousands separator).
 */

export const CAL_MIN = 1;
export const CAL_MAX = 20000; // mirrors the DB check on goals.calories.
export const MACRO_MIN = 0;
export const MACRO_MAX = 5000; // mirrors the DB check on goals.protein/carbs/fat.

/** Parse a target input: strip grouping separators/whitespace → number (NaN if unusable). */
export function parseTarget(raw: string): number {
  const cleaned = raw.replace(/[\s,]/g, '');
  if (!cleaned) return Number.NaN;
  return Number(cleaned);
}

function validateWholeInRange(
  raw: string,
  min: number,
  max: number,
  noun: string,
): string | undefined {
  if (!raw.trim()) return `Enter your ${noun}.`;
  const value = parseTarget(raw);
  if (!Number.isFinite(value)) return `Enter a valid ${noun}.`;
  if (!Number.isInteger(value)) return `Enter whole ${noun} (no decimals).`;
  if (value < min || value > max) return `Enter a ${noun} between ${min} and ${max}.`;
  return undefined;
}

export function validateTargetCalories(raw: string): string | undefined {
  return validateWholeInRange(raw, CAL_MIN, CAL_MAX, 'calories');
}

/** `noun` is the macro name for copy, e.g. "protein (g)". */
export function validateTargetMacro(raw: string, noun: string): string | undefined {
  return validateWholeInRange(raw, MACRO_MIN, MACRO_MAX, noun);
}
