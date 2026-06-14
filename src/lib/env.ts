/**
 * Typed, validated access to public environment variables.
 *
 * Expo inlines any `EXPO_PUBLIC_*` var at build time. We read them once here so
 * the rest of the app gets a typed object and a clear error if config is
 * missing, instead of mysterious runtime failures deep in a network call.
 */

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing env var ${name}. Copy .env.example to .env and fill it in.`,
    );
  }
  return value;
}

export const env = {
  supabaseUrl: required(
    "EXPO_PUBLIC_SUPABASE_URL",
    process.env.EXPO_PUBLIC_SUPABASE_URL,
  ),
  supabaseAnonKey: required(
    "EXPO_PUBLIC_SUPABASE_ANON_KEY",
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  ),
};
