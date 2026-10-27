import { libraryKey, normalize } from '@nomad/core';
import { isolate, useTranslations } from '@nomad/i18n';
import { Button, List, Text, TextField } from '@nomad/ui';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { loadRecsSnapshot } from '../../discover/recsSnapshot';
import { useSearch } from '../../find/useSearch';
import { useLibrary } from '../../me/useLibrary';
import { artistLabel, useLogStore } from '../../tonight/log/logStore';

const MAX_SEARCH_ROWS = 20;
/** The tick on a picked row (a glyph, not words). */
const CHECK_MARK = '✓';

/** Every word of the query appears in the song's artist or title (normalized: case, accents, punctuation). */
const matches = (words: string[], s: { artist: string; title: string }) => {
  const hay = `${normalize(s.artist)} ${normalize(s.title)}`;
  return words.every((w) => hay.includes(w));
};

type Candidate = { key: string; artist: string; title: string; song_key?: string };

/** Me -> "Songs I've sung": tick the songs you have sung before; each becomes a backfill with no date. */
export default function SungBeforeScreen() {
  const t = useTranslations('me.sungBefore');
  const tu = useTranslations('tonight.other');
  const router = useRouter();
  const library = useLibrary();
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Record<string, Candidate>>({});
  const search = useSearch(query, { library: 'any' });
  // Read once: the snapshot is MMKV JSON and doesn't change while the picker is open.
  const imported = useMemo(() => loadRecsSnapshot()?.data.sections.find((s) => s.id === 'songs_you_know')?.songs ?? [], []);

  const sungKeys = useMemo(() => new Set(library.items.filter((i) => i.times_sung > 0).map((i) => i.key)), [library.items]);

  // No query: saved songs then imported ones. With a query: the search hits first, then the saved / imported songs
  // that match it. Deduped by library key throughout.
  const rows = useMemo<Candidate[]>(() => {
    const out: Candidate[] = [];
    const seen = new Set<string>();
    const add = (s: { artist: string; title: string; song_key?: string | null }) => {
      const key = libraryKey(s.artist, s.title, s.song_key);
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ key, artist: s.artist, title: s.title, ...(s.song_key ? { song_key: s.song_key } : {}) });
    };
    const words = normalize(query).split(' ').filter(Boolean);
    if (words.length) {
      const best = search.resultsQuery === search.query ? search.identification?.best : null;
      const found: { song_key: string; artist: string; title: string }[] = [];
      if (best) found.push(best);
      found.push(...search.groups);
      for (const s of found) {
        if (out.length >= MAX_SEARCH_ROWS) break;
        add(s);
      }
    }
    const prefill = [
      ...library.items.filter((i) => i.loved).map((i) => ({ artist: i.artist, title: i.title, song_key: i.song_key })),
      ...imported,
    ];
    for (const s of prefill) if (!words.length || matches(words, s)) add(s);
    return out;
  }, [query, imported, library.items, search.groups, search.identification, search.query, search.resultsQuery]);

  const toggle = (c: Candidate) =>
    setPicked((p) => {
      const { [c.key]: gone, ...rest } = p;
      return gone ? rest : { ...p, [c.key]: c };
    });

  const done = () => {
    const store = useLogStore.getState();
    for (const c of Object.values(picked)) {
      if (sungKeys.has(c.key)) continue;
      store.addBackfill({ artist: c.artist, title: c.title, song_key: c.song_key }, { times: 1, precision: 'unknown' });
    }
    if (router.canGoBack()) router.back();
    else router.replace('/me');
  };

  const count = Object.keys(picked).length;
  const header = (
    <View className="gap-3 pb-3">
      <Text variant="muted">{t('hint')}</Text>
      <TextField
        testID="sung-before-search"
        label={t('searchLabel')}
        placeholder={t('searchPlaceholder')}
        value={query}
        onChangeText={setQuery}
        autoCapitalize="none"
        returnKeyType="search"
      />
    </View>
  );
  return (
    <View testID="sung-before" className="flex-1 bg-bg px-4 pt-4">
      <List
        testID="sung-before-list"
        data={rows}
        keyExtractor={(c) => c.key}
        extraData={{ picked, sungKeys }}
        ListHeaderComponent={header}
        renderItem={(c, i) => {
          const already = sungKeys.has(c.key);
          const checked = already || !!picked[c.key];
          return (
            <Pressable
              testID={`sung-before-row-${i}`}
              accessibilityRole="checkbox"
              accessibilityState={{ checked, disabled: already }}
              disabled={already}
              onPress={() => toggle(c)}
              className={`mb-3 min-h-11 flex-row items-center gap-3 rounded-xl border p-3 ${
                checked ? 'border-primary bg-primary/15' : 'border-border bg-card'
              } ${already ? 'opacity-60' : ''}`}
            >
              <Text className="w-5 text-primary">{checked ? CHECK_MARK : ''}</Text>
              <Text className="flex-1" numberOfLines={2}>
                {t('songValue', { title: isolate(c.title), artist: isolate(artistLabel(c.artist, tu('unknownArtist'))) })}
              </Text>
            </Pressable>
          );
        }}
      />
      <View className="p-4">
        <Button testID="sung-before-done" label={t('done', { count })} onPress={done} disabled={count === 0} />
      </View>
    </View>
  );
}
