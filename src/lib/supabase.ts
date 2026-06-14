/**
 * Supabase client — our backend for auth, the Postgres database, image
 * storage, and the meal-analysis Edge Function.
 *
 * AsyncStorage persists the auth session across app restarts. The URL polyfill
 * is required because React Native's `URL` implementation is incomplete.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import "react-native-url-polyfill/auto";

import { env } from "./env";

export const supabase = createClient(env.supabaseUrl, env.supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    // RN has no URL bar, so there's no session to detect in the URL.
    detectSessionInUrl: false,
  },
});
