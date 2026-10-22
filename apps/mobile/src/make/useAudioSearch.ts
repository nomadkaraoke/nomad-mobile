import { searchAudio, type AudioResult } from '@nomad/api-gen';
import { useMutation } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';

type Song = { artist: string; title: string };

/** Runs the audio search: gen's own (default), or another service's (Tonight's goes through kjbox). */
export type AudioSearcher = (artist: string, title: string) => Promise<{ sessionId: string; results: AudioResult[] }>;

/**
 * gen's standalone audio search for the song being made (spec §4.4). It can take ~45s, and it answers 402
 * before searching when the person has no credits. Runs once per song when the screen mounts; `searchFor()`
 * searches for a corrected song (the match judge); `run()` repeats the latest search (retry, an expired
 * search session, back from checkout). `searcher` replaces gen's search (Tonight's make goes through kjbox, which
 * tops up a show credit first).
 */
export function useAudioSearch(song: Song | null, searcher: AudioSearcher = searchAudio) {
  const searcherRef = useRef(searcher);
  useEffect(() => {
    searcherRef.current = searcher;
  });
  const search = useMutation({ mutationFn: (s: Song) => searcherRef.current(s.artist, s.title) });
  const { mutate } = search;
  const artist = song?.artist;
  const title = song?.title;

  // The song the latest search was for: the intent's, or a correction's.
  const latest = useRef<Song | null>(null);
  const searchFor = useCallback(
    (s: Song) => {
      latest.current = s;
      mutate(s);
    },
    [mutate],
  );
  const run = useCallback(() => {
    if (latest.current) mutate(latest.current);
  }, [mutate]);

  // Once per song, also under StrictMode's double effects.
  const started = useRef<string | null>(null);
  useEffect(() => {
    const key = artist && title ? `${artist}\n${title}` : null;
    if (key === null || started.current === key) return;
    started.current = key;
    searchFor({ artist: artist!, title: title! });
  }, [artist, title, searchFor]);

  return { ...search, run, searchFor };
}
