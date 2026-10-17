import { useTranslations } from '@nomad/i18n';
import { Button, Screen, Text } from '@nomad/ui';
import { router } from 'expo-router';

import { useAuth } from '../../auth/store';

/** The Make tab. Task 6 fills it with the person's jobs; for now the empty and signed-out states. */
export default function MakeTabScreen() {
  const t = useTranslations();
  const signedIn = useAuth((s) => s.state.status === 'signedIn');
  return (
    <Screen testID="make-tab-screen">
      <Text variant="title">{t('makeTab.title')}</Text>
      {signedIn ? (
        <>
          <Text testID="make-tab-empty">{t('makeTab.emptyTitle')}</Text>
          <Text variant="muted">{t('makeTab.emptyBody')}</Text>
        </>
      ) : (
        <>
          <Text variant="muted">{t('makeTab.signInPrompt')}</Text>
          <Button
            testID="make-tab-signin"
            label={t('account.signIn')}
            onPress={() => router.push({ pathname: '/sign-in', params: { returnTo: '/(tabs)/make' } })}
          />
        </>
      )}
    </Screen>
  );
}
