import { listKaraokeLog, type KaraokeLogEntry } from '@nomad/api-decide';
import { getMyStats, type MeResult } from '@nomad/api-kjbox';
import { isolate, useTranslations } from '@nomad/i18n';
import { Text } from '@nomad/ui';
import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { Pressable, View } from 'react-native';

import { useNightStore } from '../nightStore';
import { nightKey } from '../nomad/queries';
import { artistLabel, UNKNOWN_ARTIST } from './logStore';
import { useOutbox } from './outbox';

/** How many of the singer's most-sung songs the panel shows. */
export const IDEAS_MINE_MAX = 5;
/** decide's page cap: one page is the whole history for nearly everyone. */
const LOG_PAGE = 500;

export type IdeaSong = { artist: string; title: string; count: number };

const norm = (s: string) => s.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();

/** Ruling E8-R5: the singer's most-sung songs at every bar, by artist + title, most first (ties: most recent). */
export function mostSung(entries: KaraokeLogEntry[], max = IDEAS_MINE_MAX): IdeaSong[] {
  const by = new Map<string, IdeaSong & { last: string }>();
  for (const e of entries) {
    if (e.deleted || (e.state !== 'sung' && e.state !== 'sung_unplayed') || !e.artist || !e.title) continue;
    const k = `${norm(e.artist)}\u0000${norm(e.title)}`;
    const when = e.sung_at ?? e.updated_at ?? '';
    const cur = by.get(k);
    if (cur) {
      cur.count += 1;
      if (when > cur.last) cur.last = when;
    } else by.set(k, { artist: e.artist, title: e.title, count: 1, last: when });
  }
  return [...by.values()]
    .sort((a, b) => b.count - a.count || (b.last > a.last ? 1 : b.last < a.last ? -1 : 0))
    .slice(0, max)
    .map(({ artist, title, count }) => ({ artist, title, count }));
}

/** The decide karaoke-log queries of one account (the Ideas panel's most-sung list). */
const karaokeLogKey = (userKey: string | null) => ['decide', userKey, 'karaoke-log'];

/**
 * Keeps the most-sung list fresh: invalidates the karaoke-log queries when a song becomes sung tonight (the night's
 * cached `/me` gains a sung song; kjbox's outbox then delivers it to decide) and whenever the karaoke-log outbox lands
 * a write (a survey, a logged or removed song). Mounted once, in AppProviders, so changes made while the panel is
 * closed still reach it.
 */
export function useKaraokeLogFreshness(): void {
  const queryClient = useQueryClient();
  const userKey = useNightStore((s) => s.userKey);
  const night = useNightStore((s) => s.active);
  const nomad = night?.kind === 'nomad' ? night : null;
  // Reads the night's /me from the cache only (the night screen polls it); never fetches.
  const sung = useQuery({
    queryKey: nomad ? [...nightKey(nomad, userKey), 'me'] : ['kjbox', 'none'],
    queryFn: skipToken,
    select: (d: MeResult) => d.sung_tonight.length,
  }).data;
  const synced = useOutbox((s) => s.synced);
  const seen = useRef({ nightId: nomad?.nightId, sung, synced });
  useEffect(() => {
    const prev = seen.current;
    seen.current = { nightId: nomad?.nightId, sung, synced };
    const moreSung = prev.nightId === nomad?.nightId && sung !== undefined && prev.sung !== undefined && sung > prev.sung;
    if (moreSung || synced !== prev.synced) void queryClient.invalidateQueries({ queryKey: karaokeLogKey(userKey) });
  }, [queryClient, userKey, nomad?.nightId, sung, synced]);
}

export type IdeasPanelProps = {
  /** Fills the search with "<artist> <title>" (just the title for the unknown-artist sentinel). */
  onPick: (query: string) => void;
};

/**
 * "Sung here before? Need ideas?" (A.38, ruling E8-R5) on the Nomad search screen: your most-sung songs from decide's
 * karaoke log (all bars) and tonight's crowd favourites from kjbox. Tapping a row fills the search. Hidden while both
 * are empty (or unavailable).
 */
export function IdeasPanel({ onPick }: IdeasPanelProps) {
  const t = useTranslations('tonight.ideas');
  const tOther = useTranslations('tonight.other');
  const userKey = useNightStore((s) => s.userKey);
  const night = useNightStore((s) => s.active);
  const nomad = night?.kind === 'nomad' ? night : null;

  const mine = useQuery({
    queryKey: [...karaokeLogKey(userKey), 'most-sung'],
    queryFn: async () => mostSung((await listKaraokeLog({ limit: LOG_PAGE })).entries),
    enabled: userKey !== null,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const crowd = useQuery({
    queryKey: ['kjbox', userKey, nomad?.nightId, 'my-stats'],
    queryFn: async () => (await getMyStats(nomad!.code, nomad!.nightId)).top_songs.slice(0, IDEAS_MINE_MAX),
    enabled: nomad !== null,
    staleTime: 60_000,
    retry: false,
  });

  const mySongs = mine.data ?? [];
  const crowdSongs = crowd.data ?? [];
  if (mySongs.length === 0 && crowdSongs.length === 0) return null;

  const row = (testID: string, s: { artist: string; title: string }, meta: string) => (
    <Pressable
      key={testID}
      testID={testID}
      accessibilityRole="button"
      // The unknown-artist sentinel is no search term: seed the title alone.
      onPress={() => onPick(s.artist === UNKNOWN_ARTIST ? s.title : `${s.artist} ${s.title}`)}
      className="min-h-11 flex-row items-center gap-2 py-2"
    >
      <Text className="flex-1">{t('song', { title: isolate(s.title), artist: isolate(artistLabel(s.artist, tOther('unknownArtist'))) })}</Text>
      <Text variant="muted">{meta}</Text>
    </Pressable>
  );

  return (
    <View testID="tonight-ideas" className="gap-2 rounded-xl border border-border bg-card p-4">
      <Text className="font-semibold">{t('title')}</Text>
      {mySongs.length > 0 ? (
        <View testID="tonight-ideas-mine">
          <Text variant="muted">{t('mine')}</Text>
          {mySongs.map((s, i) => row(`tonight-ideas-mine-${i}`, s, t('times', { count: s.count })))}
        </View>
      ) : null}
      {crowdSongs.length > 0 ? (
        <View testID="tonight-ideas-crowd">
          <Text variant="muted">{t('crowd')}</Text>
          {crowdSongs.map((s, i) => row(`tonight-ideas-crowd-${i}`, s, t('plays', { count: s.plays })))}
        </View>
      ) : null}
    </View>
  );
}
