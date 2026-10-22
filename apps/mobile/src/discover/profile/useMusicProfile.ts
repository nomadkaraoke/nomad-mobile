import {
  getPreferences,
  listHiddenSongs,
  listLovedSongs,
  listMyArtists,
  removeMyArtist,
  unhideSong,
  unloveSong,
  type FeedbackSong,
} from '@nomad/api-decide';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuth } from '../../auth/store';
import { RECS_KEY } from '../useRecommendations';

/** Everything on the "Your music profile" screen lives under this prefix. */
export const PROFILE_KEY = ['musicProfile'] as const;
const KEYS = {
  prefs: [...PROFILE_KEY, 'preferences'],
  artists: [...PROFILE_KEY, 'artists'],
  loved: [...PROFILE_KEY, 'loved'],
  hidden: [...PROFILE_KEY, 'hidden'],
} as const;

/** An edit that takes one row out of the list at `key` at once, undoes that if decide refuses, then refreshes. */
function useRowEdit<T>(key: readonly unknown[], request: (id: string) => Promise<unknown>, without: (d: T, id: string) => T) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => request(id),
    onMutate: async (id: string) => {
      await queryClient.cancelQueries({ queryKey: key });
      const before = queryClient.getQueryData<T>(key);
      if (before) queryClient.setQueryData<T>(key, without(before, id));
      return { before };
    },
    onError: (_e, _id, ctx) => {
      if (ctx?.before) queryClient.setQueryData(key, ctx.before);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: PROFILE_KEY });
      void queryClient.invalidateQueries({ queryKey: RECS_KEY });
    },
  });
}

/**
 * The four lists behind the profile screen, and the three edits that need no quiz. Each edit takes the row out at
 * once, puts it back if decide refuses, and then refreshes the profile and the picks (so Discover reflects it).
 */
export function useMusicProfile() {
  const signedIn = useAuth((s) => s.state.status === 'signedIn');
  const prefs = useQuery({ queryKey: KEYS.prefs, queryFn: getPreferences, enabled: signedIn });
  const artists = useQuery({ queryKey: KEYS.artists, queryFn: listMyArtists, enabled: signedIn });
  const loved = useQuery({ queryKey: KEYS.loved, queryFn: listLovedSongs, enabled: signedIn });
  const hidden = useQuery({ queryKey: KEYS.hidden, queryFn: listHiddenSongs, enabled: signedIn });

  type Artists = NonNullable<typeof artists.data>;
  const removeArtist = useRowEdit<Artists>(KEYS.artists, removeMyArtist, (d, name) => ({
    ...d,
    artists: d.artists.filter((a) => a.artist_name !== name),
    total: Math.max(0, d.total - 1),
  }));
  const withoutSong = (d: FeedbackSong[], key: string) => d.filter((s) => s.song_key !== key);
  const unlove = useRowEdit<FeedbackSong[]>(KEYS.loved, unloveSong, withoutSong);
  const unhide = useRowEdit<FeedbackSong[]>(KEYS.hidden, unhideSong, withoutSong);

  return {
    prefs,
    artists,
    loved,
    hidden,
    removeArtist: (name: string) => removeArtist.mutate(name),
    unlove: (key: string) => unlove.mutate(key),
    unhide: (key: string) => unhide.mutate(key),
    failed: removeArtist.isError || unlove.isError || unhide.isError,
  };
}
