import type { RecSong } from '@nomad/api-decide';
import { isolate, useTranslations } from '@nomad/i18n';
import { Sheet, Text } from '@nomad/ui';
import { Pressable, View } from 'react-native';

export type SongMenuSheetProps = {
  /** The song the menu is open for; null = closed. */
  song: RecSong | null;
  onClose: () => void;
  onHide: (song: RecSong) => void;
  onLove: (song: RecSong) => void;
};

/** A picks row's ⋯ menu: Not for me (hide, with undo) and Love it. */
export function SongMenuSheet({ song, onClose, onHide, onLove }: SongMenuSheetProps) {
  const t = useTranslations('discover');
  const tc = useTranslations('common');
  const act = (fn: (s: RecSong) => void) => () => {
    if (!song) return;
    onClose();
    fn(song);
  };
  return (
    <Sheet
      visible={song !== null}
      onClose={onClose}
      testID="song-menu"
      closeLabel={tc('cancel')}
      title={song ? t('menuTitle', { title: isolate(song.title), artist: isolate(song.artist) }) : ''}
    >
      <View className="gap-1 py-2">
        <Pressable
          testID="song-menu-hide"
          accessibilityRole="button"
          onPress={act(onHide)}
          className="min-h-11 justify-center py-2"
        >
          <Text>{t('menuNotForMe')}</Text>
        </Pressable>
        <Pressable
          testID="song-menu-love"
          accessibilityRole="button"
          onPress={act(onLove)}
          className="min-h-11 justify-center py-2"
        >
          <Text>{t('menuLoveIt')}</Text>
        </Pressable>
      </View>
    </Sheet>
  );
}
