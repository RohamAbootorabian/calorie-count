/**
 * Safety / disclaimer copy (plan 0044), shared by the UI and the privacy policy so
 * the two can never drift. This is the `src/constants/legal.ts` extraction that
 * `src/features/legal/privacy-content.ts` was written to anticipate — features
 * import constants from here, never from the `legal` feature.
 *
 * WHY THE WORDING IS SHAPED THIS WAY (plan 0044, blockers B1/B2): a missing red
 * allergen warning means THREE different things — the model checked and found
 * nothing, the user declared no allergies so no check ran at all, or it's a
 * History edit where a check never runs. Copy that says "alerts can miss things"
 * would imply, in the last two cases, that a check happened. So the review-card
 * text states WHAT is checked and WHEN, which is true on every screen and for
 * every user (including under 0043's "Allergy check unavailable" line).
 *
 * English only, like the rest of the app; localizing safety copy is a known gap.
 */

/** Meal review card — shown whether or not an allergen warning is present. */
export const ANALYSIS_DISCLAIMER =
  'Calories, macros and allergens here are AI estimates and can be wrong or incomplete. ' +
  "We only check allergies you've entered in your profile, and only when a meal is analyzed. " +
  'Not medical advice — always check ingredients or ask before eating.';

/** Under the "food allergies" question (onboarding + Profile). */
export const ALLERGY_FIELD_HINT =
  'Used to flag possible allergens when a meal is analyzed. AI estimates can miss things — ' +
  'always check ingredients yourself.';

/**
 * Under the "medical conditions" question. Conditions never produce allergen
 * alerts (the Edge Function checks declared ALLERGIES only, plan 0043), so a user
 * who types e.g. "celiac" here would otherwise silently get no check at all.
 */
export const CONDITION_FIELD_HINT =
  "Conditions aren't used for allergen alerts. List food allergies or sensitivities in the " +
  'question above.';

/** Privacy policy: the same claim in policy voice (a caveat, not an instruction). */
export const LEGAL_ESTIMATE_CAVEAT =
  'Calorie, macro and allergen estimates in the app are AI-generated and are not medical or ' +
  'nutritional advice. Allergen alerts only cover allergies you have entered in your profile, ' +
  'can miss ingredients, and should never be your only check before eating.';
