/**
 * `MealAnalysis` shape + Gemini response schema + server-side coercion
 * (plan 0008, S2 piece 2). Deno module — runs in the Edge Function only.
 *
 * ⚠️ MIRROR of `src/types/nutrition.ts`. The Deno (Edge) and Metro (app) module
 * graphs are separate, so this shape is duplicated by design (plan Q1). If the
 * app type changes, change this too. The numeric CLAMPS below are pinned to the
 * DB CHECK literals in `supabase/migrations/20260619102510_initial_schema.sql`
 * so a coerced analysis can always be inserted by piece 3 without violating a
 * constraint.
 *
 * NEVER trust the model: `coerceMealAnalysis` turns any null/NaN/Infinity/
 * negative/string/over-cap value into a safe, clamped number. Postgres accepts
 * NaN under a bare `>= 0` check, so stripping NaN here is load-bearing.
 */

export type Confidence = "low" | "medium" | "high";

export interface Nutrients {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  sugar: number;
  fiber: number;
  sodium: number; // milligrams
}

export interface FoodItem {
  name: string;
  portion: string;
  estimatedGrams: number;
  nutrients: Nutrients;
}

export interface QualityScore {
  score: number;
  factors: string[];
}

export interface MealAnalysis {
  dishName: string;
  items: FoodItem[];
  totals: Nutrients;
  confidence: Confidence;
  quality?: QualityScore;
  assumptions?: string[];
}

// --- Clamp limits — pinned to the DB CHECK constraints (migration literals). --
const MAX_CALORIES = 100_000; // item & total: calories between 0 and 100000
const MAX_MACRO = 10_000; //     item & total: protein/carbs/fat/sugar/fiber 0..10000
const MAX_SODIUM = 1_000_000; // item & total: sodium between 0 and 1000000 (mg)
const MAX_GRAMS = 100_000; //    estimated_grams between 0 and 100000
const MAX_SCORE = 100; //        quality_score between 0 and 100
const MAX_STR = 200; //          char_length(...) <= 200
// Array caps — bound the payload (not DB-derived; defensive).
const MAX_ITEMS = 50;
const MAX_FACTORS = 20;
const MAX_ASSUMPTIONS = 20;

const CONFIDENCES: Confidence[] = ["low", "medium", "high"];

const clamp = (n: number, min: number, max: number) =>
  Math.min(Math.max(n, min), max);

/**
 * The one number helper used everywhere. Anything non-finite (null/undefined/
 * NaN/Infinity/"abc") → 0; otherwise clamp into [0, max]. Never inherits a
 * sibling's value, never lets NaN reach the DB.
 */
function coerceNum(x: unknown, max: number): number {
  const n = Number(x);
  return Number.isFinite(n) ? clamp(n, 0, max) : 0;
}

function coerceStr(x: unknown): string {
  return typeof x === "string" ? x.slice(0, MAX_STR) : "";
}

function coerceStrArray(x: unknown, cap: number): string[] {
  if (!Array.isArray(x)) return [];
  return x
    .filter((s): s is string => typeof s === "string" && s.length > 0)
    .slice(0, cap)
    .map((s) => s.slice(0, MAX_STR));
}

function coerceNutrients(raw: unknown): Nutrients {
  const n = (raw ?? {}) as Record<string, unknown>;
  return {
    calories: coerceNum(n.calories, MAX_CALORIES),
    protein: coerceNum(n.protein, MAX_MACRO),
    carbs: coerceNum(n.carbs, MAX_MACRO),
    fat: coerceNum(n.fat, MAX_MACRO),
    sugar: coerceNum(n.sugar, MAX_MACRO),
    fiber: coerceNum(n.fiber, MAX_MACRO),
    sodium: coerceNum(n.sodium, MAX_SODIUM),
  };
}

const EMPTY_NUTRIENTS: Nutrients = {
  calories: 0,
  protein: 0,
  carbs: 0,
  fat: 0,
  sugar: 0,
  fiber: 0,
  sodium: 0,
};

/** Sum item nutrients, then re-clamp to the TOTALS' own DB ranges. */
function sumAndClampTotals(items: FoodItem[]): Nutrients {
  const sum = items.reduce<Nutrients>(
    (acc, it) => ({
      calories: acc.calories + it.nutrients.calories,
      protein: acc.protein + it.nutrients.protein,
      carbs: acc.carbs + it.nutrients.carbs,
      fat: acc.fat + it.nutrients.fat,
      sugar: acc.sugar + it.nutrients.sugar,
      fiber: acc.fiber + it.nutrients.fiber,
      sodium: acc.sodium + it.nutrients.sodium,
    }),
    { ...EMPTY_NUTRIENTS },
  );
  // Item caps don't bound their SUM (N items × MAX can exceed total_* CHECKs),
  // so re-clamp the recomputed totals to the totals' ranges (same literals).
  return {
    calories: clamp(sum.calories, 0, MAX_CALORIES),
    protein: clamp(sum.protein, 0, MAX_MACRO),
    carbs: clamp(sum.carbs, 0, MAX_MACRO),
    fat: clamp(sum.fat, 0, MAX_MACRO),
    sugar: clamp(sum.sugar, 0, MAX_MACRO),
    fiber: clamp(sum.fiber, 0, MAX_MACRO),
    sodium: clamp(sum.sodium, 0, MAX_SODIUM),
  };
}

/**
 * Coerce the model's raw JSON into a safe `MealAnalysis`. Totals are recomputed
 * from items (the type defines totals as the item sum), never taken from the
 * model. `quality` is left `undefined` if the model omits it — we never
 * fabricate `{ score: 0 }`, which would read as a real "0/100".
 */
export function coerceMealAnalysis(raw: unknown): MealAnalysis {
  const obj = (raw ?? {}) as Record<string, unknown>;

  const items: FoodItem[] = (Array.isArray(obj.items) ? obj.items : [])
    .slice(0, MAX_ITEMS)
    .map((it) => {
      const item = (it ?? {}) as Record<string, unknown>;
      return {
        name: coerceStr(item.name),
        portion: coerceStr(item.portion),
        estimatedGrams: coerceNum(item.estimatedGrams, MAX_GRAMS),
        nutrients: coerceNutrients(item.nutrients),
      };
    });

  const confidence: Confidence = CONFIDENCES.includes(obj.confidence as Confidence)
    ? (obj.confidence as Confidence)
    : "low";

  const dishName = coerceStr(obj.dishName).trim() || "Meal";

  let quality: QualityScore | undefined;
  if (obj.quality != null && typeof obj.quality === "object") {
    const q = obj.quality as Record<string, unknown>;
    quality = {
      score: coerceNum(q.score, MAX_SCORE),
      factors: coerceStrArray(q.factors, MAX_FACTORS),
    };
  }

  const assumptions = coerceStrArray(obj.assumptions, MAX_ASSUMPTIONS);

  const analysis: MealAnalysis = {
    dishName,
    items,
    totals: sumAndClampTotals(items),
    confidence,
  };
  if (quality) analysis.quality = quality;
  if (assumptions.length > 0) analysis.assumptions = assumptions;
  return analysis;
}

/**
 * Degenerate result → treat as "no food" (plan Q4). True when there are no
 * items at all, or the model is `low` confidence AND the result is degenerate
 * (all-zero totals, or a single empty-named item) — a menu/text photo otherwise
 * yields hallucinated, clamped-but-absurd numbers presented as a confident card.
 */
export function isNoFood(a: MealAnalysis): boolean {
  if (a.items.length === 0) return true;
  if (a.confidence !== "low") return false;
  const allZeroTotals = Object.values(a.totals).every((v) => v === 0);
  const singleUnnamed = a.items.length === 1 && a.items[0].name.trim() === "";
  return allZeroTotals || singleUnnamed;
}

/**
 * Gemini `responseSchema` (a SUBSET of JSON Schema — no `$ref`, uppercase type
 * names, ordering via `propertyOrdering`). `totals` is intentionally omitted —
 * we recompute it server-side. `quality`/`assumptions` are optional (not in
 * `required`) so the model may omit them.
 */
export const GEMINI_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    dishName: { type: "STRING" },
    confidence: { type: "STRING", enum: ["low", "medium", "high"] },
    items: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING" },
          portion: { type: "STRING" },
          estimatedGrams: { type: "NUMBER" },
          nutrients: {
            type: "OBJECT",
            properties: {
              calories: { type: "NUMBER" },
              protein: { type: "NUMBER" },
              carbs: { type: "NUMBER" },
              fat: { type: "NUMBER" },
              sugar: { type: "NUMBER" },
              fiber: { type: "NUMBER" },
              sodium: { type: "NUMBER" },
            },
            propertyOrdering: [
              "calories",
              "protein",
              "carbs",
              "fat",
              "sugar",
              "fiber",
              "sodium",
            ],
            required: [
              "calories",
              "protein",
              "carbs",
              "fat",
              "sugar",
              "fiber",
              "sodium",
            ],
          },
        },
        propertyOrdering: ["name", "portion", "estimatedGrams", "nutrients"],
        required: ["name", "portion", "estimatedGrams", "nutrients"],
      },
    },
    quality: {
      type: "OBJECT",
      properties: {
        score: { type: "NUMBER" },
        factors: { type: "ARRAY", items: { type: "STRING" } },
      },
      propertyOrdering: ["score", "factors"],
      required: ["score", "factors"],
    },
    assumptions: { type: "ARRAY", items: { type: "STRING" } },
  },
  propertyOrdering: ["dishName", "confidence", "items", "quality", "assumptions"],
  required: ["dishName", "confidence", "items"],
} as const;
