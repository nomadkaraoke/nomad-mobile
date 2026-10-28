import { searchSongs } from '@nomad/api-kjbox';
import { sameSong } from '@nomad/core';
import { useTranslations } from '@nomad/i18n';
import { Button } from '@nomad/ui';
import { router } from 'expo-router';
import { useState } from 'react';

import type { LogSong } from '../log/logStore';
import { useNightStore } from '../nightStore';
import { defaultChoice, useRequestStore } from '../request/requestStore';
import { ADD_ROUTE } from './OtherNightScreen';

const norm = (s: string) => s.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();

/**
 * The one box group that is this song, or null when none or several are: the groups matching by artist + title
 * (`sameSong`, which also accepts a credit overlap such as "Muse feat. X"), narrowed to exact-artist matches when
 * there are any. Only a single survivor is preselected; anything else is the singer's choice in the results.
 */
export function unambiguousMatch<T extends { artist: string; title: string }>(groups: readonly T[], song: LogSong): T | null {
  const matches = groups.filter((g) => sameSong(g, song));
  const exact = matches.filter((g) => norm(g.artist) === norm(song.artist));
  const pool = exact.length > 0 ? exact : matches;
  return pool.length === 1 ? pool[0]! : null;
}

/**
 * "Request tonight" at a Nomad night: the box's search for "<artist> <title>"; an unambiguous match opens the
 * confirm with its default version, anything else (none, several, an error) opens the results for that query.
 */
async function requestTonight(code: string, nightId: string, song: LogSong): Promise<void> {
  const q = `${song.artist} ${song.title}`;
  try {
    const r = await searchSongs(code, q, undefined, nightId);
    const best = unambiguousMatch(r.songs ?? [], song);
    if (best) {
      const store = useRequestStore.getState();
      store.clear();
      store.pick(best, defaultChoice(best), q);
      router.push('/tonight/confirm');
      return;
    }
  } catch {
    // The results screen shows the error and a retry.
  }
  router.push({ pathname: '/tonight/search' as never, params: { q } });
}

/**
 * The song page's one Tonight action (spec §6.2, ruling E9-R5): "Request tonight" during a Nomad night, "Add to
 * tonight" during an Other night, nothing otherwise.
 */
export function SongTonightAction({ song, testID = 'song-tonight-action' }: { song: LogSong; testID?: string }) {
  const t = useTranslations('tonight.other');
  const night = useNightStore((s) => s.active);
  const [busy, setBusy] = useState(false);
  if (!night) return null;
  if (night.kind === 'other') {
    return (
      <Button
        testID={testID}
        variant="secondary"
        label={t('addToTonight')}
        onPress={() =>
          router.push({
            pathname: ADD_ROUTE as never,
            params: { artist: song.artist, title: song.title, ...(song.song_key ? { song_key: song.song_key } : {}) },
          })
        }
      />
    );
  }
  const onPress = () => {
    if (busy) return;
    setBusy(true);
    void requestTonight(night.code, night.nightId, song).finally(() => setBusy(false));
  };
  return <Button testID={testID} variant="secondary" label={t('requestTonight')} onPress={onPress} loading={busy} />;
}
