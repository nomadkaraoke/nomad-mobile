import { useTranslations } from '@nomad/i18n';
import { Button, Screen, Text, TextField } from '@nomad/ui';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { useSignInErrorText, type SignInParams } from '../../auth/signInUi';
import { useAuth } from '../../auth/store';

export default function SignInEmailScreen() {
  const t = useTranslations('signIn');
  const errorText = useSignInErrorText();
  const { returnTo } = useLocalSearchParams<SignInParams>();
  const requestCode = useAuth((s) => s.requestCode);
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const onSend = async () => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await requestCode(email);
      router.replace({ pathname: '/sign-in/code', params: returnTo ? { returnTo } : {} });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen testID="signin-email-screen" scroll>
      <Text variant="title">{t('emailTitle')}</Text>
      <TextField
        testID="signin-email"
        label={t('emailLabel')}
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoComplete="email"
        textContentType="emailAddress"
        autoCapitalize="none"
        autoFocus
        returnKeyType="send"
        onSubmitEditing={() => void onSend()}
      />
      {error ? (
        <Text testID="signin-error" variant="error">
          {error}
        </Text>
      ) : null}
      <Button testID="signin-send" label={t('sendCode')} onPress={() => void onSend()} loading={busy} />
    </Screen>
  );
}
