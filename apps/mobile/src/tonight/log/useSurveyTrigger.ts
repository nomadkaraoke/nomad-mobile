import type { Song } from '@nomad/api-kjbox';
import { useEffect, useMemo } from 'react';

import { useLogStore } from './logStore';

export type SurveyTarget = { entryId: string; artist: string; title: string };

/**
 * Ruling E8-R3: the Nomad post-song survey opens once per newly sung song. `/me` lists the song in `sung_tonight`
 * with a `history_id` (null → never logged or surveyed); the first one this user hasn't surveyed or skipped opens the
 * sheet while the night screen is showing (so also on the next open). Saving or dismissing marks it, which moves on.
 */
export function useSurveyTrigger(sung: Song[] | undefined, showing: boolean, nightId: string): SurveyTarget | null {
  const surveyed = useLogStore((s) => s.surveyed);
  const userKey = useLogStore((s) => s.userKey);

  const target = useMemo(() => {
    if (!showing || !userKey) return null;
    const next = (sung ?? []).find((s) => s.history_id && !surveyed[s.history_id]);
    return next?.history_id ? { entryId: next.history_id, artist: next.request.song_artist, title: next.request.song_title } : null;
  }, [sung, showing, surveyed, userKey]);

  // Mirror the sung Nomad song into the local log (kjbox delivers its facts to decide).
  useEffect(() => {
    if (target) useLogStore.getState().noteNomad(target.entryId, { artist: target.artist, title: target.title, nightId });
  }, [target, nightId]);

  return target;
}
