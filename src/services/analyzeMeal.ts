/**
 * Meal-photo analysis service.
 *
 * Architectural rule: the phone NEVER calls the AI provider directly (that
 * would leak the API key). Instead it uploads/sends the image to a Supabase
 * Edge Function named `analyze-meal`, which calls the vision model with a
 * prompt that forces a structured JSON response matching `MealAnalysis`.
 *
 * This module is the client-side seam for that call. The Edge Function itself
 * lives under `supabase/functions/analyze-meal/` (to be created).
 */
import { supabase } from "@/lib/supabase";
import { MealAnalysis, sumNutrients } from "@/types/nutrition";

export interface AnalyzeMealInput {
  /** A base64-encoded JPEG/PNG of the meal, or a public image URL. */
  image: { base64: string } | { url: string };
}

/**
 * Send a meal photo to the backend and get a structured nutrition estimate.
 *
 * Throws if the function errors or returns an unexpected shape — callers should
 * surface a friendly "couldn't read that photo, try again" message.
 */
export async function analyzeMeal(
  input: AnalyzeMealInput,
): Promise<MealAnalysis> {
  const { data, error } = await supabase.functions.invoke<MealAnalysis>(
    "analyze-meal",
    { body: input },
  );

  if (error) throw new Error(`Meal analysis failed: ${error.message}`);
  if (!data) throw new Error("Meal analysis returned no data.");

  // Trust-but-verify: recompute totals from items so the UI never shows a
  // total that disagrees with the breakdown the user is editing.
  return { ...data, totals: sumNutrients(data.items.map((i) => i.nutrients)) };
}
