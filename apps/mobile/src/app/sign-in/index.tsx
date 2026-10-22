import { isolate, useTranslations } from '@nomad/i18n';
import { Ionicons } from '@expo/vector-icons';
import { GoogleLogo, Screen, SocialButton, Text, TextField } from '@nomad/ui';
import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';

import { finishSignIn, useSignInErrorText, type SignInParams } from '../../auth/signInUi';
import { appleAvailable, signInWithApple, signInWithGoogle, type SocialResult } from '../../auth/social';
import { useAuth } from '../../auth/store';
import { fakeSocialEnabled } from '../../config';
import { isFreshIntent, useMakeIntent } from '../../make/intentStore';

const PRIVACY_URL = 'https://nomadkaraoke.com/privacy';

/**
 * The sign-in sheet: Apple (iOS, first, as Apple asks), Google, or email. Opened by the make flow with
 * returnTo=/make/new. Provider buttons follow each provider's branding for dark backgrounds.
 */
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
        {returnTo === '/make/new' && isFreshIntent(intent)
          ? t('sheetTitle', { title: isolate(intent.title) })
          : t('sheetTitleGeneric')}
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
      {showApple ? (
        <SocialButton
          testID="signin-apple"
          variant="apple"
          label={t('apple')}
          icon={<Ionicons name="logo-apple" size={22} color="#000000" />}
          onPress={() => void social('apple', signInWithApple)}
          loading={busy === 'apple'}
          disabled={busy !== null}
        />
      ) : null}
      <SocialButton
        testID="signin-google"
        variant="google"
        label={t('google')}
        icon={<GoogleLogo size={20} />}
        onPress={() => void social('google', signInWithGoogle)}
        loading={busy === 'google'}
        disabled={busy !== null}
      />
      <View className="flex-row items-center gap-3 py-1">
        <View className="h-px flex-1 bg-border" />
        <Text variant="muted">{t('or')}</Text>
        <View className="h-px flex-1 bg-border" />
      </View>
      <SocialButton
        testID="signin-email-start"
        variant="outline"
        label={t('email')}
        icon={<Ionicons name="mail-outline" size={20} color="#F4F4F5" />}
        disabled={busy !== null}
        onPress={() => router.replace({ pathname: '/sign-in/email', params: returnTo ? { returnTo } : {} })}
      />
      {showApple ? <Text variant="muted">{t('appleRelayNote')}</Text> : null}
      {error ? (
        <Text testID="signin-error" variant="error">
          {error}
        </Text>
      ) : null}
      <Pressable
        testID="signin-privacy"
        accessibilityRole="link"
        onPress={() => void WebBrowser.openBrowserAsync(PRIVACY_URL)}
        className="min-h-11 justify-center self-start"
      >
        <Text variant="muted" className="underline">
          {t('privacy')}
        </Text>
      </Pressable>
    </Screen>
  );
}
