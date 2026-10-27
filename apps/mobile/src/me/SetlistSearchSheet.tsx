import { isolate, useTranslations } from '@nomad/i18n';
import { Sheet, Text, TextField } from '@nomad/ui';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { LibraryFilterPicker, useLibraryFilter } from '../find/library';
import { MIN_QUERY_CHARS, useSearch } from '../find/useSearch';
import { UNKNOWN_ARTIST } from '../tonight/log/logStore';
import { splitQuery } from '../tonight/other/AddSong';
import type { AddSong } from './AddToSetlistSheet';

const MAX_ROWS = 20;

/** Search decide's catalog (with the library filter) and add songs to a setlist; a typed song nobody knows is added as free text. */
export function SetlistSearchSheet({ visible, onClose, onPick }: { visible: boolean; onClose(): void; onPick(song: AddSong): boolean }) {
  const t = useTranslations('me.setlists');
  const [query, setQuery] = useState('');
  const [added, setAdded] = useState<Record<string, true>>({});
  const [full, setFull] = useState(false);
  const library = useLibraryFilter((s) => s.filter);
  const search = useSearch(visible ? query : '', { library });

  const q = query.trim();
  const fresh = q.length >= MIN_QUERY_CHARS && search.resultsQuery === search.query;
  const rows = useMemo(() => {
    if (!fresh) return [];
    const out: { song_key: string; artist: string; title: string }[] = [];
    const seen = new Set<string>();
    const add = (s: { song_key: string; artist: string; title: string }) => {
      if (seen.has(s.song_key)) return;
      seen.add(s.song_key);
      out.push(s);
    };
    if (search.identification?.best) add(search.identification.best);
    search.groups.forEach(add);
    return out.slice(0, MAX_ROWS);
  }, [fresh, search.groups, search.identification]);

  const pick = (key: string, song: AddSong) => {
    if (added[key]) return;
    if (onPick(song)) setAdded((p) => ({ ...p, [key]: true }));
    else setFull(true);
  };
  const close = () => {
    setQuery('');
    setAdded({});
    setFull(false);
    onClose();
  };
  const typed = splitQuery(q);

  return (
    <Sheet visible={visible} onClose={close} title={t('addSongTitle')} testID="setlist-search-sheet" closeLabel={t('close')} fullHeight>
      <View className="flex-1 gap-3">
        <TextField
          testID="setlist-search-input"
          label={t('searchLabel')}
          placeholder={t('searchPlaceholder')}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          returnKeyType="search"
        />
        <LibraryFilterPicker />
        {full ? (
          <Text testID="setlist-search-full" variant="error">
            {t('full')}
          </Text>
        ) : null}
        <ScrollView keyboardShouldPersistTaps="handled">
          <View className="gap-2">
            {rows.map((s, i) => (
              <Pressable
                key={s.song_key}
                testID={`setlist-search-row-${i}`}
                accessibilityRole="button"
                onPress={() => pick(s.song_key, s)}
                className={`min-h-11 flex-row items-center justify-between gap-2 rounded-xl border p-3 ${added[s.song_key] ? 'border-primary bg-primary/15' : 'border-border bg-card'}`}
              >
                <Text className="flex-1" numberOfLines={2}>
                  {t('songValue', { title: isolate(s.title), artist: isolate(s.artist) })}
                </Text>
                {added[s.song_key] ? <Text className="text-xs font-bold text-primary">{t('added')}</Text> : null}
              </Pressable>
            ))}
            {q.length > 0 ? (
              <Pressable
                testID="setlist-search-typed"
                accessibilityRole="button"
                onPress={() => pick(`t:${q}`, { artist: typed.artist || UNKNOWN_ARTIST, title: typed.title, song_key: null })}
                className="min-h-11 justify-center rounded-xl border border-dashed border-border p-3"
              >
                <Text>{t('addTyped', { query: isolate(q) })}</Text>
              </Pressable>
            ) : null}
          </View>
        </ScrollView>
      </View>
    </Sheet>
  );
}
