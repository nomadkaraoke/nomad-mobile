import { useTranslations } from '@nomad/i18n';
import { Button, Text } from '@nomad/ui';
import { router, type Href } from 'expo-router';
import { View } from 'react-native';

import { GetMadeRow, GetMadeUndoToast } from './GetMadeRow';
import { Shelf } from './Shelf';
import { useGetMade } from './useGetMade';

const MAX = 3;

/** Get this made on the Me home: the top three songs with Make it / Request it free, and See all. Nothing when empty. */
export function GetMadeShelf() {
  const t = useTranslations('me.getMade');
  const { items, offline, makeDisabled, error, refetch, dismiss, undismiss, request } = useGetMade();
  const toast = <GetMadeUndoToast prefix="me-getmade" onUndo={undismiss} />;
  if (error) {
    return (
      <Shelf testID="me-getmade" title={t('title')}>
        <View className="gap-2 rounded-xl border border-border bg-card p-3">
          <Text testID="me-getmade-error" variant="muted">
            {t('loadError')}
          </Text>
          <Button testID="me-getmade-retry" label={t('retry')} variant="secondary" onPress={refetch} />
        </View>
      </Shelf>
    );
  }
  if (items.length === 0) return toast;
  return (
    <Shelf testID="me-getmade" title={t('title')} onSeeAll={() => router.push('/me/get-made' as Href)}>
      {toast}
      {items.slice(0, MAX).map((row, i) => (
        <GetMadeRow key={row.key} row={row} index={i} prefix="me-getmade" offline={offline} makeDisabled={makeDisabled} onRequest={request} onDismiss={dismiss} />
      ))}
    </Shelf>
  );
}
