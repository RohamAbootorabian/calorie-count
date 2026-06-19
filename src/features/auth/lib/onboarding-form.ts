/**
 * Pure form model for the onboarding wizard: metric input bounds, per-step
 * field validators, and an imperial→metric conversion helper. No UI, no I/O, no
 * logging (PII discipline SF4) — validators return friendly per-field copy and
 * never echo the rejected value.
 *
 * Bounds MIRROR the DB `check` constraints (migration B4) so a form the client
 * accepts is never rejected by Postgres, and vice versa.
 */
import type {
  ActivityLevel,
  MetricInput,
  Sex,
  WeightGoal,
} from './tdee';

// --- Bounds (mirror the goals migration check constraints) ------------------
export const AGE_MIN = 13;
export const AGE_MAX = 120;
export const HEIGHT_CM_MIN = 50;
export const HEIGHT_CM_MAX = 272;
export const WEIGHT_KG_MIN = 20;
export const WEIGHT_KG_MAX = 500;

// --- Selectable options (label lives in the UI; these are the stored values) -
export const SEX_OPTIONS: { value: Sex; label: string }[] = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
];

export const ACTIVITY_OPTIONS: { value: ActivityLevel; label: string; hint: string }[] = [
  { value: 'sedentary', label: 'Sedentary', hint: 'Little or no exercise' },
  { value: 'light', label: 'Lightly active', hint: 'Light exercise 1–3 days/week' },
  { value: 'moderate', label: 'Moderately active', hint: 'Moderate exercise 3–5 days/week' },
  { value: 'active', label: 'Active', hint: 'Hard exercise 6–7 days/week' },
  { value: 'very_active', label: 'Very active', hint: 'Physical job or 2× training' },
];

export const GOAL_OPTIONS: { value: WeightGoal; label: string; hint: string }[] = [
  { value: 'lose', label: 'Lose weight', hint: 'Calorie deficit' },
  { value: 'maintain', label: 'Maintain weight', hint: 'Stay where you are' },
  { value: 'gain', label: 'Gain weight', hint: 'Calorie surplus' },
];

/**
 * The in-progress wizard state. Numeric fields are raw strings (what the user
 * typed) so a half-entered field doesn't read as 0; selections are typed unions
 * or undefined until chosen. Metric-only inputs for v1 (storage is always
 * metric; imperial display defers to piece 3).
 */
export type OnboardingForm = {
  age: string;
  sex?: Sex;
  heightCm: string;
  weightKg: string;
  activityLevel?: ActivityLevel;
  weightGoal?: WeightGoal;
};

export const EMPTY_FORM: OnboardingForm = {
  age: '',
  sex: undefined,
  heightCm: '',
  weightKg: '',
  activityLevel: undefined,
  weightGoal: undefined,
};

/** Parse a user-typed number, tolerating a locale comma; returns NaN if unusable. */
function parseNumber(raw: string): number {
  const normalized = raw.trim().replace(',', '.');
  if (!normalized) return Number.NaN;
  return Number(normalized);
}

function validateBoundedNumber(
  raw: string,
  min: number,
  max: number,
  noun: string,
): string | undefined {
  if (!raw.trim()) return `Enter your ${noun}.`;
  const value = parseNumber(raw);
  if (!Number.isFinite(value)) return `Enter a valid ${noun}.`;
  if (value < min || value > max) return `Enter a ${noun} between ${min} and ${max}.`;
  return undefined;
}

export function validateAge(raw: string): string | undefined {
  return validateBoundedNumber(raw, AGE_MIN, AGE_MAX, 'age');
}

export function validateHeightCm(raw: string): string | undefined {
  return validateBoundedNumber(raw, HEIGHT_CM_MIN, HEIGHT_CM_MAX, 'height (cm)');
}

export function validateWeightKg(raw: string): string | undefined {
  return validateBoundedNumber(raw, WEIGHT_KG_MIN, WEIGHT_KG_MAX, 'weight (kg)');
}

/** Field-level errors for a step; empty object means the step is valid. */
export type StepErrors = Partial<Record<keyof OnboardingForm, string>>;

/** The wizard's step identifiers, in order. */
export const STEPS = ['about', 'body', 'activity', 'goal', 'review'] as const;
export type Step = (typeof STEPS)[number];

/**
 * Validate a single step. Returns field-level errors (empty → step passes).
 * `review` has nothing to validate (it shows computed numbers).
 */
export function validateStep(step: Step, form: OnboardingForm): StepErrors {
  switch (step) {
    case 'about': {
      const errors: StepErrors = {};
      const ageError = validateAge(form.age);
      if (ageError) errors.age = ageError;
      if (!form.sex) errors.sex = 'Select an option.';
      return errors;
    }
    case 'body': {
      const errors: StepErrors = {};
      const heightError = validateHeightCm(form.heightCm);
      if (heightError) errors.heightCm = heightError;
      const weightError = validateWeightKg(form.weightKg);
      if (weightError) errors.weightKg = weightError;
      return errors;
    }
    case 'activity':
      return form.activityLevel ? {} : { activityLevel: 'Select an option.' };
    case 'goal':
      return form.weightGoal ? {} : { weightGoal: 'Select an option.' };
    case 'review':
      return {};
  }
}

/**
 * Convert a fully-validated form into the metric input `computeGoals` expects.
 * Call ONLY after every step validated — the non-null assertions hold because
 * the wizard gates the Review step behind validation of all prior steps.
 */
export function toMetricInput(form: OnboardingForm): MetricInput {
  return {
    age: parseNumber(form.age),
    sex: form.sex!,
    heightCm: parseNumber(form.heightCm),
    weightKg: parseNumber(form.weightKg),
    activityLevel: form.activityLevel!,
    weightGoal: form.weightGoal!,
  };
}

/**
 * Imperial→metric conversion helper (N4). The v1 input UI is metric-only, but
 * this is the single source of truth for piece 3's units editing so the
 * conversion contract is fixed now and never reinvented.
 */
export function inchesToCm(inches: number): number {
  return inches * 2.54;
}

export function poundsToKg(pounds: number): number {
  return pounds * 0.45359237;
}
