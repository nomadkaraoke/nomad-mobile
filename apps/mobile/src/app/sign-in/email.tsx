import { useTranslations } from '@nomad/i18n';
import { Button, Screen, Text, TextField } from '@nomad/ui';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { isAuthMocked } from '../../auth/authApi';
import { useAuth } from '../../auth/store';

export default function SignInEmailScreen() {
  const t = useTranslations('signIn');
  const tc = useTranslations('common');
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const requestCode = useAuth((s) => s.requestCode);
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const onSend = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await requestCode(email);
      router.replace({ pathname: '/sign-in/code', params: returnTo ? { returnTo } : {} });
    } catch (e) {
      setError(e instanceof Error && e.message === 'invalid_email' ? t('emailInvalid') : tc('error'));
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
        error={error}
        keyboardType="email-address"
        autoComplete="email"
        textContentType="emailAddress"
        autoCapitalize="none"
        autoFocus
        returnKeyType="send"
        onSubmitEditing={() => void onSend()}
      />
      <Button testID="signin-send" label={t('sendCode')} onPress={() => void onSend()} loading={busy} />
      {isAuthMocked() ? <Text variant="muted">{t('devMockNotice')}</Text> : null}
    </Screen>
  );
}
