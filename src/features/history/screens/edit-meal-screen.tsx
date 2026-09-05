/**
 * Edit a saved meal (plan 0015 — the app's first UPDATE surface). Opened from a
 * History row with `?id=`, it fetches the meal's editable detail
 * (`useMealDetail`), seeds the SAME `MealForm` the create flow uses, renders the
 * shared `MealEditorForm`, and persists via the atomic `update_meal_log` RPC
 * (`updateMeal`). On success it pops back to History, which refetches on focus.
 *
 * History owns this edit *flow*; it reuses capture's editable-meal *model*
 * (`meal-form`, `MealEditorForm`) — same split as `delete-meal` →
 * `delete-meal-photo`.
 *
 * Discipline: double-tap guard + a `mounted` ref wrapping BOTH the detail fetch
 * (in the hook) and the `updateMeal` resolution; a bare retry only for transient
 * kinds; `not_found` (meal deleted between open and Save) shows a terminal "no
 * longer exists" with a Back action. Never logs the form/payload (health PII).
 *
 * Totals note (review SF1): a legacy meal whose stored `total_*` don't equal
 * `sum(items)` will have its totals normalized to `sum(items)` on save (seeding
 * rounds each field) — intended; edit always stores totals = sum of items.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import {
  isFormValid,
  recomputeTotals,
  seedFormFromMealLog,
  toSavePayload,
  totalsWithinCaps,
  type MealForm,
  type MealItemForm,
} from '@/features/capture/lib/meal-form';
import { MealEditorForm } from '@/features/capture/screens/meal-editor-form';
import { Button, Screen, Text } from '@/shared/ui';

import { useMealDetail } from '../lib/use-meal-detail';
import { updateMeal, type UpdateMealErrorKind } from '../lib/update-meal';

/** Friendly copy + whether a bare retry can ever succeed, per update error kind. */
function updateErrorCopy(kind: UpdateMealErrorKind): { message: string; canRetry: boolean } {
  switch (kind) {
    case 'not_found':
      return { message: 'This meal no longer exists — it may have been deleted.', canRetry: false };
    case 'unauthorized':
      return { message: 'Your session expired — please sign in again.', canRetry: false };
    case 'invalid':
      return { message: "We couldn't save your changes. Please check your edits.", canRetry: false };
    case 'network':
      return { message: 'Save failed — check your connection and try again.', canRetry: true };
    case 'unknown':
    default:
      return { message: 'Something went wrong saving your changes. Please try again.', canRetry: true };
  }
}

export default function EditMealScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { loading, detail, error, refetch } = useMealDetail(id);

  if (loading) {
    return (
      <Screen contentContainerStyle={styles.centered}>
        <ActivityIndicator />
      </Screen>
    );
  }

  if (error || !detail) {
    return (
      <Screen contentContainerStyle={styles.centered}>
        <View style={styles.centerContent}>
          <Text type="subtitle">Can&apos;t edit this meal</Text>
          <Text type="small" themeColor="textSecondary" style={styles.centerText}>
            It may have been deleted, or we couldn&apos;t load it. Try again, or go back.
          </Text>
          <Button onPress={refetch} fullWidth>
            Try again
          </Button>
          <Button variant="secondary" onPress={() => router.back()} fullWidth>
            Back
          </Button>
        </View>
      </Screen>
    );
  }

  // `key` remounts the editor when the loaded meal changes, so the form state
  // seeds cleanly from the new detail without an effect.
  return <MealEditor key={id} id={id!} detail={detail} />;
}

/** The loaded editor — mounted only once `detail` is present, so it seeds once. */
function MealEditor({ id, detail }: { id: string; detail: NonNullable<ReturnType<typeof useMealDetail>['detail']> }) {
  const [form, setForm] = useState<MealForm>(() => seedFormFromMealLog(detail.log, detail.items));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  const [saveCanRetry, setSaveCanRetry] = useState(false);
  // Terminal "no longer exists" state — a retry can't help; only Back.
  const [gone, setGone] = useState(false);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const totals = useMemo(() => recomputeTotals(form.items), [form.items]);
  const withinCaps = totalsWithinCaps(totals);

  function setDishName(value: string) {
    setForm((prev) => ({ ...prev, dishName: value }));
  }

  function setNote(value: string) {
    setForm((prev) => ({ ...prev, note: value }));
  }

  function setEatenAt(value: Date) {
    setForm((prev) => ({ ...prev, eatenAt: value }));
  }

  function setItemField(itemId: string, field: keyof MealItemForm, value: string) {
    setForm((prev) => ({
      ...prev,
      items: prev.items.map((item) => (item.id === itemId ? { ...item, [field]: value } : item)),
    }));
  }

  function removeItem(itemId: string) {
    setForm((prev) => ({ ...prev, items: prev.items.filter((item) => item.id !== itemId) }));
  }

  const canSave = !saving && isFormValid(form) && withinCaps;

  async function handleSave() {
    if (saving || !canSave) return; // double-tap guard.
    setSaving(true);
    setSaveError(undefined);
    setSaveCanRetry(false);

    const payload = toSavePayload(form, null); // image_path unused by the update RPC.
    const result = await updateMeal({ id, payload });

    if (!mounted.current) return;
    if (result.ok) {
      router.back(); // History refetches on focus → shows the new values.
      return;
    }
    if (result.kind === 'not_found') {
      setGone(true);
      setSaving(false);
      return;
    }
    const { message, canRetry } = updateErrorCopy(result.kind);
    setSaveError(message);
    setSaveCanRetry(canRetry);
    setSaving(false);
  }

  if (gone) {
    return (
      <Screen contentContainerStyle={styles.centered}>
        <View style={styles.centerContent}>
          <Text type="subtitle">This meal no longer exists</Text>
          <Text type="small" themeColor="textSecondary" style={styles.centerText}>
            It may have been deleted on another device. Your changes weren&apos;t saved.
          </Text>
          <Button onPress={() => router.back()} fullWidth>
            Back to History
          </Button>
        </View>
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <View style={styles.container}>
        <MealEditorForm
          form={form}
          onDishChange={setDishName}
          onItemChange={setItemField}
          onRemoveItem={removeItem}
          onNoteChange={setNote}
          onDateChange={setEatenAt}
          totals={totals}
          withinCaps={withinCaps}
        />

        {saveError ? (
          <Text type="small" themeColor="danger">
            {saveError}
          </Text>
        ) : null}

        <Button onPress={handleSave} loading={saving} disabled={!canSave} fullWidth>
          {saveCanRetry ? 'Retry save' : 'Save changes'}
        </Button>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.three,
    paddingBottom: Spacing.four,
  },
  centered: {
    justifyContent: 'center',
  },
  centerContent: {
    gap: Spacing.two,
  },
  centerText: {
    textAlign: 'center',
  },
});
