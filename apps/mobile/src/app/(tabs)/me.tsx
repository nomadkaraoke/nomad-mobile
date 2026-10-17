import { getMe } from '@nomad/api-gen';
import { LOCALE_NAMES, useTranslations } from '@nomad/i18n';
import { Button, Screen, Text } from '@nomad/ui';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { ActivityIndicator } from 'react-native';

import { useAuth } from '../../auth/store';
import { currentLocale } from '../../locale';

/** Me (spec §4.1): credit balance, buy credits, language, signed-in email, sign out. */
export default function MeScreen() {
  const t = useTranslations('account');
  const state = useAuth((s) => s.state);
  const signOut = useAuth((s) => s.signOut);
  const signedIn = state.status === 'signedIn';
  const me = useQuery({ queryKey: ['me', signedIn ? state.session.email : null], queryFn: getMe, enabled: signedIn });
  const locale = currentLocale();

  return (
    <Screen testID="me-screen" scroll>
      <Text variant="title">{t('title')}</Text>
      {signedIn ? (
        <>
          {me.data ? (
            <Text testID="me-credits" className="text-lg font-semibold">
              {t('credits', { credits: me.data.credits })}
            </Text>
          ) : (
            <ActivityIndicator testID="me-credits-loading" />
          )}
          <Button testID="me-buy" label={t('buyCredits')} onPress={() => router.push('/credits')} />
          <Text>{t('signedInAs', { email: state.session.email })}</Text>
        </>
      ) : (
        <Button
          testID="me-signin"
          label={t('signIn')}
          onPress={() => router.push({ pathname: '/sign-in', params: { returnTo: '/me' } })}
        />
      )}
      <Text variant="muted">{t('language')}</Text>
      <Text testID="me-language">{LOCALE_NAMES[locale]}</Text>
      {signedIn ? (
        <Button testID="me-signout" label={t('signOut')} variant="secondary" onPress={() => void signOut()} />
      ) : null}
    </Screen>
  );
}
