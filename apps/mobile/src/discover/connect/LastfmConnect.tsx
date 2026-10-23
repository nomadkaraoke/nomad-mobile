import { connectLastfm } from '@nomad/api-decide';
import { useTranslations } from '@nomad/i18n';
import { Screen, Text } from '@nomad/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { useOffline } from '../../net/useOffline';
import { SERVICES_SUMMARY_KEY } from './queries';
import { useSyncWait } from './useSyncWait';
import { SyncStatus, UsernameConnect } from './UsernameConnect';

/** Last.fm (spec §5.5): a username (decide answers 422 for an unknown one), then a sync and what it added. */
export function LastfmConnect() {
  const t = useTranslations('connect');
  const offline = useOffline();
  const queryClient = useQueryClient();
  const sync = useSyncWait('lastfm');

  const onConnected = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: SERVICES_SUMMARY_KEY });
    void sync.start();
  }, [queryClient, sync]);

  return (
    <Screen testID="connect-lastfm" scroll underHeader>
      <Text variant="muted">{t('lastfm.intro')}</Text>
      {offline ? (
        <Text testID="connect-offline" variant="error" accessibilityLiveRegion="polite">
          {t('offline')}
        </Text>
      ) : null}
      <UsernameConnect
        service="lastfm"
        label={t('lastfm.username')}
        submitLabel={t('lastfm.submit')}
        connect={connectLastfm}
        onConnected={onConnected}
        disabled={offline || sync.phase === 'syncing'}
      />
      <SyncStatus phase={sync.phase} counts={sync.counts} />
    </Screen>
  );
}
