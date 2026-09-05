/**
 * Editable meal review (plan 0009 — S2 piece 3). Seeded from the AI analysis,
 * this lets the user CORRECT the estimate (dish name + per-item name/calories/
 * macros, remove an item) with live-recomputed totals, then SAVE it as one
 * `meal_logs` + N `meal_items` rows via the atomic `create_meal_log` RPC.
 *
 * The editable body (dish + items + totals + assumptions) is the shared
 * `MealEditorForm` (plan 0015), used by both this create flow and the edit
 * flow; this screen owns only the save/error/saved lifecycle around it.
 *
 * Colocated with the capture screen (not a route, not a new `components/` dir —
 * the repo uses `lib/` + `screens/`; mirrors `settings-screen.tsx` hosting
 * `GoalsReview`). The capture screen `key`s this by `imagePath` so re-picking a
 * photo remounts it — the old instance's `mounted` ref then drops any late save
 * `setState`.
 *
 * Discipline: double-tap guard + `mounted` ref on the async save; a bare retry
 * only for transient kinds; idempotent `conflict` routes to the Saved state
 * (the meal is already saved). Never logs the form/payload (health PII).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { Button, Text } from '@/shared/ui';
import type { MealAnalysis } from '@/types/nutrition';

import {
  isFormValid,
  recomputeTotals,
  seedFormFromAnalysis,
  toSavePayload,
  totalsWithinCaps,
  type MealForm,
  type MealItemForm,
} from '../lib/meal-form';
import { saveMeal, type SaveErrorKind } from '../lib/save-meal';
import { MealEditorForm } from './meal-editor-form';

type MealReviewProps = {
  analysis: MealAnalysis;
  imagePath: string | null;
  /** The note the user typed in Capture (plan 0020) — seeds the editable form. */
  initialNote?: string;
  onLogAnother: () => void;
  /**
   * Fired the instant a save RPC is dispatched (plan 0011 B1) so the parent can
   * mark this path do-not-delete at the irreversible commit point — BEFORE any
   * unmount between commit and ack could drop a post-success callback.
   */
  onSaving?: (path: string) => void;
};

/** Friendly copy + whether a bare retry can ever succeed, per save error kind. */
function saveErrorCopy(kind: SaveErrorKind): { message: string; canRetry: boolean } {
  switch (kind) {
    case 'unauthorized':
      return { message: 'Your session expired — please sign in again.', canRetry: false };
    case 'invalid':
      return { message: "We couldn't save this meal. Please check your edits.", canRetry: false };
    case 'network':
      return { message: 'Save failed — check your connection and try again.', canRetry: true };
    case 'conflict': // handled as success upstream; here for exhaustiveness.
    case 'unknown':
    default:
      return { message: 'Something went wrong saving this meal. Please try again.', canRetry: true };
  }
}

export function MealReview({
  analysis,
  imagePath,
  initialNote,
  onLogAnother,
  onSaving,
}: MealReviewProps) {
  const [form, setForm] = useState<MealForm>(() => seedFormFromAnalysis(analysis, initialNote));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  const [saveCanRetry, setSaveCanRetry] = useState(false);
  const [saved, setSaved] = useState(false);

  // Sign-out / re-pick can unmount us the instant the save resolves.
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

  function setItemField(id: string, field: keyof MealItemForm, value: string) {
    setForm((prev) => ({
      ...prev,
      items: prev.items.map((item) => (item.id === id ? { ...item, [field]: value } : item)),
    }));
  }

  function removeItem(id: string) {
    setForm((prev) => ({ ...prev, items: prev.items.filter((item) => item.id !== id) }));
  }

  const canSave = !saving && isFormValid(form) && withinCaps;

  async function handleSave() {
    if (saving || !canSave) return; // double-tap guard.
    setSaving(true);
    setSaveError(undefined);
    setSaveCanRetry(false);

    // B1: mark do-not-delete at save *initiation* (the irreversible commit point),
    // not on the success ack — an unmount before the ack must not lose the mark.
    if (imagePath) onSaving?.(imagePath);

    const payload = toSavePayload(form, imagePath);
    const result = await saveMeal({ payload });

    if (!mounted.current) return;
    // Idempotent: a real save OR a duplicate (conflict) both mean "it's logged".
    if (result.ok || result.kind === 'conflict') {
      setSaved(true);
      setSaving(false);
      return;
    }
    const { message, canRetry } = saveErrorCopy(result.kind);
    setSaveError(message);
    setSaveCanRetry(canRetry);
    setSaving(false);
  }

  if (saved) {
    return (
      <View style={styles.container}>
        <Text type="subtitle">Saved ✓</Text>
        <Text type="small" themeColor="textSecondary">
          This meal is logged.
        </Text>
        <Button onPress={onLogAnother} fullWidth>
          Log another meal
        </Button>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text type="subtitle">Review &amp; save</Text>

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
        {saveCanRetry ? 'Retry save' : 'Save meal'}
      </Button>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.three,
  },
});
