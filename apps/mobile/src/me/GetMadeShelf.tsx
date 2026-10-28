import { useTranslations } from '@nomad/i18n';
import { router, type Href } from 'expo-router';

import { GetMadeRow, GetMadeUndoToast } from './GetMadeRow';
import { Shelf } from './Shelf';
import { useGetMade } from './useGetMade';

const MAX = 3;

/** Get this made on the Me home: the top three songs with Make it / Request it free, and See all. Nothing when empty. */
export function GetMadeShelf() {
  const t = useTranslations('me.getMade');
  const { items, offline, dismiss, undismiss, request } = useGetMade();
  const toast = <GetMadeUndoToast prefix="me-getmade" onUndo={undismiss} />;
  if (items.length === 0) return toast;
  return (
    <Shelf testID="me-getmade" title={t('title')} onSeeAll={() => router.push('/me/get-made' as Href)}>
      {toast}
      {items.slice(0, MAX).map((row, i) => (
        <GetMadeRow key={row.key} row={row} index={i} prefix="me-getmade" offline={offline} onRequest={request} onDismiss={dismiss} />
      ))}
    </Shelf>
  );
}
