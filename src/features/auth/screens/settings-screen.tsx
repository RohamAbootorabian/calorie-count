/**
 * Profile & Settings screen (plan 0006) — closes S1. Three independent sections
 * on one scrollable Screen:
 *   1. Profile — display_name, units (metric/imperial), timezone (read-only + heal).
 *   2. Daily goals — inline editor that recomputes calories/macros via computeGoals
 *      and upserts the goals row (same write shape as the wizard, B5/SF6).
 *   3. Sign out — moved here off Home.
 *
 * IMPERIAL ROUND-TRIP SAFETY (B1): the goals editor keeps the DB METRIC values as
 * the single source of truth (`canonicalBody`). Height/weight fields display
 * converted+rounded values; on save we convert back to metric ONLY for fields the
 * user actually edited (dirty refs) — unedited fields persist the stored metric
 * verbatim, so a save never drifts the canonical value. A unit toggle re-derives
 * the display strings from canonical and never writes back.
 *
 * VALIDATION (B2) runs in the active display units via the shared unit-aware
 * validators; a unit toggle clears height/weight errors so bounds/copy always
 * match what's on screen.
 *
 * SAVES are INDEPENDENT per section (SF3): separate buttons + in-flight state +
 * error; neither blocks the other. PII discipline (N4): never log the name or any
 * body metric; validators return generic copy. Post-await setState is guarded by a
 * mounted ref (SF2/SF6) since sign-out can unmount us mid-save.
 */
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useAuth, useUser } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/database';
import { Button, Card, Input, Screen, Text } from '@/shared/ui';

import {
  ACTIVITY_OPTIONS,
  GOAL_OPTIONS,
  SEX_OPTIONS,
  heightToDisplay,
  heightToMetric,
  parseNumber,
  validateAge,
  validateHeight,
  validateWeight,
  weightToDisplay,
  weightToMetric,
  type Units,
} from '../lib/onboarding-form';
import {
  getDeviceTimezone,
  normalizeDisplayName,
  timezoneDisplay,
  validateDisplayName,
} from '../lib/profile-form';
import { computeGoals, type ActivityLevel, type ComputedGoals, type MetricInput, type Sex, type WeightGoal } from '../lib/tdee';
import { useProfile } from '../lib/use-profile';

type GoalsRow = Database['public']['Tables']['goals']['Row'];

/**
 * One-shot goals fetch (single consumer; we update local state after save, so no
 * refetch needed). Mirrors use-profile's mounted/active guards so a sign-out
 * mid-fetch can't setState-after-unmount.
 */
function useGoalsRow(): { loading: boolean; row: GoalsRow | null; error: boolean } {
  const { user } = useUser();
  const userId = user?.id ?? null;

  // Keyed to the user it came from, so a stale answer never renders and the
  // no-user case is derived (not setState-in-effect) — same shape as use-profile.
  type Outcome =
    | { userId: string; kind: 'ok'; row: GoalsRow | null }
    | { userId: string; kind: 'error' };
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    supabase
      .from('goals')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active || !mounted.current) return;
        setOutcome(error ? { userId, kind: 'error' } : { userId, kind: 'ok', row: data ?? null });
      });
    return () => {
      active = false;
    };
  }, [userId]);

  return useMemo(() => {
    if (!userId) return { loading: false, row: null, error: false };
    const fresh = outcome?.userId === userId ? outcome : null;
    if (!fresh) return { loading: true, row: null, error: false };
    if (fresh.kind === 'error') return { loading: false, row: null, error: true };
    return { loading: false, row: fresh.row, error: false };
  }, [userId, outcome]);
}

export function SettingsScreen() {
  const router = useRouter();
  const { user } = useUser();
  const { signOut } = useAuth();
  const { profile, loading: profileLoading, refetch: refetchProfile } = useProfile();
  const goals = useGoalsRow();

  // Sign-out can unmount us the instant any save resolves; guard post-await setState.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // --- Profile section state -------------------------------------------------
  const [displayName, setDisplayName] = useState('');
  const [units, setUnits] = useState<Units>('metric');
  const [timezone, setTimezone] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string>();
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState<string>();
  const [profileSaved, setProfileSaved] = useState(false);

  // Seed the profile form whenever a fresh row arrives (updated_at changes after a
  // save → re-seed with server truth; stable during editing so edits aren't clobbered).
  const seededProfileAt = useRef<string | null>(null);
  useEffect(() => {
    if (!profile || seededProfileAt.current === profile.updated_at) return;
    seededProfileAt.current = profile.updated_at;
    setDisplayName(profile.display_name ?? '');
    setUnits(profile.units === 'imperial' ? 'imperial' : 'metric');
    setTimezone(profile.timezone ?? null);
  }, [profile]);

  // --- Goals section state ---------------------------------------------------
  // Unit-independent fields edit directly; height/weight are display strings over
  // the canonical metric source of truth (B1).
  const [age, setAge] = useState('');
  const [sex, setSex] = useState<Sex>();
  const [activityLevel, setActivityLevel] = useState<ActivityLevel>();
  const [weightGoal, setWeightGoal] = useState<WeightGoal>();
  const [canonicalBody, setCanonicalBody] = useState<{
    heightCm: number | null;
    weightKg: number | null;
  } | null>(null);
  // Height/weight EDIT OVERRIDES (B1): null = not edited this session → the field
  // DISPLAYS the canonical metric value converted to the active units (derived in
  // render, never stored back); a non-null string = the user's typed value. A unit
  // toggle / save resets these to null so the display re-derives from canonical and
  // an unedited value never drifts. Deriving in render (vs. a setState-in-effect)
  // keeps both the canonical source-of-truth and the project's lint rules happy.
  const [heightEdit, setHeightEdit] = useState<string | null>(null);
  const [weightEdit, setWeightEdit] = useState<string | null>(null);

  // The strings actually shown in the inputs: the edit override, else canonical→display.
  const heightInput =
    heightEdit ?? (canonicalBody?.heightCm != null ? heightToDisplay(canonicalBody.heightCm, units) : '');
  const weightInput =
    weightEdit ?? (canonicalBody?.weightKg != null ? weightToDisplay(canonicalBody.weightKg, units) : '');

  const [goalErrors, setGoalErrors] = useState<{
    age?: string;
    sex?: string;
    height?: string;
    weight?: string;
    activityLevel?: string;
    weightGoal?: string;
  }>({});
  const [goalsSaving, setGoalsSaving] = useState(false);
  const [goalsError, setGoalsError] = useState<string>();
  const [goalsSaved, setGoalsSaved] = useState(false);

  // Seed the unit-independent goal fields once the row loads.
  const seededGoals = useRef(false);
  useEffect(() => {
    if (goals.loading || seededGoals.current || !goals.row) return;
    seededGoals.current = true;
    const row = goals.row;
    setAge(row.age != null ? String(row.age) : '');
    setSex((row.sex as Sex) ?? undefined);
    setActivityLevel(row.activity_level as ActivityLevel);
    setWeightGoal(row.weight_goal as WeightGoal);
    setCanonicalBody({ heightCm: row.height_cm, weightKg: row.weight_kg });
  }, [goals.loading, goals.row]);

  // Build the metric input for computeGoals from current state, or null if any
  // field is missing/invalid. Unedited height/weight use the canonical metric
  // verbatim; edited ones convert from the displayed value (B1).
  const metricInput = useMemo<MetricInput | null>(() => {
    if (!sex || !activityLevel || !weightGoal) return null;
    if (validateAge(age) || validateHeight(heightInput, units) || validateWeight(weightInput, units)) {
      return null;
    }
    const heightCm = heightEdit !== null ? heightToMetric(heightInput, units) : canonicalBody?.heightCm;
    const weightKg = weightEdit !== null ? weightToMetric(weightInput, units) : canonicalBody?.weightKg;
    if (heightCm == null || weightKg == null) return null;
    return { age: parseNumber(age), sex, heightCm, weightKg, activityLevel, weightGoal };
  }, [
    age,
    sex,
    activityLevel,
    weightGoal,
    heightInput,
    weightInput,
    units,
    canonicalBody,
    heightEdit,
    weightEdit,
  ]);

  const computed = useMemo<ComputedGoals | undefined>(() => {
    if (!metricInput) return undefined;
    try {
      return computeGoals(metricInput);
    } catch {
      return undefined;
    }
  }, [metricInput]);

  // --- Profile handlers ------------------------------------------------------
  function changeName(text: string) {
    setDisplayName(text);
    setNameError(undefined);
    setProfileError(undefined);
    setProfileSaved(false);
  }

  function changeUnits(next: Units) {
    if (next === units) return;
    setUnits(next); // re-labels + re-derives the goals editor's displayed values live.
    // B1: a toggle re-derives from canonical and never writes back — drop unsaved
    // body edits. B2: clear height/weight errors so bounds/copy match the new unit.
    setHeightEdit(null);
    setWeightEdit(null);
    setGoalErrors((prev) => ({ ...prev, height: undefined, weight: undefined }));
    setProfileSaved(false);
  }

  function useDeviceTimezone() {
    const tz = getDeviceTimezone();
    if (tz) {
      setTimezone(tz);
      setProfileError(undefined);
      setProfileSaved(false);
    }
  }

  async function handleSaveProfile() {
    if (!user?.id) {
      setProfileError('You appear to be signed out. Please sign in again.');
      return;
    }
    const nameErr = validateDisplayName(displayName);
    if (nameErr) {
      setNameError(nameErr);
      return;
    }

    setProfileSaving(true);
    setProfileError(undefined);
    setProfileSaved(false);

    // Upsert (not bare update) so a missing profile row self-heals (edge case).
    // Omit updated_at — the set_updated_at trigger owns it (SF5). Only send a
    // timezone when we have one (let the DB default stand otherwise).
    const payload: Database['public']['Tables']['profiles']['Insert'] = {
      id: user.id,
      display_name: normalizeDisplayName(displayName),
      units,
    };
    if (timezone) payload.timezone = timezone;

    const { error } = await supabase.from('profiles').upsert(payload, { onConflict: 'id' });

    if (!mounted.current) return;
    if (error) {
      setProfileError(saveErrorMessage(error));
      setProfileSaving(false);
      return;
    }
    setProfileSaving(false);
    setProfileSaved(true);
    refetchProfile();
  }

  // --- Goals handlers --------------------------------------------------------
  function changeAge(text: string) {
    setAge(text);
    setGoalErrors((prev) => ({ ...prev, age: undefined }));
    setGoalsError(undefined);
    setGoalsSaved(false);
  }

  function changeHeight(text: string) {
    setHeightEdit(text);
    setGoalErrors((prev) => ({ ...prev, height: undefined }));
    setGoalsError(undefined);
    setGoalsSaved(false);
  }

  function changeWeight(text: string) {
    setWeightEdit(text);
    setGoalErrors((prev) => ({ ...prev, weight: undefined }));
    setGoalsError(undefined);
    setGoalsSaved(false);
  }

  function selectSex(value: Sex) {
    setSex(value);
    setGoalErrors((prev) => ({ ...prev, sex: undefined }));
    setGoalsSaved(false);
  }

  function selectActivity(value: ActivityLevel) {
    setActivityLevel(value);
    setGoalErrors((prev) => ({ ...prev, activityLevel: undefined }));
    setGoalsSaved(false);
  }

  function selectGoal(value: WeightGoal) {
    setWeightGoal(value);
    setGoalErrors((prev) => ({ ...prev, weightGoal: undefined }));
    setGoalsSaved(false);
  }

  async function handleSaveGoals() {
    if (!user?.id) {
      setGoalsError('You appear to be signed out. Please sign in again.');
      return;
    }
    // Validate every field in the active display units (B2). A complete, valid
    // body set is required — never partial-write null into a populated row (SF6).
    const errors = {
      age: validateAge(age),
      sex: sex ? undefined : 'Select an option.',
      height: validateHeight(heightInput, units),
      weight: validateWeight(weightInput, units),
      activityLevel: activityLevel ? undefined : 'Select an option.',
      weightGoal: weightGoal ? undefined : 'Select an option.',
    };
    setGoalErrors(errors);
    if (Object.values(errors).some(Boolean) || !metricInput) return;

    let result: ComputedGoals;
    try {
      result = computeGoals(metricInput);
    } catch {
      setGoalsError("We couldn't compute your targets. Please review your inputs.");
      return;
    }

    setGoalsSaving(true);
    setGoalsError(undefined);
    setGoalsSaved(false);

    // Identical write shape to the wizard (B5): idempotent upsert; client supplies
    // user_id; raw body inputs stay populated (plan 0005 SF5). No updated_at (SF5).
    const { error } = await supabase.from('goals').upsert(
      {
        user_id: user.id,
        calories: result.calories,
        protein: result.protein,
        carbs: result.carbs,
        fat: result.fat,
        weight_goal: metricInput.weightGoal,
        activity_level: metricInput.activityLevel,
        age: metricInput.age,
        sex: metricInput.sex,
        height_cm: metricInput.heightCm,
        weight_kg: metricInput.weightKg,
      },
      { onConflict: 'user_id' },
    );

    if (!mounted.current) return;
    if (error) {
      setGoalsError(saveErrorMessage(error));
      setGoalsSaving(false);
      return;
    }
    // Adopt the saved metric as the new canonical and drop the edit overrides so the
    // fields re-derive from it (B1 — no drift on the next render).
    setCanonicalBody({ heightCm: metricInput.heightCm, weightKg: metricInput.weightKg });
    setHeightEdit(null);
    setWeightEdit(null);
    setGoalsSaving(false);
    setGoalsSaved(true);
  }

  async function handleSignOut() {
    await signOut();
    // The root gate flips to (auth) and unmounts us; nothing to set after.
  }

  return (
    <Screen scroll tabBarInset>
      <View style={styles.header}>
        <Text type="title">Settings</Text>
      </View>

      {/* 1. Profile -------------------------------------------------------- */}
      <Card style={styles.section}>
        <Text type="subtitle">Profile</Text>
        <Input
          label="Display name"
          value={displayName}
          onChangeText={changeName}
          placeholder="Optional"
          autoCapitalize="words"
          error={nameError}
          editable={!profileLoading}
        />

        <View style={styles.group}>
          <Text type="smallBold" themeColor="textSecondary">
            Units
          </Text>
          {UNIT_OPTIONS.map((option) => (
            <Button
              key={option.value}
              variant={units === option.value ? 'primary' : 'secondary'}
              onPress={() => changeUnits(option.value)}
              fullWidth>
              {option.label}
            </Button>
          ))}
        </View>

        <View style={styles.group}>
          <Text type="smallBold" themeColor="textSecondary">
            Timezone
          </Text>
          <Text type="default">{timezoneDisplay(timezone)}</Text>
          <Button variant="secondary" onPress={useDeviceTimezone} fullWidth>
            Use device timezone
          </Button>
        </View>

        {profileError ? (
          <Text type="small" themeColor="danger">
            {profileError}
          </Text>
        ) : profileSaved ? (
          <Text type="small" themeColor="textSecondary">
            Profile saved.
          </Text>
        ) : null}

        <Button onPress={handleSaveProfile} loading={profileSaving} fullWidth>
          Save profile
        </Button>
      </Card>

      {/* 2. Daily goals ---------------------------------------------------- */}
      <Card style={styles.section}>
        <Text type="subtitle">Daily goals</Text>

        {goals.loading ? (
          <Text type="small" themeColor="textSecondary">
            Loading your goals…
          </Text>
        ) : goals.error ? (
          <Text type="small" themeColor="danger">
            We couldn&apos;t load your goals. Pull to refresh or try again later.
          </Text>
        ) : !goals.row ? (
          <Text type="small" themeColor="textSecondary">
            We couldn&apos;t find your goals. Please finish onboarding or contact support.
          </Text>
        ) : (
          <>
            <Input
              label="Age"
              value={age}
              onChangeText={changeAge}
              keyboardType="number-pad"
              inputMode="numeric"
              error={goalErrors.age}
            />
            <SelectGroup
              label="Sex"
              error={goalErrors.sex}
              options={SEX_OPTIONS}
              value={sex}
              onSelect={selectSex}
            />
            <Input
              label={units === 'imperial' ? 'Height (in)' : 'Height (cm)'}
              value={heightInput}
              onChangeText={changeHeight}
              keyboardType="decimal-pad"
              inputMode="decimal"
              error={goalErrors.height}
            />
            <Input
              label={units === 'imperial' ? 'Weight (lb)' : 'Weight (kg)'}
              value={weightInput}
              onChangeText={changeWeight}
              keyboardType="decimal-pad"
              inputMode="decimal"
              error={goalErrors.weight}
            />
            <SelectGroup
              label="How active are you?"
              error={goalErrors.activityLevel}
              options={ACTIVITY_OPTIONS}
              value={activityLevel}
              onSelect={selectActivity}
            />
            <SelectGroup
              label="What's your goal?"
              error={goalErrors.weightGoal}
              options={GOAL_OPTIONS}
              value={weightGoal}
              onSelect={selectGoal}
            />

            <GoalsReview computed={computed} />

            {goalsError ? (
              <Text type="small" themeColor="danger">
                {goalsError}
              </Text>
            ) : goalsSaved ? (
              <Text type="small" themeColor="textSecondary">
                Goals saved.
              </Text>
            ) : null}

            <Button onPress={handleSaveGoals} loading={goalsSaving} disabled={!computed} fullWidth>
              Save goals
            </Button>
          </>
        )}
      </Card>

      {/* 3. Legal ---------------------------------------------------------- */}
      <Card style={styles.section}>
        <Text type="smallBold" themeColor="textSecondary">
          Legal
        </Text>
        <Text type="linkPrimary" onPress={() => router.push('/privacy')}>
          Privacy Policy
        </Text>
      </Card>

      {/* 4. Sign out ------------------------------------------------------- */}
      <Card style={styles.section}>
        <Button variant="secondary" onPress={handleSignOut} fullWidth>
          Sign out
        </Button>
      </Card>
    </Screen>
  );
}

/** Map a Postgrest save error to friendly copy; 401/403 → session expired (N2). */
function saveErrorMessage(error: { code?: string }): string {
  if (error.code === '401' || error.code === '403' || error.code === 'PGRST301') {
    return 'Your session expired — please sign in again.';
  }
  return "We couldn't save your changes. Please try again.";
}

/** Full-width selectable rows built from Button (SF3 — no new primitive). */
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

/** Live recomputed targets + the clamp note when floored (N5). */
function GoalsReview({ computed }: { computed: ComputedGoals | undefined }) {
  if (!computed) {
    return (
      <Text type="small" themeColor="danger">
        We couldn&apos;t compute your targets. Check the values above.
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

const UNIT_OPTIONS: { value: Units; label: string }[] = [
  { value: 'metric', label: 'Metric (cm, kg)' },
  { value: 'imperial', label: 'Imperial (in, lb)' },
];

const styles = StyleSheet.create({
  header: {
    marginBottom: Spacing.four,
  },
  section: {
    gap: Spacing.three,
    marginBottom: Spacing.four,
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
});
