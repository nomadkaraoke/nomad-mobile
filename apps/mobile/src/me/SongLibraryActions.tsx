import { useTranslations } from '@nomad/i18n';
import { Button } from '@nomad/ui';
import { useState } from 'react';
import { View } from 'react-native';

import { AddToSetlistSheet } from './AddToSetlistSheet';
import { MarkSungSheet } from './MarkSungSheet';
import { useSaveSong } from './useSaveSong';

export type LibrarySong = { artist: string; title: string; song_key?: string | null };

/**
 * The song page's library actions: Save to My songs (needs a catalogued song_key: decide's love is keyed by it),
 * Add to setlist, Mark as sung.
 */
export function SongLibraryActions({ song }: { song: LibrarySong }) {
  const t = useTranslations('song');
  const { saved, toggle } = useSaveSong();
  const [sheet, setSheet] = useState<'setlist' | 'sung' | null>(null);
  const key = song.song_key ?? null;
  const isSaved = key ? saved(key) : false;
  const close = () => setSheet(null);
  const logSong = { artist: song.artist, title: song.title, ...(key ? { song_key: key } : {}) };
  return (
    <View testID="song-library-actions" className="gap-2">
      {key ? (
        <Button
          testID="song-save"
          variant="secondary"
          label={isSaved ? t('saved') : t('save')}
          onPress={() => toggle({ artist: song.artist, title: song.title, song_key: key })}
        />
      ) : null}
      <Button testID="song-add-setlist" variant="secondary" label={t('addToSetlist')} onPress={() => setSheet('setlist')} />
      <Button testID="song-mark-sung" variant="secondary" label={t('markSung')} onPress={() => setSheet('sung')} />
      <AddToSetlistSheet song={sheet === 'setlist' ? song : null} onClose={close} />
      <MarkSungSheet song={sheet === 'sung' ? logSong : null} onClose={close} />
    </View>
  );
}
