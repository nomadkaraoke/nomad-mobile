import { listKaraokeLog, type KaraokeLogEntry } from '@nomad/api-decide';
import { getMyStats } from '@nomad/api-kjbox';
import { isolate, useTranslations } from '@nomad/i18n';
import { Text } from '@nomad/ui';
import { useQuery } from '@tanstack/react-query';
import { Pressable, View } from 'react-native';

import { useNightStore } from '../nightStore';

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

export type IdeasPanelProps = {
  /** Fills the search with "<artist> <title>". */
  onPick: (query: string) => void;
};

/**
 * "Sung here before? Need ideas?" (A.38, ruling E8-R5) on the Nomad search screen: your most-sung songs from decide's
 * karaoke log (all bars) and tonight's crowd favourites from kjbox. Tapping a row fills the search. Hidden while both
 * are empty (or unavailable).
 */
export function IdeasPanel({ onPick }: IdeasPanelProps) {
  const t = useTranslations('tonight.ideas');
  const userKey = useNightStore((s) => s.userKey);
  const night = useNightStore((s) => s.active);
  const nomad = night?.kind === 'nomad' ? night : null;

  const mine = useQuery({
    queryKey: ['decide', userKey, 'karaoke-log', 'most-sung'],
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
      onPress={() => onPick(`${s.artist} ${s.title}`)}
      className="min-h-11 flex-row items-center gap-2 py-2"
    >
      <Text className="flex-1">{t('song', { title: isolate(s.title), artist: isolate(s.artist) })}</Text>
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
