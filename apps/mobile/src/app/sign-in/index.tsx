import { useTranslations } from '@nomad/i18n';
import { Button, Screen, Text, TextField } from '@nomad/ui';
import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { Pressable } from 'react-native';

import { finishSignIn, useSignInErrorText, type SignInParams } from '../../auth/signInUi';
import { appleAvailable, signInWithApple, signInWithGoogle, type SocialResult } from '../../auth/social';
import { useAuth } from '../../auth/store';
import { fakeSocialEnabled } from '../../config';
import { isFreshIntent, useMakeIntent } from '../../make/intentStore';

const PRIVACY_URL = 'https://nomadkaraoke.com/privacy';

/** The sign-in sheet: Google, Apple (iOS), or email. Opened by the make flow with returnTo=/make. */
export default function SignInSheet() {
  const t = useTranslations('signIn');
  const errorText = useSignInErrorText();
  const { returnTo } = useLocalSearchParams<SignInParams>();
  const intent = useMakeIntent((s) => s.intent);
  const signInWithSession = useAuth((s) => s.signInWithSession);
  const [showApple, setShowApple] = useState(false);
  const [busy, setBusy] = useState<'google' | 'apple' | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [fakeEmail, setFakeEmail] = useState('');
  const fake = fakeSocialEnabled();

  useEffect(() => {
    let live = true;
    // Fake mode shows Apple everywhere so E2E can drive the fake Apple path on Android too.
    void (fake ? Promise.resolve(true) : appleAvailable()).then((ok) => live && setShowApple(ok));
    return () => {
      live = false;
    };
  }, [fake]);

  const social = async (provider: 'google' | 'apple', run: (o: { fakeEmail: string }) => Promise<SocialResult>) => {
    setBusy(provider);
    setError(undefined);
    try {
      const result = await run({ fakeEmail });
      if (result === 'cancelled') return;
      await signInWithSession(result);
      finishSignIn(returnTo);
    } catch (e) {
      setError(errorText(e, provider));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen testID="signin-sheet" scroll>
      <Text variant="title">
        {isFreshIntent(intent) ? t('sheetTitle', { title: intent.title }) : t('sheetTitleGeneric')}
      </Text>
      <Text variant="muted">{t('sheetBody')}</Text>
      {fake ? (
        <TextField
          testID="signin-fake-email"
          label={t('fakeEmailLabel')}
          value={fakeEmail}
          onChangeText={setFakeEmail}
          keyboardType="email-address"
          autoCapitalize="none"
        />
      ) : null}
      <Button
        testID="signin-google"
        label={t('google')}
        onPress={() => void social('google', signInWithGoogle)}
        loading={busy === 'google'}
        disabled={busy !== null}
      />
      {showApple ? (
        <>
          <Button
            testID="signin-apple"
            label={t('apple')}
            variant="secondary"
            onPress={() => void social('apple', signInWithApple)}
            loading={busy === 'apple'}
            disabled={busy !== null}
          />
          <Text variant="muted">{t('appleRelayNote')}</Text>
        </>
      ) : null}
      <Button
        testID="signin-email-start"
        label={t('email')}
        variant="secondary"
        disabled={busy !== null}
        onPress={() => router.replace({ pathname: '/sign-in/email', params: returnTo ? { returnTo } : {} })}
      />
      {error ? (
        <Text testID="signin-error" variant="error">
          {error}
        </Text>
      ) : null}
      <Pressable testID="signin-privacy" accessibilityRole="link" onPress={() => void WebBrowser.openBrowserAsync(PRIVACY_URL)}>
        <Text variant="muted" className="underline">
          {t('privacy')}
        </Text>
      </Pressable>
    </Screen>
  );
}
