import type { Song } from '@nomad/api-kjbox';
import { useTranslations } from '@nomad/i18n';
import { Button, Text } from '@nomad/ui';
import { View } from 'react-native';

import { SongRow, type SongRowActions } from './SongRow';
import { songKey } from './model';

export type YourSongsProps = SongRowActions & {
  /** `me.songs`: already in queue order from the box (on stage, position, approved, pending, rejected/removed; A.49). */
  songs: Song[];
  /** Someone is singing now: place 2 then reads "You're next, right after this song", as on the status tile. */
  someoneOnStage?: boolean;
  readOnly?: boolean;
  onDismiss?: (song: Song) => void;
  /** E5: open the request flow. */
  onRequest?: () => void;
  /** E6: enter reorder mode (shown with two or more songs). */
  onReorder?: () => void;
};

/** Your songs (spec §4.1): own, friend, host- and partner-added rows in the box's queue order. */
export function YourSongs({ songs, readOnly, onDismiss, onRequest, onReorder, someoneOnStage, ...actions }: YourSongsProps) {
  const t = useTranslations('tonight.night');
  return (
    <View testID="tonight-your-songs" className="gap-2">
      <Text className="text-lg font-bold">{t('songs.title')}</Text>
      {songs.length === 0 ? (
        <Text testID="tonight-songs-empty" variant="muted">
          {t('songs.empty')}
        </Text>
      ) : (
        songs.map((s) => <SongRow key={songKey(s)} song={s} readOnly={readOnly} onDismiss={onDismiss} someoneOnStage={someoneOnStage} {...actions} />)
      )}
      {!readOnly && songs.length > 1 ? (
        <Button testID="tonight-reorder" variant="secondary" label={t('songs.reorder')} onPress={() => onReorder?.()} />
      ) : null}
      {!readOnly ? <Button testID="tonight-request" label={t('songs.request')} onPress={() => onRequest?.()} /> : null}
    </View>
  );
}
