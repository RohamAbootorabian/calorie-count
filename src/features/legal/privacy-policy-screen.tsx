/**
 * Privacy policy screen (plan 0010). Pure presentational — renders the policy
 * authored in `privacy-content.ts`. Reachable both signed-out (from sign-up) and
 * signed-in (from Settings) via the unguarded root `/privacy` route.
 *
 * Uses `<Screen scroll>` WITHOUT `tabBarInset` — this is a root Stack screen with
 * NO tab bar, so adding the tab inset would pad phantom space (plan review SF).
 * Outbound links use the shared `ExternalLink` (web new-tab / native in-app browser).
 */
import { StyleSheet, View } from 'react-native';

import { ExternalLink } from '@/components/external-link';
import { Spacing } from '@/constants/theme';
import { Screen, Text } from '@/shared/ui';

import {
  EFFECTIVE_DATE,
  OPENAI_PRIVACY_URL,
  PRIVACY_SECTIONS,
  SUPABASE_PRIVACY_URL,
} from './privacy-content';

export function PrivacyPolicyScreen() {
  return (
    <Screen scroll>
      <View style={styles.container}>
        <Text type="title">Privacy Policy</Text>
        <Text type="small" themeColor="textSecondary">
          Last updated: {EFFECTIVE_DATE}
        </Text>

        {PRIVACY_SECTIONS.map((section, index) => (
          <View key={section.heading} style={styles.section}>
            <Text type="subtitle">{section.heading}</Text>
            {section.body.map((paragraph, i) => (
              <Text key={i}>{paragraph}</Text>
            ))}

            {/* Outbound references attached to the section that mentions them. */}
            {index === 1 ? (
              <ExternalLink href={OPENAI_PRIVACY_URL}>
                <Text type="linkPrimary">OpenAI&apos;s privacy policy →</Text>
              </ExternalLink>
            ) : null}
            {index === 2 ? (
              <ExternalLink href={SUPABASE_PRIVACY_URL}>
                <Text type="linkPrimary">Supabase&apos;s privacy policy →</Text>
              </ExternalLink>
            ) : null}
          </View>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.two,
    paddingBottom: Spacing.four,
  },
  section: {
    gap: Spacing.two,
    marginTop: Spacing.three,
  },
});
