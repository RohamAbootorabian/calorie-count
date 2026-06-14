/**
 * Core domain model for the app.
 *
 * The whole product revolves around turning a meal photo into a structured,
 * editable `MealAnalysis`. Keep this file as the single source of truth for
 * that shape — the AI service, the database schema, and the UI all derive
 * from it.
 */

/** Macro + micro nutrients we attempt to estimate from a photo. */
export interface Nutrients {
  /** Energy in kilocalories. */
  calories: number;
  /** Grams. */
  protein: number;
  /** Grams. */
  carbs: number;
  /** Grams. */
  fat: number;
  /** Grams. Subset of carbs. */
  sugar: number;
  /** Grams. */
  fiber: number;
  /** Milligrams of sodium (the "salt" the user cares about). */
  sodium: number;
}

/** A single recognised component of a meal, e.g. "grilled chicken breast". */
export interface FoodItem {
  name: string;
  /** Free-text portion as the model saw it, e.g. "1 medium breast (~120g)". */
  portion: string;
  /** Estimated weight in grams, used for recomputing nutrients when edited. */
  estimatedGrams: number;
  nutrients: Nutrients;
}

/** How confident the model is in the estimate. Drives UI nudges to verify. */
export type Confidence = "low" | "medium" | "high";

/**
 * A "food quality" score (0–100) — our differentiator vs. plain calorie
 * counters. Computed from processing level, sugar/salt density, protein and
 * fiber ratios, not just energy.
 */
export interface QualityScore {
  score: number;
  /** Short human-readable reasons, e.g. ["high protein", "low fiber"]. */
  factors: string[];
}

/** The full result of analysing one meal photo. */
export interface MealAnalysis {
  /** Best-guess name of the overall dish. */
  dishName: string;
  items: FoodItem[];
  /** Sum of all item nutrients — denormalised for quick reads. */
  totals: Nutrients;
  confidence: Confidence;
  quality?: QualityScore;
  /** Anything the user should confirm, e.g. "Assumed cooked in oil". */
  assumptions?: string[];
}

/** A logged meal: the analysis plus storage/tracking metadata. */
export interface MealLog {
  id: string;
  userId: string;
  imageUrl: string;
  /** ISO 8601 timestamp of when the meal was eaten. */
  eatenAt: string;
  analysis: MealAnalysis;
  /** True once the user has reviewed/edited the AI estimate. */
  verified: boolean;
}

export const EMPTY_NUTRIENTS: Nutrients = {
  calories: 0,
  protein: 0,
  carbs: 0,
  fat: 0,
  sugar: 0,
  fiber: 0,
  sodium: 0,
};

/** Sum a list of nutrient sets — used to compute meal totals from items. */
export function sumNutrients(list: Nutrients[]): Nutrients {
  return list.reduce<Nutrients>(
    (acc, n) => ({
      calories: acc.calories + n.calories,
      protein: acc.protein + n.protein,
      carbs: acc.carbs + n.carbs,
      fat: acc.fat + n.fat,
      sugar: acc.sugar + n.sugar,
      fiber: acc.fiber + n.fiber,
      sodium: acc.sodium + n.sodium,
    }),
    { ...EMPTY_NUTRIENTS },
  );
}
