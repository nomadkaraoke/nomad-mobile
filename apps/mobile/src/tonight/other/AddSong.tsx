import type { SongGroup } from '@nomad/api-decide';
import { isolate, useTranslations } from '@nomad/i18n';
import { Button, colors, Text, TextField } from '@nomad/ui';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MIN_QUERY_CHARS, useSearch } from '../../find/useSearch';
import { IdeasPanel } from '../log/IdeasPanel';
import { SurveySheet } from '../log/SurveySheet';
import { useLogStore, type LogSong, type LogState } from '../log/logStore';
import { LibraryFilterSlot } from './LibraryFilterSlot';

/** "Artist - Title" or "Title by Artist" → the fields; anything else is the title (spec §7.1 "Log … anyway"). */
export function splitQuery(raw: string): { artist: string; title: string } {
  const q = raw.trim().replace(/\s+/g, ' ');
  const dash = /^(.+?)\s+[-–—]\s+(.+)$/.exec(q);
  if (dash) return { artist: dash[1]!.trim(), title: dash[2]!.trim() };
  const by = /^(.+?)\s+by\s+(.+)$/i.exec(q);
  if (by) return { artist: by[2]!.trim(), title: by[1]!.trim() };
  return { artist: '', title: q };
}

/** The song being added: from search (catalogued, `song_key`) or typed ("Log … anyway", unresolved). */
type Picked = { song: LogSong; typed: boolean };

export type AddSongProps = {
  /** A song chosen elsewhere (the song page's "Add to tonight"): skips the search. */
  prefill?: LogSong;
  /** Venue library override for the search (Phase 3: defaults to Discover's venue filter). */
  library?: string;
};

/**
 * "Add a song" at another bar (spec §6.2): decide search with the venue library picker above the results; a result
 * (or "Log "{query}" anyway" when nothing matches, ruling E9-R6) is then logged as Maybe, Requested or Sung (which
 * opens the survey, then leaves).
 */
export function AddSong({ prefill, library }: AddSongProps) {
  const t = useTranslations('tonight.other');
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Picked | null>(prefill ? { song: prefill, typed: false } : null);
  const [survey, setSurvey] = useState<{ id: string; song: LogSong } | null>(null);
  const search = useSearch(picked ? '' : q, library ? { library } : {});

  const query = q.trim();
  const settled = query.length >= MIN_QUERY_CHARS && search.resultsQuery === query && !search.loading;
  const groups = query.length >= MIN_QUERY_CHARS && search.resultsQuery === query ? search.groups : [];
  const noMatch = settled && groups.length === 0;

  const add = (state: LogState) => {
    if (!picked) return;
    const artist = picked.song.artist.trim();
    const title = picked.song.title.trim();
    if (!artist || !title) return;
    const song: LogSong = { artist, title, ...(picked.typed || !picked.song.song_key ? {} : { song_key: picked.song.song_key }) };
    const id = useLogStore.getState().addOther(song, state);
    if (!id) return;
    if (state === 'sung') setSurvey({ id, song });
    else router.back();
  };

  const pickGroup = (g: SongGroup) => setPicked({ song: { artist: g.artist, title: g.title, song_key: g.song_key }, typed: false });
  const edit = (field: 'artist' | 'title', v: string) => setPicked((p) => (p ? { ...p, song: { ...p.song, [field]: v } } : p));
  const ready = !!picked && picked.song.artist.trim() !== '' && picked.song.title.trim() !== '';

  return (
    <SafeAreaView testID="other-add-screen" style={{ flex: 1, backgroundColor: colors.bg }} edges={['left', 'right', 'bottom']}>
      <ScrollView contentContainerClassName="gap-3 p-4 pb-24" keyboardShouldPersistTaps="handled">
        {picked ? (
          <View testID="other-add-picked" className="gap-3 rounded-xl border border-primary/40 bg-primary/10 p-3">
            {picked.typed ? (
              <>
                <Text variant="muted">{t('typedHint')}</Text>
                <TextField testID="other-add-artist" label={t('artistLabel')} value={picked.song.artist} onChangeText={(v) => edit('artist', v)} autoCapitalize="words" />
                <TextField testID="other-add-title" label={t('titleLabel')} value={picked.song.title} onChangeText={(v) => edit('title', v)} autoCapitalize="words" />
              </>
            ) : (
              <View className="gap-1">
                <Text className="text-lg font-semibold">{picked.song.title}</Text>
                <Text variant="muted">{isolate(picked.song.artist)}</Text>
              </View>
            )}
            <Button testID="other-add-as-requested" label={t('requestedIt')} onPress={() => add('requested')} disabled={!ready} />
            <Button testID="other-add-as-planned" variant="secondary" label={t('maybeLater')} onPress={() => add('planned')} disabled={!ready} />
            <Button testID="other-add-as-sung" variant="secondary" label={t('sangIt')} onPress={() => add('sung')} disabled={!ready} />
            {prefill ? null : (
              <Pressable testID="other-add-back-to-search" accessibilityRole="button" hitSlop={8} onPress={() => setPicked(null)} className="min-h-11 justify-center">
                <Text className="text-sm font-semibold text-primary">{t('searchAgain')}</Text>
              </Pressable>
            )}
          </View>
        ) : (
          <>
            <TextField testID="other-add-query" label={t('searchLabel')} placeholder={t('searchPlaceholder')} value={q} onChangeText={setQ} autoFocus returnKeyType="search" />
            <LibraryFilterSlot />
            {query.length === 0 ? <IdeasPanel onPick={setQ} /> : null}
            {query.length >= MIN_QUERY_CHARS && !settled && groups.length === 0 ? <ActivityIndicator testID="other-add-loading" /> : null}
            {groups.map((g, i) => (
              <Pressable
                key={g.song_key}
                testID={`other-add-result-${i}`}
                accessibilityRole="button"
                onPress={() => pickGroup(g)}
                className="min-h-11 gap-0.5 rounded-xl border border-border bg-card p-3"
              >
                <Text className="font-semibold">{g.title}</Text>
                <Text variant="muted">{isolate(g.artist)}</Text>
              </Pressable>
            ))}
            {noMatch ? (
              <Pressable
                testID="other-add-log-anyway"
                accessibilityRole="button"
                onPress={() => setPicked({ song: splitQuery(query), typed: true })}
                className="min-h-11 justify-center rounded-xl border border-dashed border-border p-3"
              >
                <Text className="font-semibold text-primary">{t('logAnyway', { query: isolate(query) })}</Text>
                <Text variant="muted">{t('logAnywayHint')}</Text>
              </Pressable>
            ) : null}
          </>
        )}
      </ScrollView>
      <SurveySheet
        entryId={survey?.id ?? null}
        artist={survey?.song.artist ?? ''}
        title={survey?.song.title ?? ''}
        onDone={() => {
          setSurvey(null);
          router.back();
        }}
      />
    </SafeAreaView>
  );
}
