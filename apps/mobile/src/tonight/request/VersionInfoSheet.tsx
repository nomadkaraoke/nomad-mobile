import type { SearchVersion } from '@nomad/api-kjbox';
import { useTranslations } from '@nomad/i18n';
import { Text } from '@nomad/ui';
import { View } from 'react-native';

import { TonightSheet } from '../TonightSheet';
import { availability, brandName, humanSize, versionClass, versionFormat } from './VersionRow';

export type VersionInfoSheetProps = {
  /** null = closed. */
  version: SearchVersion | null;
  onClose: () => void;
};

/**
 * About a version (A.21): Community vs Commercial in plain words, who made it, the format and where it plays from.
 * The box's file path is never shown.
 */
export function VersionInfoSheet({ version, onClose }: VersionInfoSheetProps) {
  const t = useTranslations('tonight.request.version');
  const cls = version ? versionClass(version) : 'unknown';
  const avail = version ? availability(version) : null;
  return (
    <TonightSheet
      visible={version !== null}
      onClose={onClose}
      title={(version && brandName(version)) || t('unknownBrand')}
      testID="tonight-version-info"
      closeLabel={t('close')}
    >
      {version ? (
        <View className="gap-3">
          {cls !== 'unknown' ? (
            <View testID="tonight-version-info-class" className="gap-1">
              <Text className="font-bold">{cls === 'community' ? t('communityTitle') : t('commercialTitle')}</Text>
              <Text>{cls === 'community' ? t('communityWhat') : t('commercialWhat')}</Text>
              <Text variant="muted">{cls === 'community' ? t('communityHow') : t('commercialHow')}</Text>
            </View>
          ) : null}
          {version.priority_stated ? <Text variant="muted">{t('starNote')}</Text> : null}
          <View testID="tonight-version-info-tech" className="gap-1">
            <Text className="font-bold">{t('techTitle')}</Text>
            <Text>{t('format', { format: versionFormat(version) })}</Text>
            {avail?.bytes ? <Text>{t('fileSize', { size: humanSize(avail.bytes) })}</Text> : null}
            <Text variant="muted">
              {avail?.tier === 'sure' ? t('sourceLocal') : avail?.tier === 'high' ? t('sourceCloudNoSize') : t('sourceYouTube')}
            </Text>
          </View>
        </View>
      ) : null}
    </TonightSheet>
  );
}
