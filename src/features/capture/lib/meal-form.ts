/**
 * Pure, UI-free editable model for the meal review (plan 0009 — S2 piece 3).
 * Seeds from a `MealAnalysis`, validates each editable field against bounds
 * that MIRROR the DB `check` constraints (initial_schema), recomputes totals
 * live, and builds the `create_meal_log` RPC's jsonb payload.
 *
 * No I/O, no logging (PII discipline) — validators return friendly per-field
 * copy and never echo the rejected value. Mirrors `onboarding-form.ts`: same
 * `parseNumber` (locale-comma tolerant, NaN-rejecting) and bounded-validator
 * shape.
 *
 * v1 edits the headline fields that matter for tracking — dish name + per-item
 * name/calories/protein/carbs/fat — and CARRIES the rest (`portion`,
 * `estimatedGrams`, `sugar`, `fiber`, `sodium`, `confidence`, `quality`,
 * `assumptions`) through unchanged from the analysis (still saved). See the
 * plan's Non-goals (full per-nutrient editing is the named follow-up).
 */
import type { Confidence, MealAnalysis, Nutrients } from '@/types/nutrition';
import { sumNutrients } from '@/types/nutrition';

import { parseNumber } from '@/features/auth/lib/onboarding-form';

// --- Bounds (mirror the meal_logs / meal_items migration check constraints) -
// The ONE client-side source the validators AND the totals-cap check read.
// `sumAndClampTotals` lives in the Deno function and is NOT importable.
export const MAX_CALORIES = 100000;
export const MAX_MACRO = 10000; // protein/carbs/fat/sugar/fiber
export const MAX_SODIUM = 1000000; // mg
export const NAME_MAX = 200;

/** Per-total DB caps — block Save (reject, never clamp) if any total exceeds. */
export const MAX_TOTALS: Nutrients = {
  calories: MAX_CALORIES,
  protein: MAX_MACRO,
  carbs: MAX_MACRO,
  fat: MAX_MACRO,
  sugar: MAX_MACRO,
  fiber: MAX_MACRO,
  sodium: MAX_SODIUM,
};

/**
 * One editable item row. The four edited numeric fields are RAW STRINGS (what
 * the user typed) so a half-cleared field doesn't read as `0`; the carried
 * fields stay numbers (not user-editable in v1, already server-clamped by
 * piece 2 — not re-validated). `id` is a stable React key (assigned at seed;
 * removal filters, never reindexes, so it stays stable).
 */
export type MealItemForm = {
  id: string;
  name: string;
  calories: string;
  protein: string;
  carbs: string;
  fat: string;
  // Carried through unchanged from the analysis:
  portion: string;
  estimatedGrams: number;
  sugar: number;
  fiber: number;
  sodium: number;
};

/** The in-progress review form. Carries the read-only analysis metadata. */
export type MealForm = {
  dishName: string;
  items: MealItemForm[];
  confidence: Confidence;
  quality?: { score: number; factors: string[] };
  assumptions?: string[];
};

/** Round to a tidy input string — integers stay integers, else 1 decimal. */
function numToInput(n: number): string {
  if (!Number.isFinite(n)) return '';
  return String(Math.round(n * 10) / 10);
}

/** Seed an editable form from the AI analysis (dish defaults to "Meal"). */
export function seedFormFromAnalysis(analysis: MealAnalysis): MealForm {
  return {
    dishName: analysis.dishName?.trim() ? analysis.dishName : 'Meal',
    confidence: analysis.confidence,
    quality: analysis.quality
      ? { score: analysis.quality.score, factors: analysis.quality.factors }
      : undefined,
    assumptions: analysis.assumptions,
    items: analysis.items.map((item, i) => ({
      id: String(i),
      name: item.name,
      calories: numToInput(item.nutrients.calories),
      protein: numToInput(item.nutrients.protein),
      carbs: numToInput(item.nutrients.carbs),
      fat: numToInput(item.nutrients.fat),
      portion: item.portion,
      estimatedGrams: item.estimatedGrams,
      sugar: item.nutrients.sugar,
      fiber: item.nutrients.fiber,
      sodium: item.nutrients.sodium,
    })),
  };
}

// --- Validation (mirrors the DB bounds; friendly copy, no value echo) -------

function validateBounded(raw: string, max: number, noun: string): string | undefined {
  if (!raw.trim()) return `Enter ${noun}.`;
  const value = parseNumber(raw);
  if (!Number.isFinite(value)) return `Enter a valid ${noun}.`;
  if (value < 0 || value > max) return `Enter ${noun} between 0 and ${max}.`;
  return undefined;
}

export function validateCalories(raw: string): string | undefined {
  return validateBounded(raw, MAX_CALORIES, 'calories');
}

export function validateMacro(raw: string, noun: string): string | undefined {
  return validateBounded(raw, MAX_MACRO, noun);
}

export function validateItemName(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return 'Enter a name.';
  if (trimmed.length > NAME_MAX) return `Keep the name under ${NAME_MAX} characters.`;
  return undefined;
}

export function validateDishName(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return 'Enter a dish name.';
  if (trimmed.length > NAME_MAX) return `Keep the name under ${NAME_MAX} characters.`;
  return undefined;
}

/** Per-item field errors; an empty object means the item is valid. */
export type ItemErrors = Partial<Record<'name' | 'calories' | 'protein' | 'carbs' | 'fat', string>>;

export function validateItem(item: MealItemForm): ItemErrors {
  const errors: ItemErrors = {};
  const name = validateItemName(item.name);
  if (name) errors.name = name;
  const calories = validateCalories(item.calories);
  if (calories) errors.calories = calories;
  const protein = validateMacro(item.protein, 'protein (g)');
  if (protein) errors.protein = protein;
  const carbs = validateMacro(item.carbs, 'carbs (g)');
  if (carbs) errors.carbs = carbs;
  const fat = validateMacro(item.fat, 'fat (g)');
  if (fat) errors.fat = fat;
  return errors;
}

/** Whole-form validity: dish name + every item field + at least one item. */
export function isFormValid(form: MealForm): boolean {
  if (validateDishName(form.dishName)) return false;
  if (form.items.length === 0) return false;
  return form.items.every((item) => Object.keys(validateItem(item)).length === 0);
}

// --- Totals (display-only; recompute live on every keystroke / remove) ------

/** Parse an editable field for the live total; non-finite reads as 0 here. */
function forTotal(raw: string): number {
  const value = parseNumber(raw);
  return Number.isFinite(value) ? value : 0;
}

/**
 * Recompute the seven meal totals from the surviving items via the shared
 * `sumNutrients` (carried sugar/fiber/sodium included). Display-only — a
 * function of the items, re-summed on every edit and on remove.
 */
export function recomputeTotals(items: MealItemForm[]): Nutrients {
  return sumNutrients(
    items.map((item) => ({
      calories: forTotal(item.calories),
      protein: forTotal(item.protein),
      carbs: forTotal(item.carbs),
      fat: forTotal(item.fat),
      sugar: item.sugar,
      fiber: item.fiber,
      sodium: item.sodium,
    })),
  );
}

/** A total exceeding its DB cap → block Save (reject, never clamp). */
export function totalsWithinCaps(totals: Nutrients): boolean {
  return (Object.keys(MAX_TOTALS) as (keyof Nutrients)[]).every(
    (key) => totals[key] <= MAX_TOTALS[key],
  );
}

// --- Payload (validated form → the RPC's jsonb shape) -----------------------

export type SaveLogPayload = {
  image_path: string | null;
  dish_name: string;
  confidence: Confidence;
  quality_score: number | null;
  quality_factors: string[] | null;
  assumptions: string[] | null;
  total_calories: number;
  total_protein: number;
  total_carbs: number;
  total_fat: number;
  total_sugar: number;
  total_fiber: number;
  total_sodium: number;
};

export type SaveItemPayload = {
  name: string;
  portion: string;
  estimatedGrams: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  sugar: number;
  fiber: number;
  sodium: number;
};

export type SavePayload = {
  log: SaveLogPayload;
  items: SaveItemPayload[];
};

/**
 * Build the RPC payload from a VALIDATED form (call only after `isFormValid` +
 * `totalsWithinCaps`). Every editable field is parsed to a finite number here,
 * so NaN/Infinity can never reach Postgres. Totals are recomputed from the
 * items so a stored total always equals `sum(items)`. `quality_score` is
 * rounded to an int; quality/assumptions pass `null` when absent (B3/SF).
 */
export function toSavePayload(form: MealForm, imagePath: string | null): SavePayload {
  const items: SaveItemPayload[] = form.items.map((item) => ({
    name: item.name.trim(),
    portion: item.portion,
    estimatedGrams: item.estimatedGrams,
    calories: parseNumber(item.calories),
    protein: parseNumber(item.protein),
    carbs: parseNumber(item.carbs),
    fat: parseNumber(item.fat),
    sugar: item.sugar,
    fiber: item.fiber,
    sodium: item.sodium,
  }));

  const totals = recomputeTotals(form.items);

  return {
    log: {
      image_path: imagePath,
      dish_name: form.dishName.trim(),
      confidence: form.confidence,
      quality_score: form.quality ? Math.round(form.quality.score) : null,
      quality_factors: form.quality ? form.quality.factors : null,
      assumptions: form.assumptions ?? null,
      total_calories: totals.calories,
      total_protein: totals.protein,
      total_carbs: totals.carbs,
      total_fat: totals.fat,
      total_sugar: totals.sugar,
      total_fiber: totals.fiber,
      total_sodium: totals.sodium,
    },
    items,
  };
}
