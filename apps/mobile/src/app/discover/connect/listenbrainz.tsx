import { useTranslations } from '@nomad/i18n';
import { Button, Screen, Text } from '@nomad/ui';
import { useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';

import { openSignIn } from '../../../auth/signInUi';
import { useAuth } from '../../../auth/store';
import { ListenBrainzConnect } from '../../../discover/connect/ListenBrainzConnect';

const RETURN_TO = '/discover/connect/listenbrainz';

/**
 * ListenBrainz (Phase 3b spec §5.5). `?status=&reason=` is an OAuth return that cold-started the app
 * (+native-intent). Personal data, so signed out it opens sign-in first.
 */
export default function ListenBrainzRoute() {
  const { status, reason } = useLocalSearchParams<{ status?: string; reason?: string }>();
  const signedIn = useAuth((s) => s.state.status === 'signedIn');
  useEffect(() => {
    if (!signedIn) openSignIn(RETURN_TO);
  }, [signedIn]);
  if (!signedIn) return <SignedOut />;
  return <ListenBrainzConnect oauthReturn={status ? { status, reason } : undefined} />;
}

function SignedOut() {
  const t = useTranslations('discover');
  return (
    <Screen testID="connect-signed-out" underHeader>
      <Text className="text-lg font-semibold">{t('signInForPicks')}</Text>
      <Text variant="muted">{t('signInForPicksBody')}</Text>
      <Button testID="connect-signin" label={t('signInForPicksAction')} onPress={() => openSignIn(RETURN_TO)} />
    </Screen>
  );
}
