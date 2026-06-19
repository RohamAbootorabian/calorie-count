/**
 * Pure TDEE → daily calorie + macro targets. No I/O, no React, no logging
 * (PII discipline SF4) — fully unit-testable via the `npx tsx` reference script.
 *
 * `computeGoals` ALWAYS takes normalized metric (age yr, cm, kg) — the UI converts
 * imperial at the edge and the DB only ever stores metric (N4). The computation
 * order is strict so the macros-sum-to-calories invariant holds and nothing can go
 * negative/NaN (plan 0005 B3):
 *   1. BMR (Mifflin–St Jeor)
 *   2. TDEE = BMR × activity multiplier
 *   3. goal adjustment (lose/maintain/gain)
 *   4. clamp to the 1200 kcal floor, then round calories to nearest 10
 *   5. macros from the clamped/rounded calories; carbs absorbs all rounding
 */

export type Sex = 'male' | 'female';
export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';
export type WeightGoal = 'lose' | 'maintain' | 'gain';

/** Normalized metric inputs — the only shape `computeGoals` accepts (N4). */
export type MetricInput = {
  age: number; // years
  sex: Sex;
  heightCm: number;
  weightKg: number;
  activityLevel: ActivityLevel;
  weightGoal: WeightGoal;
};

export type ComputedGoals = {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  /** Intermediate, surfaced for transparency/debugging only — never persisted. */
  bmr: number;
  tdee: number;
  /** True when the calorie target was raised to the safe floor (shown on Review, N5). */
  clampedToMinimum: boolean;
};

/** Harris/Mifflin activity multipliers. */
const ACTIVITY_MULTIPLIER: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

/** Calorie adjustment by intent. */
const GOAL_MULTIPLIER: Record<WeightGoal, number> = {
  lose: 0.8,
  maintain: 1.0,
  gain: 1.15,
};

/** Lowest daily calorie target we'll ever write (safety floor, B3/Edge). */
export const MIN_CALORIES = 1200;

const PROTEIN_G_PER_KG = 1.8;
const FAT_FRACTION_OF_CALORIES = 0.25;
const KCAL_PER_G_PROTEIN = 4;
const KCAL_PER_G_CARB = 4;
const KCAL_PER_G_FAT = 9;

function assertFinitePositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    // No PII: `label` is a field name, never the rejected value (SF4).
    throw new Error(`tdee: ${label} must be a finite positive number`);
  }
}

/**
 * Compute daily calorie + macro targets from metric body inputs. Throws on any
 * non-finite / non-positive input or output (defense in depth against the
 * Postgres NaN trap; the form already blocks this).
 */
export function computeGoals(input: MetricInput): ComputedGoals {
  const { age, sex, heightCm, weightKg, activityLevel, weightGoal } = input;

  assertFinitePositive(age, 'age');
  assertFinitePositive(heightCm, 'heightCm');
  assertFinitePositive(weightKg, 'weightKg');

  const activityMultiplier = ACTIVITY_MULTIPLIER[activityLevel];
  const goalMultiplier = GOAL_MULTIPLIER[weightGoal];
  if (activityMultiplier === undefined) throw new Error('tdee: unknown activityLevel');
  if (goalMultiplier === undefined) throw new Error('tdee: unknown weightGoal');

  // 1. BMR — Mifflin–St Jeor.
  const sexTerm = sex === 'male' ? 5 : -161;
  const bmr = 10 * weightKg + 6.25 * heightCm - 5 * age + sexTerm;

  // 2. TDEE, then 3. goal adjustment.
  const tdee = bmr * activityMultiplier;
  const adjusted = tdee * goalMultiplier;

  // 4. Clamp to the safe floor, then round to nearest 10.
  const clampedToMinimum = adjusted < MIN_CALORIES;
  const calories = Math.round(Math.max(adjusted, MIN_CALORIES) / 10) * 10;

  // 5. Macros from the clamped/rounded calories. Protein scales with body mass,
  // fat is a fixed share of calories, and carbs absorbs all rounding so the
  // 4P+9F+4C ≈ kcal invariant holds and carbs can never go negative.
  const protein = Math.round(PROTEIN_G_PER_KG * weightKg);
  const fat = Math.round((FAT_FRACTION_OF_CALORIES * calories) / KCAL_PER_G_FAT);
  const carbs = Math.max(
    0,
    Math.floor((calories - KCAL_PER_G_PROTEIN * protein - KCAL_PER_G_FAT * fat) / KCAL_PER_G_CARB),
  );

  const result: ComputedGoals = { calories, protein, carbs, fat, bmr, tdee, clampedToMinimum };

  // Defense in depth: never emit NaN/Infinity into a numeric column (B3/B4).
  for (const [key, value] of Object.entries(result)) {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new Error(`tdee: computed ${key} is not finite`);
    }
  }
  return result;
}
