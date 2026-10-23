import { useTranslations } from '@nomad/i18n';
import { Button, Screen, Text } from '@nomad/ui';
import { useEffect } from 'react';

import { openSignIn } from '../../../auth/signInUi';
import { useAuth } from '../../../auth/store';
import { ConnectHub } from '../../../discover/connect/ConnectHub';

const RETURN_TO = '/discover/connect';

/** "Connect your music" (Phase 3b spec §5.1). Everything here is personal, so signed out it opens sign-in first. */
export default function ConnectRoute() {
  const signedIn = useAuth((s) => s.state.status === 'signedIn');
  useEffect(() => {
    if (!signedIn) openSignIn(RETURN_TO);
  }, [signedIn]);
  if (!signedIn) return <SignedOut />;
  return <ConnectHub />;
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
