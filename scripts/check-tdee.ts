/**
 * One-off reference checks for `src/features/auth/lib/tdee.ts`.
 *
 * No test framework exists yet (plan 0005 OQ5) — run these hand-computed cases
 * directly during the verify step:
 *
 *   npx tsx scripts/check-tdee.ts
 *
 * Exits non-zero on the first failed assertion so CI/local can gate on it.
 */
import { computeGoals, MIN_CALORIES, type MetricInput } from '../src/features/auth/lib/tdee';

let failures = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${label}: got ${String(actual)}, expected ${String(expected)}`);
}

function checkApprox(label: string, actual: number, expected: number, tol: number): void {
  const ok = Math.abs(actual - expected) <= tol;
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${label}: got ${actual}, expected ~${expected} (±${tol})`);
}

function expectThrow(label: string, fn: () => unknown): void {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  if (!threw) failures += 1;
  console.log(`${threw ? 'PASS' : 'FAIL'} — ${label}: ${threw ? 'threw as expected' : 'did NOT throw'}`);
}

// --- Case 1: 30yo male, 180cm, 80kg, moderate, maintain ---------------------
// BMR = 10*80 + 6.25*180 - 5*30 + 5 = 1780; TDEE = 1780*1.55 = 2759;
// maintain ×1.0 = 2759 → round/10 → 2760.
{
  const g = computeGoals({
    age: 30, sex: 'male', heightCm: 180, weightKg: 80,
    activityLevel: 'moderate', weightGoal: 'maintain',
  });
  check('case1 calories', g.calories, 2760);
  check('case1 protein', g.protein, 144); // round(1.8*80)
  check('case1 fat', g.fat, 77); // round(0.25*2760/9)
  check('case1 clampedToMinimum', g.clampedToMinimum, false);
  checkApprox('case1 macro-sum ≈ calories', 4 * g.protein + 9 * g.fat + 4 * g.carbs, g.calories, 4);
  check('case1 carbs ≥ 0', g.carbs >= 0, true);
}

// --- Case 2: goal adjustment (same body, lose vs gain) ----------------------
{
  const lose = computeGoals({
    age: 30, sex: 'male', heightCm: 180, weightKg: 80,
    activityLevel: 'moderate', weightGoal: 'lose',
  });
  const gain = computeGoals({
    age: 30, sex: 'male', heightCm: 180, weightKg: 80,
    activityLevel: 'moderate', weightGoal: 'gain',
  });
  check('case2 lose calories', lose.calories, 2210); // round(2759*0.8/10)*10
  check('case2 gain calories', gain.calories, 3170); // round(2759*1.15/10)*10
  check('case2 lose < gain', lose.calories < gain.calories, true);
}

// --- Case 3: 1200 floor fires for a small user ------------------------------
// 20yo female, 150cm, 45kg, sedentary, lose → adjusted ≈ 1081 < 1200.
{
  const g = computeGoals({
    age: 20, sex: 'female', heightCm: 150, weightKg: 45,
    activityLevel: 'sedentary', weightGoal: 'lose',
  });
  check('case3 calories floored', g.calories, MIN_CALORIES);
  check('case3 clampedToMinimum', g.clampedToMinimum, true);
  check('case3 protein', g.protein, 81); // round(1.8*45)
  checkApprox('case3 macro-sum ≈ calories', 4 * g.protein + 9 * g.fat + 4 * g.carbs, g.calories, 4);
  check('case3 carbs ≥ 0', g.carbs >= 0, true);
}

// --- Case 4: female sex term differs from male ------------------------------
{
  const male = computeGoals({
    age: 30, sex: 'male', heightCm: 170, weightKg: 70,
    activityLevel: 'light', weightGoal: 'maintain',
  });
  const female = computeGoals({
    age: 30, sex: 'female', heightCm: 170, weightKg: 70,
    activityLevel: 'light', weightGoal: 'maintain',
  });
  check('case4 male > female (sex term)', male.calories > female.calories, true);
}

// --- Case 5: bad inputs throw rather than emit NaN --------------------------
const base: MetricInput = {
  age: 30, sex: 'male', heightCm: 180, weightKg: 80,
  activityLevel: 'moderate', weightGoal: 'maintain',
};
expectThrow('age 0 throws', () => computeGoals({ ...base, age: 0 }));
expectThrow('negative height throws', () => computeGoals({ ...base, heightCm: -1 }));
expectThrow('NaN weight throws', () => computeGoals({ ...base, weightKg: Number.NaN }));
expectThrow('Infinity height throws', () => computeGoals({ ...base, heightCm: Number.POSITIVE_INFINITY }));

console.log(`\n${failures === 0 ? 'ALL PASS ✓' : `${failures} FAILURE(S) ✗`}`);
process.exit(failures === 0 ? 0 : 1);
