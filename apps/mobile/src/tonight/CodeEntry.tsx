import { useTranslations } from '@nomad/i18n';
import { Button, Text, TextField } from '@nomad/ui';
import { useState } from 'react';
import { View } from 'react-native';

import { parseNightLink } from './links';

export type CodeEntryProps = {
  /** A valid night code (4-8 digits), from a typed code or a pasted night link. */
  onCode: (code: string) => void;
  autoFocus?: boolean;
};

/**
 * "Enter the night code" (spec §4.2): the code on the host's screen, or a pasted kjbox.cc / sing link. Anything else
 * stays here with a hint. testIDs `tonight-code-input`, `tonight-code-submit`, `tonight-code-error`.
 */
export function CodeEntry({ onCode, autoFocus }: CodeEntryProps) {
  const t = useTranslations('tonight.code');
  const [value, setValue] = useState('');
  const [invalid, setInvalid] = useState(false);
  const submit = () => {
    const link = parseNightLink(value);
    if (!link) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    onCode(link.code);
  };
  return (
    <View className="gap-2">
      <TextField
        testID="tonight-code-input"
        label={t('label')}
        placeholder={t('placeholder')}
        value={value}
        onChangeText={(v) => {
          setValue(v);
          if (invalid) setInvalid(false);
        }}
        keyboardType="number-pad"
        autoCapitalize="none"
        autoFocus={autoFocus}
        returnKeyType="go"
        onSubmitEditing={submit}
      />
      {invalid ? (
        <Text testID="tonight-code-error" variant="error">
          {t('invalid')}
        </Text>
      ) : null}
      <Button testID="tonight-code-submit" label={t('submit')} onPress={submit} />
    </View>
  );
}
