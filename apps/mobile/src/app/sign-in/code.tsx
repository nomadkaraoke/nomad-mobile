import { useTranslations } from '@nomad/i18n';
import { Button, CodeField, Screen, Text } from '@nomad/ui';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { finishSignIn, useSignInErrorText, type SignInParams } from '../../auth/signInUi';
import { useAuth } from '../../auth/store';

export default function SignInCodeScreen() {
  const t = useTranslations('signIn');
  const errorText = useSignInErrorText();
  const { returnTo } = useLocalSearchParams<SignInParams>();
  const state = useAuth((s) => s.state);
  const attemptsLeft = useAuth((s) => s.attemptsLeft);
  const verify = useAuth((s) => s.verify);
  const requestCode = useAuth((s) => s.requestCode);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | undefined>();
  const [busy, setBusy] = useState<'verify' | 'resend' | null>(null);
  const email = state.status === 'codeSent' ? state.email : null;
  const locked = attemptsLeft <= 0;

  const onVerify = async (value = code) => {
    if (busy) return;
    setBusy('verify');
    setError(undefined);
    setNotice(undefined);
    try {
      await verify(value);
      finishSignIn(returnTo);
    } catch (e) {
      // Start the next try from empty boxes, so a new digit can't resubmit the rejected code.
      setCode('');
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const onResend = async () => {
    if (!email || busy) return;
    setBusy('resend');
    setError(undefined);
    try {
      await requestCode(email);
      setCode('');
      setNotice(t('resent', { email }));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen testID="signin-code-screen" scroll>
      <Text variant="title">{t('codeTitle')}</Text>
      {email ? <Text variant="muted">{notice ?? t('codeHelp', { email })}</Text> : null}
      <CodeField
        testID="signin-code"
        label={t('codeLabel')}
        value={code}
        onChangeText={setCode}
        onFilled={(digits) => void onVerify(digits)}
        invalid={Boolean(error)}
        autoFocus
      />
      {error ? (
        <Text testID="signin-error" variant="error">
          {error}
        </Text>
      ) : null}
      <Button
        testID="signin-verify"
        label={t('verify')}
        onPress={() => void onVerify()}
        loading={busy === 'verify'}
        disabled={locked || busy === 'resend'}
      />
      <Button
        testID="signin-resend"
        label={t('resend')}
        variant={locked ? 'primary' : 'secondary'}
        onPress={() => void onResend()}
        loading={busy === 'resend'}
        disabled={!email || busy === 'verify'}
      />
    </Screen>
  );
}
