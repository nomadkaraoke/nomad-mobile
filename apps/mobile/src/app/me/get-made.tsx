import { useTranslations } from '@nomad/i18n';
import { Button, Screen, Text } from '@nomad/ui';
import { ActivityIndicator } from 'react-native';

import { GetMadeLimitLine, GetMadeRow, GetMadeUndoToast } from '../../me/GetMadeRow';
import { useGetMade } from '../../me/useGetMade';

/** Me → Get this made → See all: every song with no karaoke version yet (spec §6.9). */
export default function GetMadeScreen() {
  const t = useTranslations('me.getMade');
  const { items, limit, loading, offline, makeDisabled, error, refetch, dismiss, undismiss, request } = useGetMade();
  return (
    <Screen testID="me-getmade-screen" scroll>
      {/* The native header already shows the title (_layout: me.getMade.title). */}
      <Text variant="muted">{t('intro')}</Text>
      {offline ? (
        <Text testID="getmade-offline" variant="muted">
          {t('offline')}
        </Text>
      ) : null}
      <GetMadeUndoToast prefix="getmade" onUndo={undismiss} />
      <GetMadeLimitLine prefix="getmade" limit={limit} />
      {loading ? <ActivityIndicator testID="getmade-loading" /> : null}
      {error ? (
        <>
          <Text testID="getmade-error" variant="muted">
            {t('loadError')}
          </Text>
          <Button testID="getmade-retry" label={t('retry')} variant="secondary" onPress={refetch} />
        </>
      ) : null}
      {!loading && !error && items.length === 0 ? (
        <Text testID="getmade-empty" variant="muted">
          {t('empty')}
        </Text>
      ) : null}
      {items.map((row, i) => (
        <GetMadeRow key={row.key} row={row} index={i} offline={offline} makeDisabled={makeDisabled} onRequest={request} onDismiss={dismiss} />
      ))}
    </Screen>
  );
}
