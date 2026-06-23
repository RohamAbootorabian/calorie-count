/**
 * Privacy policy content (plan 0010) — authored as DATA, not JSX, so the prose is
 * diff-reviewable and the screen stays dumb. Every factual claim here was
 * cross-checked against the code during plan review:
 *   - OpenAI GPT-4o-mini vision, called server-side (key is an Edge secret; the
 *     phone never calls OpenAI directly) — `supabase/functions/analyze-meal/`.
 *   - Private `meal-photos` bucket + owner-only RLS — `20260619102510_initial_schema.sql`.
 *   - Collected data mirrors the real schema, incl. the `goals` body inputs from
 *     `20260619192848_goals_body_inputs.sql`.
 *   - Deletion is honest: there is NO self-serve delete and a row delete does NOT
 *     remove the Storage photo file (0007 SF9), so deletion is an email request.
 *
 * Constants are grouped separately from the section prose so a future
 * `src/constants/legal.ts` extraction (shared with ToS / store metadata) is trivial.
 */

// --- Legal metadata (confirmed with the user, 2026-06-23) -------------------
export const COMPANY_NAME = 'Heart Harmona';
export const CONTACT_EMAIL = 'saba@heartharmona.com';
/** Human-readable "last updated" shown at the top of the policy. */
export const EFFECTIVE_DATE = 'June 23, 2026';

// --- Outbound references (open in a new tab / in-app browser) ---------------
export const OPENAI_PRIVACY_URL = 'https://openai.com/policies/privacy-policy/';
export const SUPABASE_PRIVACY_URL = 'https://supabase.com/privacy';

/** One policy section: a heading and one or more body paragraphs. */
export type PolicySection = {
  heading: string;
  /** Each entry is its own paragraph. */
  body: string[];
};

/**
 * The policy, in order. Plain language; truthful to current behavior. Outbound
 * links are rendered by the screen after the section that references them
 * (OpenAI after §2, Supabase after §3) — the URLs above are the single source.
 */
export const PRIVACY_SECTIONS: PolicySection[] = [
  {
    heading: 'What we collect',
    body: [
      'Your account email address.',
      'Your profile: the display name, units (metric or imperial), and time zone you set.',
      'The details you enter to set your goals — age, sex, height, weight, activity level, and weight goal — and the daily calorie and macro targets we compute from them.',
      'The meal photos you capture, and the food items and nutrition estimates you review and save.',
    ],
  },
  {
    heading: 'How your meal photos are analyzed',
    body: [
      'When you analyze a meal, your photo and a short instruction are sent — through our own server, never directly from your phone — to OpenAI (the GPT-4o-mini vision model), which returns an estimate of the foods and their nutrition.',
      `As of ${EFFECTIVE_DATE}, OpenAI states that it does not use data submitted through its API to train its models. We can't control a third party's terms, so please review OpenAI's own privacy policy for the current details.`,
    ],
  },
  {
    heading: 'Where your data is stored',
    body: [
      'Your data is stored with our cloud provider, Supabase. Your meal photos live in a private storage area that only your account can access, and your database records are protected so that only you can read them.',
      "We don't log your photos or the contents of your meal analyses.",
    ],
  },
  {
    heading: 'Retention and deletion',
    body: [
      'We keep your meals, photos, and profile data until you ask us to delete them.',
      `To delete your data or your account, email us at ${CONTACT_EMAIL} and we'll remove it.`,
    ],
  },
  {
    heading: 'What we don’t do',
    body: [
      "We don't sell your data. We share it only with the providers we need to run the app — OpenAI to analyze your meal photos, and Supabase to store your data.",
    ],
  },
  {
    heading: 'Contact',
    body: [
      `Questions about your privacy, or want your data deleted? Email ${CONTACT_EMAIL}.`,
    ],
  },
];
