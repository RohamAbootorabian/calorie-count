/**
 * Sign-in screen. Email + password → `signInWithPassword`. On success the trunk
 * auth provider's `onAuthStateChange` flips the gate to `(app)` — this screen does
 * NOT navigate manually. Links out to sign-up and forgot-password.
 *
 * The gate can unmount this screen the instant sign-in succeeds, so every setState
 * after an `await` is guarded by `mounted` (plan 0004 SF2).
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
} from '../lib/auth-utils';

export function SignInScreen() {
  const router = useRouter();
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailError, setEmailError] = useState<string>();
  const [passwordError, setPasswordError] = useState<string>();
  const [formError, setFormError] = useState<string>();
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);

  async function handleSignIn() {
    const eErr = validateEmail(email);
    const pErr = validatePassword(password);
    setEmailError(eErr);
    setPasswordError(pErr);
    setFormError(undefined);
    setNeedsConfirm(false);
    if (eErr || pErr) return;

    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (!mounted.current) return; // gate may have unmounted us on success
    if (error) {
      setFormError(getAuthErrorMessage(error));
      if (error.code === 'email_not_confirmed') setNeedsConfirm(true);
    }
    setLoading(false);
  }

  async function handleResend() {
    setResending(true);
    const { error } = await supabase.auth.resend({ type: 'signup', email: email.trim() });
    if (!mounted.current) return;
    setFormError(
      error ? getAuthErrorMessage(error) : 'Confirmation email sent — check your inbox.',
    );
    setResending(false);
  }

  return (
    <Screen scroll contentContainerStyle={styles.center}>
      <View style={styles.content}>
        <Text type="title">Calorie Counter</Text>
        <Text type="small" themeColor="textSecondary">
          Sign in to continue
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
            autoComplete="current-password"
            textContentType="password"
            error={passwordError}
          />

          {formError ? (
            <Text type="small" themeColor="textSecondary">
              {formError}
            </Text>
          ) : null}

          {needsConfirm ? (
            <Button variant="ghost" onPress={handleResend} loading={resending}>
              Resend confirmation email
            </Button>
          ) : null}

          <Button onPress={handleSignIn} loading={loading} fullWidth>
            Sign in
          </Button>

          <View style={styles.links}>
            <Text type="linkPrimary" onPress={() => router.push('/forgot-password')}>
              Forgot password?
            </Text>
            <Text type="linkPrimary" onPress={() => router.push('/sign-up')}>
              Create account
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
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
});
