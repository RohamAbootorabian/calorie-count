/**
 * Shared Storage constants for the meal-photo bucket (plan 0013).
 *
 * The bucket name was being hardcoded in every call site (`upload-meal-photo`,
 * `delete-meal-photo`, and now the history thumbnail signer). Centralize the one
 * literal so the bucket can never drift between upload, delete, and signed-read.
 */
export const MEAL_PHOTOS_BUCKET = 'meal-photos';
