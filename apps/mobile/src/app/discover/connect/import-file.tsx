import { useTranslations } from '@nomad/i18n';
import { Button, Screen, Text } from '@nomad/ui';
import { useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';

import { openSignIn } from '../../../auth/signInUi';
import { useAuth } from '../../../auth/store';
import { ImportFile } from '../../../discover/connect/ImportFile';

/**
 * Import a picked (or shared) privacy export: `?file=<uri>&name=<file name>` (Phase 3b spec §5.4). The import
 * belongs to an account, so signed out it opens sign-in first and comes back here with the same file.
 */
export default function ImportFileRoute() {
  const { file, name } = useLocalSearchParams<{ file?: string; name?: string }>();
  const signedIn = useAuth((s) => s.state.status === 'signedIn');
  const returnTo = `/discover/connect/import-file?file=${encodeURIComponent(file ?? '')}&name=${encodeURIComponent(name ?? '')}`;
  useEffect(() => {
    if (!signedIn) openSignIn(returnTo);
  }, [signedIn, returnTo]);
  if (!signedIn) return <SignedOut returnTo={returnTo} />;
  if (!file) return <NoFile />;
  return <ImportFile key={file} uri={file} name={name ?? ''} />;
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

function NoFile() {
  const t = useTranslations('connect');
  return (
    <Screen testID="connect-import-file" underHeader>
      <Text testID="connect-import-error" variant="error">
        {t('errors.notAnExport')}
      </Text>
    </Screen>
  );
}
