import type { RecSong } from '@nomad/api-decide';
import { isolate, useTranslations } from '@nomad/i18n';
import { Sheet, Text } from '@nomad/ui';
import { useState } from 'react';
import { Platform, Pressable, View } from 'react-native';

export type SongMenuSheetProps = {
  /** The song the menu is open for; null = closed. */
  song: RecSong | null;
  onClose: () => void;
  onHide: (song: RecSong) => void;
  onLove: (song: RecSong) => void;
  /** Whether this song is already saved (the Save item then reads "Saved"). */
  saved?: boolean;
  /** Shown when provided: opens the Add to setlist sheet. */
  onAddToSetlist?: (song: RecSong) => void;
  /** Shown when provided: opens the Mark as sung sheet. */
  onMarkSung?: (song: RecSong) => void;
  /** Feedback needs a connection: both actions are inert while offline. */
  disabled?: boolean;
};

/** A picks row's ⋯ menu: Not for me (hide, with undo), Save to My songs, Add to setlist and Mark as sung. */
export function SongMenuSheet({ song, onClose, onHide, onLove, saved = false, onAddToSetlist, onMarkSung, disabled = false }: SongMenuSheetProps) {
  const t = useTranslations('discover');
  const tc = useTranslations('common');
  // A follow-up sheet opens once this one has finished closing (iOS drops a Modal presented while another dismisses).
  const [after, setAfter] = useState<(() => void) | null>(null);
  const act = (fn: (s: RecSong) => void) => () => {
    if (!song || disabled) return;
    onClose();
    fn(song);
  };
  /** Library actions are queued on the phone, so they work offline too (`disabled` doesn't apply). */
  const open = (fn: (s: RecSong) => void) => () => {
    if (!song) return;
    onClose();
    if (Platform.OS === 'ios') setAfter(() => () => fn(song));
    else fn(song);
  };
  return (
    <Sheet
      visible={song !== null}
      onClose={onClose}
      testID="song-menu"
      onDismiss={() => {
        const next = after;
        setAfter(null);
        next?.();
      }}
      closeLabel={tc('cancel')}
      title={song ? t('menuTitle', { title: isolate(song.title), artist: isolate(song.artist) }) : ''}
    >
      <View className="gap-1 py-2">
        <Pressable
          testID="song-menu-hide"
          accessibilityRole="button"
          accessibilityState={{ disabled }}
          onPress={act(onHide)}
          className={`min-h-11 justify-center py-2 ${disabled ? 'opacity-50' : ''}`}
        >
          <Text>{t('menuNotForMe')}</Text>
        </Pressable>
        <Pressable
          testID="song-menu-love"
          accessibilityRole="button"
          accessibilityState={{ disabled }}
          onPress={act(onLove)}
          className={`min-h-11 justify-center py-2 ${disabled ? 'opacity-50' : ''}`}
        >
          <Text>{saved ? t('menuSaved') : t('menuLoveIt')}</Text>
        </Pressable>
        {onAddToSetlist ? (
          <Pressable testID="song-menu-setlist" accessibilityRole="button" onPress={open(onAddToSetlist)} className="min-h-11 justify-center py-2">
            <Text>{t('menuAddToSetlist')}</Text>
          </Pressable>
        ) : null}
        {onMarkSung ? (
          <Pressable testID="song-menu-sung" accessibilityRole="button" onPress={open(onMarkSung)} className="min-h-11 justify-center py-2">
            <Text>{t('menuMarkSung')}</Text>
          </Pressable>
        ) : null}
      </View>
    </Sheet>
  );
}
