import type { RecSong } from '@nomad/api-decide';
import { KARAFUN_LIBRARY_CODE, reasonKey, type LibraryTagged } from '@nomad/core';
import { isolate, useTranslations } from '@nomad/i18n';
import { Text } from '@nomad/ui';
import { Pressable, View } from 'react-native';

import { LibraryBadge } from '../../find/library';
import { FitBadge } from '../../voice/FitBadge';

/** A non-word glyph: the meaning comes from the accessibility label. */
const MENU_GLYPH = '⋯';
const HEART_GLYPH = '♥';

/** decide's karaoke flags as the library tags LibraryBadge reads. */
export const recLibraries = (song: RecSong): LibraryTagged => ({
  versions: song.karaoke.community ? [{ kind: 'community' }] : [],
  libraries: song.karaoke.karafun ? [KARAFUN_LIBRARY_CODE] : [],
});

export type RecSongRowProps = {
  song: RecSong;
  /** sectionTestId(section.id) and the row's index in its section. */
  idPart: string;
  loved: boolean;
  onOpen: () => void;
  onMenu: () => void;
};

/** Title, artist, reason chip ("You know this", "Like Muse") and library badges; ⋯ opens the song menu. */
export function RecSongRow({ song, idPart, loved, onOpen, onMenu }: RecSongRowProps) {
  const t = useTranslations('discover');
  const tAll = useTranslations();
  const reason = tAll(reasonKey(song.reason_type), { artist: isolate(song.reason_artist ?? song.artist) });
  return (
    <View className="flex-row items-center border-b border-border">
      <Pressable
        testID={`rec-row-${idPart}`}
        accessibilityRole="button"
        onPress={onOpen}
        className="flex-1 gap-1 py-3"
      >
        <Text className="font-semibold">{song.title}</Text>
        <Text variant="muted">{song.artist}</Text>
        <View className="flex-row flex-wrap items-center gap-1.5">
          <View className="rounded-full bg-card px-2 py-0.5">
            <Text className="text-xs text-muted">{reason}</Text>
          </View>
          <LibraryBadge song={recLibraries(song)} />
          <FitBadge fit={song.fit} testID={`fit-badge-${idPart}`} />
          {loved ? (
            <Text testID={`rec-loved-${idPart}`} accessibilityLabel={t('loved')} className="text-xs text-primary">
              {HEART_GLYPH}
            </Text>
          ) : null}
        </View>
      </Pressable>
      <Pressable
        testID={`rec-menu-${idPart}`}
        accessibilityRole="button"
        accessibilityLabel={t('menuOpen', { title: isolate(song.title) })}
        onPress={onMenu}
        hitSlop={4}
        className="h-11 w-11 items-center justify-center"
      >
        <Text className="text-lg text-muted" importantForAccessibility="no" accessibilityElementsHidden>
          {MENU_GLYPH}
        </Text>
      </Pressable>
    </View>
  );
}
