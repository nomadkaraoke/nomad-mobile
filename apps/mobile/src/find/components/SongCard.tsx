import type { SongRef } from '@nomad/api-decide';
import { isolate, useTranslations } from '@nomad/i18n';
import { Text } from '@nomad/ui';
import { Pressable, View } from 'react-native';

import type { Announce } from '../outcome';

export type SongCardProps = {
  song: SongRef;
  announce: Announce;
  onOpen: () => void;
  /** "keep what I typed" (cosmetic) / "Undo" (content). */
  onUndo: () => void;
  /** Absent when there is nothing else to offer. */
  onNotIt?: () => void;
};

/** "🎵 The song you mean": the identified song, with gen's "Tidied to … · keep what I typed" / "Corrected to … · Undo". */
export function SongCard({ song, announce, onOpen, onUndo, onNotIt }: SongCardProps) {
  const t = useTranslations('discover');
  const value = isolate(t('songValue', { title: song.title, artist: song.artist }));
  return (
    <Pressable
      testID="song-card"
      accessibilityRole="button"
      onPress={onOpen}
      className="gap-1 rounded-xl border border-primary/40 bg-primary/10 p-3"
    >
      <Text className="text-xs font-bold uppercase text-primary">{t('songYouMean')}</Text>
      <Text className="text-lg font-semibold">{song.title}</Text>
      <Text variant="muted">{song.artist}</Text>
      {announce ? (
        <Text variant="muted" testID="song-card-announce">
          {announce.kind === 'cosmetic'
            ? t('tidiedTo', { value })
            : t('correctedTo', { value, typed: isolate(announce.typed) })}
        </Text>
      ) : null}
      {announce || onNotIt ? (
        <View className="flex-row flex-wrap gap-4 pt-1">
          {announce ? (
            <Pressable testID="song-card-undo" accessibilityRole="button" onPress={onUndo} hitSlop={8}>
              <Text className="text-sm font-semibold text-primary">
                {announce.kind === 'cosmetic' ? t('keepTyped') : t('undo')}
              </Text>
            </Pressable>
          ) : null}
          {onNotIt ? (
            <Pressable testID="song-card-not-it" accessibilityRole="button" onPress={onNotIt} hitSlop={8}>
              <Text className="text-sm font-semibold text-primary">{t('notIt')}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
}
