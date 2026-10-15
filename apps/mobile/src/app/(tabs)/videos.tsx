import { useTranslations } from '@nomad/i18n';
import { Button, Screen, Text } from '@nomad/ui';
import { router } from 'expo-router';

import { useAuth } from '../../auth/store';

export default function VideosScreen() {
  const t = useTranslations();
  const signedIn = useAuth((s) => s.state.status === 'signedIn');
  return (
    <Screen testID="videos-screen">
      <Text variant="title">{t('tabs.videos')}</Text>
      {signedIn ? (
        <>
          <Text testID="videos-empty">{t('videos.emptyTitle')}</Text>
          <Text variant="muted">{t('videos.emptyBody')}</Text>
        </>
      ) : (
        <>
          <Text variant="muted">{t('videos.signInPrompt')}</Text>
          <Button
            testID="videos-signin"
            label={t('account.signIn')}
            onPress={() => router.push({ pathname: '/sign-in/email', params: { returnTo: '/videos' } })}
          />
        </>
      )}
    </Screen>
  );
}
