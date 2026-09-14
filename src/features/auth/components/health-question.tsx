/**
 * One health question (plan 0031, extracted + shared in plan 0034): a No/Yes selector
 * (default No, built on the same Button rows as the wizard/settings `SelectGroup`) that
 * reveals a centered multiline note on Yes. Presentational + PURELY controlled — the
 * parent owns the state and clears the note on "No" (and any saved/error banner). The
 * note is length-capped by `maxLength` (mirrors the DB check), so there's no validator.
 *
 * Used by BOTH the Settings screen and the onboarding wizard.
 */
import { StyleSheet, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { Button, Input, Text } from '@/shared/ui';

import { HEALTH_NOTE_MAX } from '../lib/profile-form';

export type HealthQuestionProps = {
  label: string;
  noLabel: string;
  yesLabel: string;
  notePlaceholder: string;
  value: boolean;
  onSelect: (next: boolean) => void;
  note: string;
  onChangeNote: (text: string) => void;
  disabled?: boolean;
};

export function HealthQuestion({
  label,
  noLabel,
  yesLabel,
  notePlaceholder,
  value,
  onSelect,
  note,
  onChangeNote,
  disabled,
}: HealthQuestionProps) {
  return (
    <View style={styles.group}>
      <Text type="smallBold" themeColor="textSecondary">
        {label}
      </Text>
      <Button variant={!value ? 'primary' : 'secondary'} onPress={() => onSelect(false)} fullWidth>
        {noLabel}
      </Button>
      <Button variant={value ? 'primary' : 'secondary'} onPress={() => onSelect(true)} fullWidth>
        {yesLabel}
      </Button>
      {value ? (
        <Input
          value={note}
          onChangeText={onChangeNote}
          placeholder={notePlaceholder}
          hint={`${[...note].length}/${HEALTH_NOTE_MAX}`}
          autoCapitalize="sentences"
          multiline
          maxLength={HEALTH_NOTE_MAX}
          editable={!disabled}
          textAlign="center"
          style={styles.healthNote}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: Spacing.two },
  healthNote: {
    minHeight: 88,
    textAlignVertical: 'top',
  },
});
