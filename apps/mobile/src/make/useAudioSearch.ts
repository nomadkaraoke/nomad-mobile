import { searchAudio } from '@nomad/api-gen';
import { useMutation } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';

type Song = { artist: string; title: string };

/**
 * gen's standalone audio search for the song being made (spec §4.4). It can take ~45s, and it answers 402
 * before searching when the person has no credits. Runs once per song when the screen mounts; `run()`
 * searches again (retry, an expired search session, back from checkout).
 */
export function useAudioSearch(song: Song | null) {
  const search = useMutation({ mutationFn: (s: Song) => searchAudio(s.artist, s.title) });
  const { mutate } = search;
  const artist = song?.artist;
  const title = song?.title;

  const run = useCallback(() => {
    if (artist && title) mutate({ artist, title });
  }, [artist, title, mutate]);

  // Once per song, also under StrictMode's double effects.
  const started = useRef<string | null>(null);
  useEffect(() => {
    const key = artist && title ? `${artist}\n${title}` : null;
    if (key === null || started.current === key) return;
    started.current = key;
    run();
  }, [artist, title, run]);

  return { ...search, run };
}
