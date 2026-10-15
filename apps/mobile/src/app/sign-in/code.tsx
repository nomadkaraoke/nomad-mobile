import { useTranslations } from '@nomad/i18n';
import { Button, Screen, Text, TextField } from '@nomad/ui';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useState } from 'react';

import { useAuth } from '../../auth/store';

export default function SignInCodeScreen() {
  const t = useTranslations('signIn');
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const state = useAuth((s) => s.state);
  const verify = useAuth((s) => s.verify);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const onVerify = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await verify(code);
      router.dismissTo((returnTo ?? '/find') as Href);
    } catch {
      setError(t('codeInvalid'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen testID="signin-code-screen" scroll>
      <Text variant="title">{t('codeTitle')}</Text>
      {state.status === 'codeSent' ? <Text variant="muted">{t('codeHelp', { email: state.email })}</Text> : null}
      <TextField
        testID="signin-code"
        label={t('codeLabel')}
        value={code}
        onChangeText={setCode}
        error={error}
        keyboardType="number-pad"
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        autoFocus
        onSubmitEditing={() => void onVerify()}
      />
      <Button testID="signin-verify" label={t('verify')} onPress={() => void onVerify()} loading={busy} />
    </Screen>
  );
}
