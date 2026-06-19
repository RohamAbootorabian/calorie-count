/**
 * Pure helpers for the auth screens: input validation + Supabase error → friendly
 * copy. No UI, no side effects, no logging — safe to unit-test.
 *
 * PRIVACY: never echo raw Supabase error messages, tokens, or whether an email is
 * registered. Unknown errors collapse to a generic fallback (plan 0004 SF1/B1).
 */
import type { AuthError } from '@supabase/supabase-js';

/** Mirrors the Supabase project's `minimum_password_length` (config.toml = 6). */
export const PASSWORD_MIN_LENGTH = 6;

// Deliberately loose: real validity is enforced server-side. This only catches
// obvious typos before we spend a network round-trip.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateEmail(raw: string): string | undefined {
  const email = raw.trim();
  if (!email) return 'Enter your email address.';
  if (!EMAIL_RE.test(email)) return 'Enter a valid email address.';
  return undefined;
}

export function validatePassword(password: string): string | undefined {
  if (!password) return 'Enter a password.';
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  return undefined;
}

export function validatePasswordConfirm(password: string, confirm: string): string | undefined {
  if (!confirm) return 'Re-enter your password.';
  if (password !== confirm) return 'Passwords do not match.';
  return undefined;
}

/**
 * Map a Supabase `AuthError` (or unknown thrown value) to user-facing copy.
 * Branches on the stable `code` field; falls back by name/shape, then to a
 * generic message so we never surface a raw backend string.
 */
export function getAuthErrorMessage(error: unknown): string {
  const code = (error as AuthError | undefined)?.code;
  switch (code) {
    case 'invalid_credentials':
      return 'Incorrect email or password.';
    case 'email_not_confirmed':
      return 'Please confirm your email first — check your inbox for the link.';
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit':
      return 'Too many attempts. Please wait a minute and try again.';
    case 'weak_password':
      return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
    case 'user_already_exists':
      return 'An account with this email already exists. Try signing in.';
    case 'validation_failed':
      return 'Please check the details you entered.';
  }

  // Network / fetch failures surface as AuthRetryableFetchError (no stable code).
  const name = (error as { name?: string } | undefined)?.name;
  if (name === 'AuthRetryableFetchError' || error instanceof TypeError) {
    return 'Network error. Check your connection and try again.';
  }

  return 'Something went wrong. Please try again.';
}
