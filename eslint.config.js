// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    // `supabase/**` is Deno code (esm.sh/jsr imports, Deno.* globals) that the
    // Expo/ESLint flat config can't parse — and ESLint does NOT read
    // tsconfig.exclude, so it must be ignored here too (plan 0008 B2).
    ignores: ["dist/*", "supabase/**"],
  }
]);
