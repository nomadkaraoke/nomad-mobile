import type { PlaylistItemOut } from '@nomad/api-decide';
import { KARAFUN_LIBRARY_CODE, type LibraryTagged } from '@nomad/core';
import { isolate, useTranslations } from '@nomad/i18n';
import { Button, Text } from '@nomad/ui';
import { View } from 'react-native';

import { LibraryBadge } from '../find/library';
import { artistLabel } from '../tonight/log/logStore';
import { SongTonightAction } from '../tonight/other/SongTonightAction';
import { ArrowButton } from '../ui/ArrowButton';

/** The facets as the library badge wants them: community from a community version, KaraFun from its library code. */
const tagged = (f: PlaylistItemOut['facets']): LibraryTagged => ({
  libraries: f?.karafun ? [KARAFUN_LIBRARY_CODE] : [],
  versions: f?.community ? [{ kind: 'community' as const }] : [],
});

/** Names of an item; a legacy item with none shows its song_key (decide never fills names with it). */
export function itemSong(item: PlaylistItemOut) {
  return { artist: item.artist, title: item.title || (item.artist ? '' : (item.song_key ?? '')), song_key: item.song_key ?? undefined };
}

/** No karaoke version known: no facets (not catalogued) or `has_karaoke === false`. */
export const needsMake = (item: PlaylistItemOut) => !item.facets || item.facets.has_karaoke === false;

export type SetlistItemRowProps = {
  item: PlaylistItemOut;
  index: number;
  count: number;
  editing: boolean;
  onMove(by: -1 | 1): void;
  onSung(): void;
  onMake(): void;
  onRemove(): void;
};

export function SetlistItemRow({ item, index: i, count, editing, onMove, onSung, onMake, onRemove }: SetlistItemRowProps) {
  const t = useTranslations('me.setlists');
  const tOther = useTranslations('tonight.other');
  const s = itemSong(item);
  const artist = s.artist ? artistLabel(s.artist, tOther('unknownArtist')) : '';
  const name = isolate(artist ? t('songValue', { title: s.title || s.song_key || '', artist }) : s.title);
  return (
    <View testID={`setlist-item-${i}`} className="gap-2 border-b border-border px-4 py-3">
      <View className="flex-row items-center gap-2">
        {editing ? <Text className="w-8 text-center font-bold">{t('number', { number: i + 1 })}</Text> : null}
        <View className="flex-1 gap-1">
          <Text className="font-semibold" numberOfLines={2}>
            {isolate(s.title)}
          </Text>
          {artist ? (
            <Text variant="muted" numberOfLines={1}>
              {isolate(artist)}
            </Text>
          ) : null}
          {item.facets ? <LibraryBadge song={tagged(item.facets)} /> : null}
        </View>
        {editing ? (
          <>
            <ArrowButton testID={`setlist-item-up-${i}`} glyph="▲" label={t('up', { song: name })} disabled={i === 0} onPress={() => onMove(-1)} />
            <ArrowButton testID={`setlist-item-down-${i}`} glyph="▼" label={t('down', { song: name })} disabled={i === count - 1} onPress={() => onMove(1)} />
          </>
        ) : null}
      </View>
      {editing ? null : (
        <View className="flex-row flex-wrap gap-2">
          <SongTonightAction song={{ artist: s.artist, title: s.title, song_key: s.song_key }} testID={`setlist-item-tonight-${i}`} />
          <Button testID={`setlist-item-sung-${i}`} variant="secondary" label={t('sung')} onPress={onSung} />
          {needsMake(item) ? <Button testID={`setlist-item-make-${i}`} variant="secondary" label={t('make')} onPress={onMake} /> : null}
          <Button testID={`setlist-item-remove-${i}`} variant="secondary" label={t('remove')} onPress={onRemove} />
        </View>
      )}
    </View>
  );
}
