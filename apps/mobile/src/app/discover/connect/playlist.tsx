import { useTranslations } from '@nomad/i18n';
import { Button, Screen, Text } from '@nomad/ui';
import { useEffect } from 'react';

import { openSignIn } from '../../../auth/signInUi';
import { useAuth } from '../../../auth/store';
import { PlaylistImport } from '../../../discover/connect/PlaylistImport';

const RETURN_TO = '/discover/connect/playlist';

/** "Paste a playlist link" (Phase 3b spec §5.3). Personal data, so signed out it opens sign-in first. */
export default function PlaylistRoute() {
  const signedIn = useAuth((s) => s.state.status === 'signedIn');
  useEffect(() => {
    if (!signedIn) openSignIn(RETURN_TO);
  }, [signedIn]);
  if (!signedIn) return <SignedOut />;
  return <PlaylistImport />;
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
