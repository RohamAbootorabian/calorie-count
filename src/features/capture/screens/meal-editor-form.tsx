/**
 * Shared editable meal body (plan 0015 — extracted from `meal-review.tsx`).
 * Renders the dish name + per-item fields (name/calories/macros, remove) + live
 * totals + the assumptions note, with inline per-field validation. Used by BOTH
 * the create flow (`MealReview`) and the edit flow (`EditMealScreen`).
 *
 * PINNED PROPS CONTRACT (review arch #1): this component is PURELY CONTROLLED —
 * it owns no form/save state. Each host screen keeps its own form state +
 * save/error/saved lifecycle and passes the recomputed `totals`/`withinCaps`
 * down. The assumptions block reads `form.assumptions` (NOT `analysis.*`) so it
 * serves create and edit identically.
 */
import { StyleSheet, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { Button, Card, DateField, Input, Text } from '@/shared/ui';
import type { Nutrients } from '@/types/nutrition';

import {
  NOTE_MAX,
  validateDishName,
  validateEatenAt,
  validateItem,
  validateNote,
  type MealForm,
  type MealItemForm,
} from '../lib/meal-form';

export type MealEditorFormProps = {
  form: MealForm;
  onDishChange: (value: string) => void;
  onItemChange: (id: string, field: keyof MealItemForm, value: string) => void;
  onRemoveItem: (id: string) => void;
  /** Controlled note handler (plan 0020) — mirrors `onDishChange`. */
  onNoteChange: (value: string) => void;
  /** Controlled meal-date handler (plan 0028). */
  onDateChange: (value: Date) => void;
  totals: Nutrients;
  withinCaps: boolean;
};

export function MealEditorForm({
  form,
  onDishChange,
  onItemChange,
  onRemoveItem,
  onNoteChange,
  onDateChange,
  totals,
  withinCaps,
}: MealEditorFormProps) {
  const dishError = validateDishName(form.dishName);
  const noteError = validateNote(form.note);
  const dateError = validateEatenAt(form.eatenAt);

  return (
    <View style={styles.body}>
      <Text type="small" themeColor="textSecondary">
        Confidence: {form.confidence}
        {form.quality ? ` · Quality ${Math.round(form.quality.score)}/100` : ''}
      </Text>

      <Input
        label="Dish name"
        value={form.dishName}
        onChangeText={onDishChange}
        error={dishError}
        autoCapitalize="sentences"
      />

      <DateField
        label="Date"
        value={form.eatenAt}
        onChange={onDateChange}
        maximumDate={new Date()}
        error={dateError}
      />

      <Input
        label="Note (optional)"
        value={form.note}
        onChangeText={onNoteChange}
        error={noteError}
        hint={`${[...form.note].length}/${NOTE_MAX}`}
        placeholder="e.g. fried in butter, 2 cups of rice"
        autoCapitalize="sentences"
        multiline
        maxLength={NOTE_MAX}
        style={styles.noteInput}
      />

      {form.items.map((item, index) => (
        <ItemRow
          key={item.id}
          item={item}
          index={index}
          onChange={(field, value) => onItemChange(item.id, field, value)}
          onRemove={() => onRemoveItem(item.id)}
          canRemove={form.items.length > 1}
        />
      ))}

      {form.items.length === 0 ? (
        <Text type="small" themeColor="danger">
          Add at least one item to save (remove undid the last one).
        </Text>
      ) : null}

      {/* Live totals -------------------------------------------------------- */}
      <Card>
        <Text type="smallBold" themeColor="textSecondary">
          Meal totals
        </Text>
        <View style={styles.totalsRows}>
          <TotalRow label="Calories" value={`${Math.round(totals.calories)}`} />
          <TotalRow label="Protein" value={`${Math.round(totals.protein)} g`} />
          <TotalRow label="Carbs" value={`${Math.round(totals.carbs)} g`} />
          <TotalRow label="Fat" value={`${Math.round(totals.fat)} g`} />
          <TotalRow label="Sugar" value={`${Math.round(totals.sugar)} g`} />
          <TotalRow label="Fiber" value={`${Math.round(totals.fiber)} g`} />
          <TotalRow label="Sodium" value={`${Math.round(totals.sodium)} mg`} />
        </View>
        {!withinCaps ? (
          <Text type="small" themeColor="danger">
            These totals are too large to save — remove or reduce items.
          </Text>
        ) : null}
      </Card>

      {form.assumptions && form.assumptions.length > 0 ? (
        <Text type="small" themeColor="textSecondary">
          Assumed: {form.assumptions.join(' · ')}
        </Text>
      ) : null}
    </View>
  );
}

/** One editable item: name + calories/protein/carbs/fat + remove. */
function ItemRow({
  item,
  index,
  onChange,
  onRemove,
  canRemove,
}: {
  item: MealItemForm;
  index: number;
  onChange: (field: keyof MealItemForm, value: string) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const errors = validateItem(item);
  return (
    <Card style={styles.itemCard}>
      <View style={styles.itemHeader}>
        <Text type="smallBold" themeColor="textSecondary">
          Item {index + 1}
        </Text>
        <Button variant="secondary" onPress={onRemove} disabled={!canRemove}>
          Remove
        </Button>
      </View>

      <Input
        label="Name"
        value={item.name}
        onChangeText={(value) => onChange('name', value)}
        error={errors.name}
      />

      <View style={styles.nutrientGrid}>
        <View style={styles.nutrientCell}>
          <Input
            label="Calories"
            value={item.calories}
            onChangeText={(value) => onChange('calories', value)}
            error={errors.calories}
            keyboardType="decimal-pad"
          />
        </View>
        <View style={styles.nutrientCell}>
          <Input
            label="Protein (g)"
            value={item.protein}
            onChangeText={(value) => onChange('protein', value)}
            error={errors.protein}
            keyboardType="decimal-pad"
          />
        </View>
        <View style={styles.nutrientCell}>
          <Input
            label="Carbs (g)"
            value={item.carbs}
            onChangeText={(value) => onChange('carbs', value)}
            error={errors.carbs}
            keyboardType="decimal-pad"
          />
        </View>
        <View style={styles.nutrientCell}>
          <Input
            label="Fat (g)"
            value={item.fat}
            onChangeText={(value) => onChange('fat', value)}
            error={errors.fat}
            keyboardType="decimal-pad"
          />
        </View>
      </View>
    </Card>
  );
}

function TotalRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.totalRow}>
      <Text type="default">{label}</Text>
      <Text type="default">{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: Spacing.three,
  },
  noteInput: {
    minHeight: 88,
    textAlignVertical: 'top',
  },
  itemCard: {
    gap: Spacing.two,
  },
  itemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  nutrientGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  nutrientCell: {
    flexGrow: 1,
    flexBasis: '45%',
  },
  totalsRows: {
    gap: Spacing.one,
    marginTop: Spacing.one,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
});
