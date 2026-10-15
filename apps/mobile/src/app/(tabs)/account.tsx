import { LOCALE_NAMES, useTranslations } from '@nomad/i18n';
import { Button, Screen, Text } from '@nomad/ui';
import { router } from 'expo-router';

import { useAuth } from '../../auth/store';
import { currentLocale } from '../../locale';

export default function AccountScreen() {
  const t = useTranslations('account');
  const state = useAuth((s) => s.state);
  const signOut = useAuth((s) => s.signOut);
  const locale = currentLocale();

  return (
    <Screen testID="account-screen">
      <Text variant="title">{t('title')}</Text>
      {state.status === 'signedIn' ? (
        <>
          <Text>{t('signedInAs', { email: state.session.email })}</Text>
          <Button testID="account-signout" label={t('signOut')} variant="secondary" onPress={() => void signOut()} />
        </>
      ) : (
        <Button
          testID="account-signin"
          label={t('signIn')}
          onPress={() => router.push({ pathname: '/sign-in/email', params: { returnTo: '/account' } })}
        />
      )}
      <Text variant="muted">{t('language')}</Text>
      <Text testID="account-language">{LOCALE_NAMES[locale]}</Text>
    </Screen>
  );
}
