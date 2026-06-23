/**
 * Sign-up screen. Email + password (+ confirm) → `signUp`. The Supabase project
 * has email confirmation ON, so a successful signup returns no session and sends a
 * confirmation email; we show a "check your email" state.
 *
 * B1 (anti-enumeration): we do NOT inspect the response to detect an already-
 * registered email — that's deliberately obfuscated. On success we always show the
 * same confirm state, and it always offers a "Sign in" link so an existing user is
 * never trapped (no email arrives for them). The `profiles` row is created by the
 * `handle_new_user` trigger — we never write it here.
 *
 * `emailRedirectTo` is omitted so Supabase uses the project Site URL for the
 * confirmation link (completed on Supabase's hosted page in v1; in-app deep-link
 * is plan 0005). SF2 mounted-guard applies after the await.
 */
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { supabase } from '@/lib/supabase';
import { Button, Input, Screen, Text } from '@/shared/ui';

import {
  getAuthErrorMessage,
  validateEmail,
  validatePassword,
  validatePasswordConfirm,
} from '../lib/auth-utils';

export function SignUpScreen() {
  const router = useRouter();
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [emailError, setEmailError] = useState<string>();
  const [passwordError, setPasswordError] = useState<string>();
  const [confirmError, setConfirmError] = useState<string>();
  const [formError, setFormError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleSignUp() {
    const eErr = validateEmail(email);
    const pErr = validatePassword(password);
    const cErr = validatePasswordConfirm(password, confirm);
    setEmailError(eErr);
    setPasswordError(pErr);
    setConfirmError(cErr);
    setFormError(undefined);
    if (eErr || pErr || cErr) return;

    setLoading(true);
    const { error } = await supabase.auth.signUp({ email: email.trim(), password });
    if (!mounted.current) return;
    if (error) {
      setFormError(getAuthErrorMessage(error));
    } else {
      setSubmitted(true); // B1: same state regardless of whether the email was new
    }
    setLoading(false);
  }

  if (submitted) {
    return (
      <Screen scroll contentContainerStyle={styles.center}>
        <View style={styles.content}>
          <Text type="subtitle">Check your email</Text>
          <Text type="small" themeColor="textSecondary">
            We sent a confirmation link to {email.trim()}. Tap it to finish, then come
            back and sign in.
          </Text>
          <View style={styles.form}>
            <Button onPress={() => router.replace('/sign-in')} fullWidth>
              Back to sign in
            </Button>
          </View>
        </View>
      </Screen>
    );
  }

  return (
    <Screen scroll contentContainerStyle={styles.center}>
      <View style={styles.content}>
        <Text type="subtitle">Create account</Text>
        <Text type="small" themeColor="textSecondary">
          Start tracking your meals
        </Text>

        <View style={styles.form}>
          <Input
            label="Email"
            value={email}
            onChangeText={(t) => { setEmail(t); setEmailError(undefined); setFormError(undefined); }}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            textContentType="emailAddress"
            error={emailError}
          />
          <Input
            label="Password"
            value={password}
            onChangeText={(t) => { setPassword(t); setPasswordError(undefined); setFormError(undefined); }}
            secureTextEntry
            autoComplete="new-password"
            textContentType="newPassword"
            error={passwordError}
            hint="At least 6 characters"
          />
          <Input
            label="Confirm password"
            value={confirm}
            onChangeText={(t) => { setConfirm(t); setConfirmError(undefined); setFormError(undefined); }}
            secureTextEntry
            autoComplete="new-password"
            textContentType="newPassword"
            error={confirmError}
          />

          {formError ? (
            <Text type="small" themeColor="textSecondary">
              {formError}
            </Text>
          ) : null}

          <Button onPress={handleSignUp} loading={loading} fullWidth>
            Create account
          </Button>

          <Text type="small" themeColor="textSecondary" style={styles.agree}>
            By creating an account you agree to our{' '}
            <Text type="linkPrimary" onPress={() => router.push('/privacy')}>
              Privacy Policy
            </Text>
            .
          </Text>

          <View style={styles.links}>
            <Text type="linkPrimary" onPress={() => router.push('/sign-in')}>
              Already have an account? Sign in
            </Text>
          </View>
        </View>
      </View>
    </Screen>
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
  links: {
    marginTop: Spacing.two,
    alignItems: 'center',
  },
  agree: {
    marginTop: Spacing.two,
    textAlign: 'center',
  },
});
