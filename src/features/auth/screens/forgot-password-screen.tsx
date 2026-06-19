/**
 * Forgot-password screen. Sends a reset email via `resetPasswordForEmail`. In v1
 * the user completes the reset on Supabase's hosted page (the in-app set-new-
 * password deep-link is plan 0005), so we just confirm the email was sent.
 *
 * Anti-enumeration: show the same "check your email" state whether or not the
 * address is registered — never reveal which. SF2 mounted-guard after the await.
 */
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { supabase } from '@/lib/supabase';
import { Button, Input, Screen, Text } from '@/shared/ui';

import { getAuthErrorMessage, validateEmail } from '../lib/auth-utils';

export function ForgotPasswordScreen() {
  const router = useRouter();
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string>();
  const [formError, setFormError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSend() {
    const eErr = validateEmail(email);
    setEmailError(eErr);
    setFormError(undefined);
    if (eErr) return;

    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim());
    if (!mounted.current) return;
    if (error) {
      setFormError(getAuthErrorMessage(error));
    } else {
      setSent(true);
    }
    setLoading(false);
  }

  if (sent) {
    return (
      <Screen scroll contentContainerStyle={styles.center}>
        <View style={styles.content}>
          <Text type="subtitle">Check your email</Text>
          <Text type="small" themeColor="textSecondary">
            If an account exists for {email.trim()}, we sent a password-reset link.
            Tap it to set a new password, then come back and sign in.
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
        <Text type="subtitle">Reset password</Text>
        <Text type="small" themeColor="textSecondary">
          Enter your email and we&apos;ll send a reset link
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

          {formError ? (
            <Text type="small" themeColor="textSecondary">
              {formError}
            </Text>
          ) : null}

          <Button onPress={handleSend} loading={loading} fullWidth>
            Send reset link
          </Button>

          <View style={styles.links}>
            <Text type="linkPrimary" onPress={() => router.push('/sign-in')}>
              Back to sign in
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
});
