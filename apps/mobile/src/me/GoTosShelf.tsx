import type { RecSong } from '@nomad/api-decide';
import { isGoTo, queryLibrary, type MeSong } from '@nomad/core';
import { isolate, useTranslations } from '@nomad/i18n';
import { Button, Text } from '@nomad/ui';
import { router, type Href } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, View } from 'react-native';

import { artistLabel } from '../tonight/log/logStore';
import { FitBadge, type BadgeFit } from '../voice/FitBadge';
import { Shelf } from './Shelf';
import { openSongHref } from './songHref';
import { useRecsGoTos } from './useRecsGoTos';

const MAX = 5;

/** A shelf row: what the song link needs, plus decide's fit for the recs rows. */
type GoToRow = Pick<MeSong, 'key' | 'song_key' | 'artist' | 'title'> & { fit: BadgeFit | null };

/**
 * The shelf's songs (spec §6.5 item 3). With decide's go_tos section: its songs first (catalogued, with a karaoke
 * version and their fit), minus any the phone now knows isn't a go-to (hidden or "not for me" since that fetch),
 * then the phone's uncatalogued go-tos, which decide's section can never hold. Without the section: the phone's
 * go-tos as in 4a. Deduped by library identity, five at most.
 */
export function goToRows(items: MeSong[], recs: RecSong[] | null): GoToRow[] {
  const local = queryLibrary(items, { sort: 'goto' }).filter(isGoTo);
  if (!recs) return local.slice(0, MAX).map((s) => ({ ...s, fit: null }));
  const byKey = new Map(items.map((s) => [s.key, s]));
  const seen = new Set<string>();
  const out: GoToRow[] = [];
  const add = (row: GoToRow) => {
    if (out.length >= MAX || seen.has(row.key)) return;
    seen.add(row.key);
    out.push(row);
  };
  for (const r of recs) {
    const mine = byKey.get(r.song_key);
    if (mine && !isGoTo(mine)) continue;
    add({ key: r.song_key, song_key: r.song_key, artist: r.artist, title: r.title, fit: r.fit ?? null });
  }
  for (const s of local) if (s.song_key == null) add({ ...s, fit: null });
  return out;
}

/** Your go-tos: the songs you reliably sing well (the shared isGoTo rule), most-sung first, five at most. */
export function GoTosShelf({ items }: { items: MeSong[] }) {
  const t = useTranslations('me.home');
  const tu = useTranslations('tonight.other');
  const recs = useRecsGoTos();
  const goTos = useMemo(() => goToRows(items, recs), [items, recs]);
  return (
    <Shelf
      testID="me-gotos"
      title={t('gotosTitle')}
      onSeeAll={goTos.length ? () => router.push('/me/songs' as Href) : undefined}
      empty={
        goTos.length === 0 ? (
          <View className="gap-2 rounded-xl border border-border bg-card p-3">
            <Text variant="muted">{t('gotosEmpty')}</Text>
            <Button testID="me-gotos-empty-cta" label={t('gotosEmptyCta')} variant="secondary" onPress={() => router.push('/me/sung-before' as Href)} />
          </View>
        ) : undefined
      }
    >
      {goTos.map((s, i) => (
        <Pressable
          key={s.key}
          testID={`me-goto-${i}`}
          accessibilityRole="button"
          onPress={() => openSongHref(s)}
          className="min-h-11 flex-row items-center justify-between gap-2 rounded-xl border border-border bg-card p-3"
        >
          <View className="flex-1">
            <Text className="font-semibold" numberOfLines={1}>
              {isolate(s.title)}
            </Text>
            <Text variant="muted" numberOfLines={1}>
              {isolate(artistLabel(s.artist, tu('unknownArtist')))}
            </Text>
          </View>
          <FitBadge fit={s.fit} testID={`me-goto-fit-${i}`} />
        </Pressable>
      ))}
    </Shelf>
  );
}
