import type { SongGroup } from '@nomad/api-decide';
import type { LibraryFilter } from '@nomad/core';
import { isolate, useTranslations } from '@nomad/i18n';
import { Button, colors, Text, TextField } from '@nomad/ui';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useLibraryFilter } from '../../find/library';
import { MIN_QUERY_CHARS, useSearch } from '../../find/useSearch';
import { IdeasPanel } from '../log/IdeasPanel';
import { SurveySheet } from '../log/SurveySheet';
import { artistLabel, UNKNOWN_ARTIST, useLogStore, type LogSong, type LogState } from '../log/logStore';
import { useNightStore } from '../nightStore';
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
  /** Venue library override for the search; by default the picker's choice (Discover's shared `useLibraryFilter()`). */
  library?: LibraryFilter;
};

/**
 * "Add a song" at another bar (spec §6.2): decide search with the venue library picker above the results; a result
 * (or "Log "{query}" anyway" when nothing matches, ruling E9-R6) is then logged as Maybe, Requested or Sung (which
 * opens the survey, then leaves).
 */
export function AddSong({ prefill, library }: AddSongProps) {
  const t = useTranslations('tonight.other');
  const tAll = useTranslations();
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Picked | null>(prefill ? { song: prefill, typed: false } : null);
  const [survey, setSurvey] = useState<{ id: string; song: LogSong } | null>(null);
  const venueLibrary = useLibraryFilter((s) => s.filter);
  const search = useSearch(picked ? '' : q, { library: library ?? venueLibrary });

  const query = q.trim();
  const searching = query.length >= MIN_QUERY_CHARS;
  // Only answers for the current query count (useSearch keeps the previous query's rows up meanwhile).
  const fresh = searching && search.resultsQuery === query;
  const settled = fresh && !search.loading;
  // The cloud found nothing and the Gemini auto-correct is running (as Discover's "Figuring out…").
  const figuringOut = fresh && search.loading && search.source === 'cloud' && search.groups.length === 0;
  const groups = fresh ? (search.groups.length > 0 ? search.groups : (search.resolve?.groups ?? [])) : [];

  // "Log … anyway" prefill: the auto-correct's artist/title split, else the typed text's. A missing artist stays
  // empty (hint: "Unknown artist") and is saved as the untranslated UNKNOWN_ARTIST (decide needs an artist).
  const logAnyway = () => {
    const split = search.resolve?.split ?? splitQuery(query);
    setPicked({ song: { artist: split.artist.trim(), title: split.title.trim() }, typed: true });
  };

  const add = (state: LogState) => {
    if (!picked) return;
    const artist = picked.song.artist.trim() || (picked.typed ? UNKNOWN_ARTIST : '');
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
  const ready = !!picked && (picked.typed || picked.song.artist.trim() !== '') && picked.song.title.trim() !== '';

  return (
    <SafeAreaView testID="other-add-screen" style={{ flex: 1, backgroundColor: colors.bg }} edges={['left', 'right', 'bottom']}>
      <ScrollView contentContainerClassName="gap-3 p-4 pb-24" keyboardShouldPersistTaps="handled">
        {picked ? (
          <View testID="other-add-picked" className="gap-3 rounded-xl border border-primary/40 bg-primary/10 p-3">
            {picked.typed ? (
              <>
                <Text variant="muted">{t('typedHint')}</Text>
                <TextField testID="other-add-artist" label={t('artistLabel')} placeholder={t('unknownArtist')} value={picked.song.artist} onChangeText={(v) => edit('artist', v)} autoCapitalize="words" />
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
            {searching && search.warmingUp ? (
              <Text testID="other-add-warming" variant="muted">
                {tAll('discover.warmingUp')}
              </Text>
            ) : null}
            {fresh && search.error ? (
              <View className="items-start gap-2">
                <Text variant="error">{search.error === 'rejected' ? tAll('discover.rejected') : tAll('discover.unreachable')}</Text>
                <Button testID="other-add-retry" label={tAll('common.retry')} variant="secondary" onPress={search.retry} />
              </View>
            ) : null}
            {figuringOut ? (
              <Text testID="other-add-figuring-out" variant="muted">
                {tAll('discover.figuringOut')}
              </Text>
            ) : searching && !settled && groups.length === 0 && !search.warmingUp ? (
              <ActivityIndicator testID="other-add-loading" />
            ) : null}
            <View testID="other-add-results" className="gap-3">
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
              {/* Uncatalogued songs are first-class (spec §7.1, ruling E9-R7): always offered, last, once settled. */}
              {settled ? (
                <Pressable
                  testID="other-add-log-anyway"
                  accessibilityRole="button"
                  onPress={logAnyway}
                  className="min-h-11 justify-center rounded-xl border border-dashed border-border p-3"
                >
                  <Text className="font-semibold text-primary">{t('logAnyway', { query: isolate(query) })}</Text>
                  <Text variant="muted">{t('logAnywayHint')}</Text>
                </Pressable>
              ) : null}
            </View>
          </>
        )}
      </ScrollView>
      <SurveySheet
        entryId={survey?.id ?? null}
        artist={artistLabel(survey?.song.artist ?? '', t('unknownArtist'))}
        title={survey?.song.title ?? ''}
        onDone={() => {
          setSurvey(null);
          useNightStore.getState().touch();
          router.back();
        }}
      />
    </SafeAreaView>
  );
}
