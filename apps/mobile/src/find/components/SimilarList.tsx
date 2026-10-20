import type { SongGroup } from '@nomad/api-decide';
import { useTranslations } from '@nomad/i18n';
import { Text } from '@nomad/ui';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

export type SimilarListProps = {
  groups: SongGroup[];
  /** "Other songs with similar names (N)" under a song card; "Songs with karaoke versions" otherwise. */
  heading: 'similar' | 'results';
  /** Rows before "Show N more" (null: all). */
  cap: number | null;
  onOpen: (group: SongGroup) => void;
};

/** Song rows (title · artist · N karaoke versions), each opening the song page. */
export function SimilarList({ groups, heading, cap, onOpen }: SimilarListProps) {
  const t = useTranslations();
  const [all, setAll] = useState(false);
  if (groups.length === 0) return null;
  const shown = all || cap === null ? groups : groups.slice(0, cap);
  const hidden = groups.length - shown.length;
  return (
    <View testID="similar-list" className="gap-0.5">
      <Text className="text-xs font-bold uppercase text-muted">
        {heading === 'similar' ? t('discover.similarHeading', { count: groups.length }) : t('discover.resultsHeading')}
      </Text>
      {shown.map((g, i) => (
        <Pressable
          key={g.song_key}
          testID={`similar-row-${i}`}
          accessibilityRole="button"
          onPress={() => onOpen(g)}
          className="border-b border-border py-2.5"
        >
          <Text className="font-semibold">{g.title}</Text>
          <Text variant="muted">{g.artist}</Text>
          <Text variant="muted" className={g.version_count > 0 ? 'text-gold' : ''}>
            {t('find.karaokeVersions', { count: g.version_count })}
          </Text>
        </Pressable>
      ))}
      {hidden > 0 ? (
        <Pressable testID="similar-show-more" accessibilityRole="button" hitSlop={8} onPress={() => setAll(true)} className="py-2">
          <Text className="text-sm font-semibold text-primary">{t('discover.showMore', { count: hidden })}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
