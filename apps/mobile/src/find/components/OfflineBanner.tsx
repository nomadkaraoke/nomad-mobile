import { useTranslations } from '@nomad/i18n';
import { Button, Text } from '@nomad/ui';
import { View } from 'react-native';

import type { OfflineIndexStatus } from '../../offline/offlineIndexStore';

const DAY_MS = 24 * 60 * 60 * 1000;

export type OfflineBannerProps = {
  status: OfflineIndexStatus;
  /** When the list on the phone was downloaded (null: no list). */
  downloadedAt: number | null;
  onDownload: () => void;
};

const daysSince = (at: number) => Math.max(0, Math.floor((Date.now() - at) / DAY_MS));

/** "Offline · searching songs saved on this phone (updated N days ago)", or the download offer with no list. */
export function OfflineBanner({ status, downloadedAt, onDownload }: OfflineBannerProps) {
  const t = useTranslations('discover');
  const hasList = downloadedAt !== null && (status === 'ready' || status === 'error' || status === 'downloading');
  if (hasList) {
    const days = daysSince(downloadedAt);
    return (
      <View testID="offline-banner" className="rounded-lg bg-border px-3 py-2">
        <Text className="text-xs">{t('offlineBanner', { days })}</Text>
      </View>
    );
  }
  return (
    <View testID="offline-banner" className="gap-2 rounded-lg bg-border px-3 py-2">
      <Text className="text-xs">{t('offlineNoList')}</Text>
      <Button
        testID="offline-download"
        label={t('offlineDownload')}
        variant="secondary"
        loading={status === 'downloading'}
        onPress={onDownload}
      />
    </View>
  );
}
