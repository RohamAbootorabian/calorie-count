/**
 * PLACEHOLDER auth screen — TEMP. S1 replaces this with the real sign-in /
 * sign-up / onboarding UI in `src/features/auth/`.
 *
 * The `__DEV__`-gated form exists only to prove the auth gate flips. It uses
 * `signInWithPassword` ONLY — never `signUp` — because the client points at the
 * production Supabase project (review B1). Create a throwaway test user in the
 * Supabase dashboard (Auth → Users) before testing. Metro compiles the entire
 * `__DEV__` branch out of production bundles.
 */
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { supabase } from '@/lib/supabase';
import { Button, Input, Screen, Text } from '@/shared/ui';
import { Spacing } from '@/constants/theme';

export default function SignInScreen() {
  return (
    <Screen scroll contentContainerStyle={styles.center}>
      <View style={styles.content}>
        <Text type="title">Calorie Counter</Text>
        <Text type="small" themeColor="textSecondary">
          Sign in to continue
        </Text>
        {__DEV__ ? <DevSignInForm /> : null}
      </View>
    </Screen>
  );
}

/** TEMP — remove when S1 ships the real auth screens. */
function DevSignInForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function handleSignIn() {
    setLoading(true);
    setError(undefined);
    // signInWithPassword ONLY (B1). The provider's onAuthStateChange flips the gate.
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (signInError) setError(signInError.message);
    setLoading(false);
  }

  return (
    <View style={styles.form}>
      <Text type="smallBold" themeColor="textSecondary">
        DEV sign-in (temporary)
      </Text>
      <Input
        label="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        textContentType="emailAddress"
      />
      <Input
        label="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        error={error}
      />
      <Button onPress={handleSignIn} loading={loading} fullWidth>
        Sign in
      </Button>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    justifyContent: 'center',
  },
  content: {
    gap: Spacing.two,
  },
  form: {
    marginTop: Spacing.four,
    gap: Spacing.two,
  },
});
