import type { Version } from '@nomad/api-decide';
import { useTranslations } from '@nomad/i18n';
import { Text } from '@nomad/ui';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { openYouTubeUrl } from '../../media/youtube';

/** Rows shown before "Show all N". */
export const VERSIONS_SHOWN = 5;

export type VersionListProps = {
  /** Best first (decide `rank_version`); may be capped below `total` by the search API. */
  versions: Version[];
  /** The song's full version count. */
  total: number;
  /** "Show all N" when `versions` holds fewer than `total` (opens the song page, which lists them all). */
  onShowAll?: () => void;
  /** Opens a community row's YouTube link (default: the system browser / YouTube app). */
  openUrl?: (url: string) => void;
};

const openExternal = (url: string) => void openYouTubeUrl(url).catch(() => {});

function VersionRow({ v, index, openUrl }: { v: Version; index: number; openUrl: (url: string) => void }) {
  const t = useTranslations('discover');
  const community = v.kind === 'community';
  return (
    <View testID={`version-row-${index}`} className="flex-row items-center justify-between gap-2 rounded-lg bg-card px-3 py-2">
      <View className="flex-1 flex-row items-center gap-2">
        <Text
          testID={`version-row-${index}-kind`}
          className={`overflow-hidden rounded-full px-2 py-0.5 text-xs font-bold ${
            community ? 'bg-success/15 text-success' : 'bg-purple/20 text-purple'
          }`}
        >
          {community ? t('community') : t('commercial')}
        </Text>
        <Text className="flex-1" numberOfLines={1}>
          {v.brand_name}
        </Text>
      </View>
      {v.youtube_url ? (
        <Pressable
          testID={`version-row-${index}-youtube`}
          accessibilityRole="link"
          hitSlop={8}
          onPress={() => openUrl(v.youtube_url!)}
        >
          <Text className="text-sm font-semibold text-primary">{t('youtube')}</Text>
        </Pressable>
      ) : (
        <Text variant="muted" className="text-xs">
          {t('libraryOrDisc')}
        </Text>
      )}
    </View>
  );
}

/** "Karaoke versions (N)": Community / Commercial pills, the full brand name, YouTube or "in a library or on disc". */
export function VersionList({ versions, total, onShowAll, openUrl = openExternal }: VersionListProps) {
  const t = useTranslations('discover');
  const [expanded, setExpanded] = useState(false);
  const count = Math.max(total, versions.length);
  const shown = expanded ? versions : versions.slice(0, VERSIONS_SHOWN);
  const canShowAll = !expanded && count > VERSIONS_SHOWN;
  return (
    <View testID="version-list" className="gap-1.5">
      <Text className="text-xs font-bold uppercase text-muted">{t('versionsHeading', { count })}</Text>
      {shown.map((v, i) => (
        <VersionRow key={`${v.brand_code}-${i}`} v={v} index={i} openUrl={openUrl} />
      ))}
      {canShowAll ? (
        <Pressable
          testID="versions-show-all"
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => (versions.length >= count || !onShowAll ? setExpanded(true) : onShowAll())}
        >
          <Text className="text-sm font-semibold text-primary">{t('showAll', { count })}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
