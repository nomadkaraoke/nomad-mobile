// A song's vocal range and how it fits the singer's voice (Phase 3c): decide's range when online, the offline list's
// (song-level, else the artist's rough guess) without a connection or when decide can't be reached.
import { getSongVocalRange, type SongVocalRangeOut } from '@nomad/api-decide';
import { fitSong, offlineVocalRange, type FitResult, type SongVocalRange } from '@nomad/core';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { useOffline } from '../net/useOffline';
import { openOfflineReader } from '../offline/offlineIndex';
import { useOfflineIndexStore } from '../offline/offlineIndexStore';
import { toUserRange, useVoiceStore } from './voiceStore';

export type SongFit = { range: SongVocalRange | null; fit: FitResult | null; source: 'api' | 'offline' | null };

const fromApi = (r: SongVocalRangeOut): SongVocalRange => ({
  low: r.low,
  high: r.high,
  p10: r.p10,
  p50: r.p50,
  p90: r.p90,
  tier: r.tier,
  octaveConfidence: r.octave_confidence,
});

/** The offline list's range, or null (no list, not in it, an older list, a broken file). */
function offlineRange(songKey: string): SongVocalRange | null {
  try {
    const db = openOfflineReader();
    return db ? offlineVocalRange(db, songKey) : null;
  } catch {
    return null;
  }
}

export function useSongFit(songKey: string): SongFit {
  const offline = useOffline();
  const run = useOfflineIndexStore((s) => s.run);
  const profile = useVoiceStore((s) => s.profile);

  const cloud = useQuery({
    queryKey: ['decide', 'vocal-range', songKey],
    queryFn: async () => {
      const res = await getSongVocalRange(songKey);
      return res.range ? fromApi(res.range) : null;
    },
    enabled: !offline,
    staleTime: 60 * 60 * 1000,
    retry: false,
  });
  // Decide answered: its answer is final (null = no range for this song). Otherwise the offline list answers.
  const useLocal = offline || cloud.isError;
  const local = useQuery({
    queryKey: ['offline', 'vocal-range', run, songKey],
    queryFn: () => offlineRange(songKey),
    enabled: useLocal,
    staleTime: Infinity,
    retry: false,
  });

  return useMemo(() => {
    const range = useLocal ? (local.data ?? null) : (cloud.data ?? null);
    const source = range ? (useLocal ? 'offline' : 'api') : null;
    return { range, fit: range && profile ? fitSong(toUserRange(profile), range) : null, source };
  }, [useLocal, local.data, cloud.data, profile]);
}
