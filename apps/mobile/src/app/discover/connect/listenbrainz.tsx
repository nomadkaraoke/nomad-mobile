import { useTranslations } from '@nomad/i18n';
import { Button, Screen, Text } from '@nomad/ui';
import { useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';

import { openSignIn } from '../../../auth/signInUi';
import { useAuth } from '../../../auth/store';
import { ListenBrainzConnect } from '../../../discover/connect/ListenBrainzConnect';
import { lbScreenPath, sanitizeLbReturn } from '../../../discover/connect/lbReturn';

/**
 * ListenBrainz (Phase 3b spec §5.5). `?status=&reason=` is an OAuth return that cold-started the app
 * (+native-intent); any link can open this route, so the params are sanitised here too. Personal data, so signed
 * out it opens sign-in first, coming back with the same result.
 */
export default function ListenBrainzRoute() {
  const { status, reason } = useLocalSearchParams<{ status?: string; reason?: string }>();
  const signedIn = useAuth((s) => s.state.status === 'signedIn');
  const result = sanitizeLbReturn(status, reason);
  const returnTo = lbScreenPath(result);
  useEffect(() => {
    if (!signedIn) openSignIn(returnTo);
  }, [signedIn, returnTo]);
  if (!signedIn) return <SignedOut returnTo={returnTo} />;
  return <ListenBrainzConnect oauthReturn={result} />;
}

function SignedOut({ returnTo }: { returnTo: string }) {
  const t = useTranslations('discover');
  return (
    <Screen testID="connect-signed-out" underHeader>
      <Text className="text-lg font-semibold">{t('signInForPicks')}</Text>
      <Text variant="muted">{t('signInForPicksBody')}</Text>
      <Button testID="connect-signin" label={t('signInForPicksAction')} onPress={() => openSignIn(returnTo)} />
    </Screen>
  );
}
