/**
 * First-run onboarding wizard (plan 0005). A single screen with an in-memory step
 * state machine (NOT separate routes) that collects body metrics + intent,
 * computes daily calorie + macro targets via `computeGoals`, and upserts the
 * `goals` row. On success it calls the shared `useOnboardingStatus().refetch()`,
 * which flips the root gate to `(app)` — this screen never navigates manually.
 *
 * PII discipline (SF4): no age/sex/height/weight or BMR/TDEE is ever logged;
 * validation shows per-field copy, never the rejected value. The gate can unmount
 * this screen the instant onboarding completes or the user signs out, so the
 * post-`await` setState in Save is guarded by `mounted` (SF6).
 *
 * Selection controls (sex/activity/goal) reuse `Button` as full-width selectable
 * rows — selected = primary, unselected = secondary — no new primitive (SF3).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useUser } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { Button, Card, Input, Screen, Text } from '@/shared/ui';

import {
  ACTIVITY_OPTIONS,
  EMPTY_FORM,
  GOAL_OPTIONS,
  SEX_OPTIONS,
  STEPS,
  toMetricInput,
  validateStep,
  type OnboardingForm,
  type Step,
  type StepErrors,
} from '../lib/onboarding-form';
import { computeGoals, type ComputedGoals } from '../lib/tdee';
import { useOnboardingStatus } from '../lib/use-onboarding-status';

export function OnboardingWizard() {
  const { user } = useUser();
  const { refetch } = useOnboardingStatus();

  // The gate can unmount us the instant Save succeeds; guard post-await setState.
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const [stepIndex, setStepIndex] = useState(0);
  const [form, setForm] = useState<OnboardingForm>(EMPTY_FORM);
  const [errors, setErrors] = useState<StepErrors>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();

  const step: Step = STEPS[stepIndex];
  const isLast = stepIndex === STEPS.length - 1;

  // Computed only on the Review step, where every prior step has validated.
  // Guarded so a formula throw surfaces as a friendly error, never a crash.
  const computed = useMemo<ComputedGoals | undefined>(() => {
    if (step !== 'review') return undefined;
    try {
      return computeGoals(toMetricInput(form));
    } catch {
      return undefined;
    }
  }, [step, form]);

  function update<K extends keyof OnboardingForm>(key: K, value: OnboardingForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    // Clear that field's error as the user fixes it (piece-1 style).
    setErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));
    setSaveError(undefined);
  }

  function handleNext() {
    const stepErrors = validateStep(step, form);
    setErrors(stepErrors);
    if (Object.values(stepErrors).some(Boolean)) return;
    if (!isLast) setStepIndex((i) => i + 1);
  }

  function handleBack() {
    setErrors({});
    setSaveError(undefined);
    if (stepIndex > 0) setStepIndex((i) => i - 1);
  }

  async function handleSave() {
    // Null-guard the user id (N6) — the upsert's WITH CHECK is the real boundary.
    if (!user?.id) {
      setSaveError('You appear to be signed out. Please sign in again.');
      return;
    }
    let goals: ComputedGoals;
    try {
      goals = computeGoals(toMetricInput(form));
    } catch {
      setSaveError("We couldn't compute your targets. Please review your inputs.");
      return;
    }

    const metric = toMetricInput(form);
    setSaving(true);
    setSaveError(undefined);

    // Upsert (not insert) → a retry is idempotent, never a duplicate row (B5/SF6).
    const { error } = await supabase.from('goals').upsert(
      {
        user_id: user.id,
        calories: goals.calories,
        protein: goals.protein,
        carbs: goals.carbs,
        fat: goals.fat,
        weight_goal: metric.weightGoal,
        activity_level: metric.activityLevel,
        age: metric.age,
        sex: metric.sex,
        height_cm: metric.heightCm,
        weight_kg: metric.weightKg,
      },
      { onConflict: 'user_id' },
    );

    if (!mounted.current) return; // gate may have unmounted us on success/sign-out
    if (error) {
      setSaveError("We couldn't save your goals. Please try again.");
      setSaving(false);
      return;
    }
    // Flip the shared gate to (app). Keep `saving` true through the unmount so the
    // button can't be re-pressed in the brief window before the gate swaps us out.
    refetch();
  }

  return (
    <Screen scroll>
      <View style={styles.header}>
        <Text type="small" themeColor="textSecondary">
          Step {stepIndex + 1} of {STEPS.length}
        </Text>
        <Text type="subtitle">{STEP_TITLE[step]}</Text>
        {STEP_SUBTITLE[step] ? (
          <Text type="small" themeColor="textSecondary">
            {STEP_SUBTITLE[step]}
          </Text>
        ) : null}
      </View>

      <View style={styles.body}>
        {step === 'about' ? (
          <>
            <Input
              label="Age"
              value={form.age}
              onChangeText={(t) => update('age', t)}
              keyboardType="number-pad"
              inputMode="numeric"
              error={errors.age}
            />
            <SelectGroup
              label="Sex"
              error={errors.sex}
              options={SEX_OPTIONS}
              value={form.sex}
              onSelect={(v) => update('sex', v)}
            />
          </>
        ) : null}

        {step === 'body' ? (
          <>
            <Input
              label="Height (cm)"
              value={form.heightCm}
              onChangeText={(t) => update('heightCm', t)}
              keyboardType="decimal-pad"
              inputMode="decimal"
              error={errors.heightCm}
            />
            <Input
              label="Weight (kg)"
              value={form.weightKg}
              onChangeText={(t) => update('weightKg', t)}
              keyboardType="decimal-pad"
              inputMode="decimal"
              error={errors.weightKg}
            />
          </>
        ) : null}

        {step === 'activity' ? (
          <SelectGroup
            label="How active are you?"
            error={errors.activityLevel}
            options={ACTIVITY_OPTIONS}
            value={form.activityLevel}
            onSelect={(v) => update('activityLevel', v)}
          />
        ) : null}

        {step === 'goal' ? (
          <SelectGroup
            label="What's your goal?"
            error={errors.weightGoal}
            options={GOAL_OPTIONS}
            value={form.weightGoal}
            onSelect={(v) => update('weightGoal', v)}
          />
        ) : null}

        {step === 'review' ? (
          <ReviewCard computed={computed} />
        ) : null}

        {saveError ? (
          <Text type="small" themeColor="danger">
            {saveError}
          </Text>
        ) : null}
      </View>

      <View style={styles.footer}>
        {stepIndex > 0 ? (
          <View style={styles.footerButton}>
            <Button variant="secondary" onPress={handleBack} disabled={saving} fullWidth>
              Back
            </Button>
          </View>
        ) : null}
        <View style={styles.footerButton}>
          {isLast ? (
            <Button onPress={handleSave} loading={saving} disabled={!computed} fullWidth>
              Save & continue
            </Button>
          ) : (
            <Button onPress={handleNext} fullWidth>
              Next
            </Button>
          )}
        </View>
      </View>
    </Screen>
  );
}

/** Full-width selectable rows built from `Button` (SF3 — no new primitive). */
function SelectGroup<T extends string>({
  label,
  error,
  options,
  value,
  onSelect,
}: {
  label: string;
  error?: string;
  options: { value: T; label: string; hint?: string }[];
  value: T | undefined;
  onSelect: (value: T) => void;
}) {
  return (
    <View style={styles.group}>
      <Text type="smallBold" themeColor="textSecondary">
        {label}
      </Text>
      {options.map((option) => (
        <Button
          key={option.value}
          variant={value === option.value ? 'primary' : 'secondary'}
          onPress={() => onSelect(option.value)}
          fullWidth>
          {option.hint ? `${option.label} — ${option.hint}` : option.label}
        </Button>
      ))}
      {error ? (
        <Text type="small" themeColor="danger">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

/** Review step: the computed daily targets + a clamp note when floored (N5). */
function ReviewCard({ computed }: { computed: ComputedGoals | undefined }) {
  if (!computed) {
    return (
      <Text type="small" themeColor="danger">
        We couldn&apos;t compute your targets. Go back and check your inputs.
      </Text>
    );
  }
  return (
    <Card>
      <Text type="smallBold" themeColor="textSecondary">
        Your daily targets
      </Text>
      <View style={styles.reviewRows}>
        <ReviewRow label="Calories" value={`${computed.calories} kcal`} />
        <ReviewRow label="Protein" value={`${computed.protein} g`} />
        <ReviewRow label="Carbs" value={`${computed.carbs} g`} />
        <ReviewRow label="Fat" value={`${computed.fat} g`} />
      </View>
      {computed.clampedToMinimum ? (
        <Text type="small" themeColor="textSecondary">
          We raised your calories to a safe minimum of {computed.calories} kcal/day.
        </Text>
      ) : null}
    </Card>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.reviewRow}>
      <Text type="default">{label}</Text>
      <Text type="default">{value}</Text>
    </View>
  );
}

const STEP_TITLE: Record<Step, string> = {
  about: 'About you',
  body: 'Your body',
  activity: 'Activity level',
  goal: 'Your goal',
  review: 'Review',
};

const STEP_SUBTITLE: Record<Step, string> = {
  about: 'This sets your baseline metabolic rate.',
  body: 'Height and weight, in metric units.',
  activity: 'Pick the option closest to a typical week.',
  goal: 'We adjust your calories to match.',
  review: 'Here are the targets we computed for you.',
};

const styles = StyleSheet.create({
  header: {
    gap: Spacing.one,
    marginBottom: Spacing.four,
  },
  body: {
    flex: 1,
    gap: Spacing.three,
  },
  group: {
    gap: Spacing.two,
  },
  reviewRows: {
    marginTop: Spacing.two,
    gap: Spacing.two,
  },
  reviewRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  footer: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginTop: Spacing.four,
  },
  footerButton: {
    flex: 1,
  },
});
