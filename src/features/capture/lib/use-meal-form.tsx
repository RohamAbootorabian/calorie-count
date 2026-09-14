/**
 * Shared editable-meal-form controller (plan 0037). Owns the `MealForm` state, the
 * six field handlers, and the render-derived `totals`/`withinCaps`/`formValid` — the
 * byte-identical block that the create flow (`MealReview`) and the edit flow
 * (`EditMealScreen`) previously duplicated.
 *
 * Deliberately does NOT own the save lifecycle: the two screens hit different RPCs
 * (`create_meal_log` vs `update_meal_log`) with divergent success paths, retry copy,
 * `mounted`/double-tap guards, and navigation — that stays per-screen. Each screen
 * composes `canSave = !saving && formValid && withinCaps` with its own `saving`.
 *
 * `init` is a LAZY initializer (`useState(init)`): it runs once on mount and is
 * ignored on later renders, so each screen's seed (`seedFormFromAnalysis` /
 * `seedFormFromMealLog`) fires once; a new meal/photo re-seeds via the host's `key`
 * remount, not here. No effect/memo/callback (React Compiler memoizes).
 */
import { useState } from 'react';

import type { Nutrients } from '@/types/nutrition';

import {
  appendEmptyItem,
  isFormValid,
  MAX_ITEMS,
  recomputeTotals,
  totalsWithinCaps,
  type MealForm,
  type MealItemForm,
} from './meal-form';

export type MealFormController = {
  form: MealForm;
  /** Live meal totals recomputed from the items (display-only). */
  totals: Nutrients;
  /** False when any total exceeds its DB cap → blocks Save. */
  withinCaps: boolean;
  /** `isFormValid(form)` — screens combine this with their own `saving`. */
  formValid: boolean;
  setDishName: (value: string) => void;
  setNote: (value: string) => void;
  setEatenAt: (value: Date) => void;
  setItemField: (id: string, field: keyof MealItemForm, value: string) => void;
  removeItem: (id: string) => void;
  addItem: () => void;
};

export function useMealForm(init: () => MealForm): MealFormController {
  const [form, setForm] = useState<MealForm>(init);

  const totals = recomputeTotals(form.items);
  const withinCaps = totalsWithinCaps(totals);
  const formValid = isFormValid(form);

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

  function addItem() {
    setForm((prev) =>
      prev.items.length >= MAX_ITEMS ? prev : { ...prev, items: appendEmptyItem(prev.items) },
    );
  }

  return {
    form,
    totals,
    withinCaps,
    formValid,
    setDishName,
    setNote,
    setEatenAt,
    setItemField,
    removeItem,
    addItem,
  };
}
