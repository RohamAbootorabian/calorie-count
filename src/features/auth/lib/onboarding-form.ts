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
export function parseNumber(raw: string): number {
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

/**
 * Metric→imperial reverse converters (plan 0006 B1) — EXACT inverses of the
 * forward helpers above (no internal rounding; the UI rounds at the display
 * edge). Storage stays canonical metric; these exist only to DISPLAY a stored
 * value in imperial. Because they're exact inverses, a value never drifts unless
 * the user actually edits the field.
 */
export function cmToInches(cm: number): number {
  return cm / 2.54;
}

export function kgToPounds(kg: number): number {
  return kg / 0.45359237;
}

/** Display/edit units for body metrics. Storage is ALWAYS metric (N4). */
export type Units = 'metric' | 'imperial';

/**
 * Round a metric value to its display string in the active units (plan 0006 B1).
 * Display-only rounding — height to 1 decimal (cm or in), weight to nearest whole
 * (lb) / 1 decimal (kg). The canonical metric value is never mutated by this.
 */
export function heightToDisplay(heightCm: number, units: Units): string {
  const value = units === 'imperial' ? cmToInches(heightCm) : heightCm;
  return String(Math.round(value * 10) / 10);
}

export function weightToDisplay(weightKg: number, units: Units): string {
  if (units === 'imperial') return String(Math.round(kgToPounds(weightKg)));
  return String(Math.round(weightKg * 10) / 10);
}

/**
 * Unit-aware bounded validator (plan 0006 B2). In imperial the raw value is in
 * display units; it's converted to metric and checked against the SAME metric
 * bounds — so a value valid in one unit stays valid after a unit toggle — but the
 * copy is rendered in the shown unit. The displayed bounds are rounded INWARD
 * (min up, max down) so any value within the quoted range always passes, and a
 * rejected value is always truly outside the quoted range.
 */
function validateUnitAware(
  raw: string,
  units: Units,
  metricMin: number,
  metricMax: number,
  metricNoun: string,
  imperialNoun: string,
  toMetric: (n: number) => number,
  fromMetric: (n: number) => number,
): string | undefined {
  const noun = units === 'imperial' ? imperialNoun : metricNoun;
  if (!raw.trim()) return `Enter your ${noun}.`;
  const value = parseNumber(raw);
  if (!Number.isFinite(value)) return `Enter a valid ${noun}.`;
  const metric = units === 'imperial' ? toMetric(value) : value;
  if (metric < metricMin || metric > metricMax) {
    const min = units === 'imperial' ? Math.ceil(fromMetric(metricMin) * 10) / 10 : metricMin;
    const max = units === 'imperial' ? Math.floor(fromMetric(metricMax) * 10) / 10 : metricMax;
    return `Enter a ${noun} between ${min} and ${max}.`;
  }
  return undefined;
}

export function validateHeight(raw: string, units: Units): string | undefined {
  return validateUnitAware(
    raw,
    units,
    HEIGHT_CM_MIN,
    HEIGHT_CM_MAX,
    'height (cm)',
    'height (in)',
    inchesToCm,
    cmToInches,
  );
}

export function validateWeight(raw: string, units: Units): string | undefined {
  return validateUnitAware(
    raw,
    units,
    WEIGHT_KG_MIN,
    WEIGHT_KG_MAX,
    'weight (kg)',
    'weight (lb)',
    poundsToKg,
    kgToPounds,
  );
}

/**
 * Parse a validated display-unit body value back to metric for storage/compute
 * (plan 0006 B1/B2). Call ONLY after `validateHeight`/`validateWeight` passed.
 * In metric it's an identity parse; in imperial it converts in→cm / lb→kg.
 */
export function heightToMetric(raw: string, units: Units): number {
  const value = parseNumber(raw);
  return units === 'imperial' ? inchesToCm(value) : value;
}

export function weightToMetric(raw: string, units: Units): number {
  const value = parseNumber(raw);
  return units === 'imperial' ? poundsToKg(value) : value;
}
