import { useTranslations } from '@nomad/i18n';
import { Stack, useLocalSearchParams } from 'expo-router';

import { AddSong } from '../../tonight/other/AddSong';

/**
 * Add a song to tonight's log at another bar. Params `artist` + `title` (+ `song_key`): a song chosen elsewhere
 * (the song page's "Add to tonight"), which skips the search.
 */
export default function TonightAddRoute() {
  const t = useTranslations('tonight.other');
  const { artist, title, song_key } = useLocalSearchParams<{ artist?: string; title?: string; song_key?: string }>();
  const prefill = artist && title ? { artist, title, ...(song_key ? { song_key } : {}) } : undefined;
  return (
    <>
      <Stack.Screen options={{ title: t('addSong') }} />
      <AddSong prefill={prefill} />
    </>
  );
}
