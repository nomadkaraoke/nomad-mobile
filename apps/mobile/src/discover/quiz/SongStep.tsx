import { isolate, useTranslations } from '@nomad/i18n';
import { Text, TextField } from '@nomad/ui';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { useSearch } from '../../find/useSearch';
import { useQuizDraft } from '../quizStore';
import { StepHeading } from './StepHeading';

const MAX_ROWS = 20;

type QuizSong = { songKey: string; artist: string; title: string };

function SongRow({ testID, song, selected, onPress }: { testID: string; song: QuizSong; selected: boolean; onPress: () => void }) {
  const t = useTranslations('quiz');
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      className={`flex-row items-center justify-between gap-2 rounded-xl border p-3 ${
        selected ? 'border-primary bg-primary/15' : 'border-border bg-card'
      }`}
    >
      <Text className="flex-1" numberOfLines={2}>
        {isolate(t('songValue', { title: song.title, artist: song.artist }))}
      </Text>
      {selected ? <Text className="text-xs font-bold text-primary">{t('badgeLove')}</Text> : null}
    </Pressable>
  );
}

/** Step 4 (optional): songs you love, from the app's song search (the popular list until you type). */
export function SongStep() {
  const t = useTranslations('quiz');
  const songs = useQuizDraft((s) => s.draft.songs);
  const update = useQuizDraft((s) => s.update);
  const [query, setQuery] = useState('');
  // Songs you love, wherever they are: the venue library filter (Discover, search) doesn't apply here.
  const search = useSearch(query, { library: 'any' });

  const rows = useMemo<QuizSong[]>(() => {
    const out: QuizSong[] = [];
    const seen = new Set<string>();
    const add = (s: { song_key: string; artist: string; title: string }) => {
      if (seen.has(s.song_key)) return;
      seen.add(s.song_key);
      out.push({ songKey: s.song_key, artist: s.artist, title: s.title });
    };
    const best = search.resultsQuery === search.query ? search.identification?.best : null;
    if (best) add(best);
    search.groups.forEach(add);
    return out.slice(0, MAX_ROWS);
  }, [search.groups, search.identification, search.query, search.resultsQuery]);

  const picked = (key: string) => songs.some((s) => s.songKey === key);
  const toggleSong = (song: QuizSong) =>
    update((d) => ({
      ...d,
      songs: d.songs.some((s) => s.songKey === song.songKey)
        ? d.songs.filter((s) => s.songKey !== song.songKey)
        : [...d.songs, song],
    }));

  return (
    <View className="gap-4">
      <StepHeading title={t('songsTitle')} hint={t('songsHint')} />
      {songs.length > 0 ? (
        <View className="gap-2">
          <Text className="font-semibold">{t('yourSongs')}</Text>
          {songs.map((s, i) => (
            <SongRow key={s.songKey} testID={`quiz-picked-song-${i}`} song={s} selected onPress={() => toggleSong(s)} />
          ))}
        </View>
      ) : null}
      <TextField
        testID="quiz-song-search"
        label={t('songSearchLabel')}
        placeholder={t('songSearchPlaceholder')}
        value={query}
        onChangeText={setQuery}
        autoCapitalize="none"
        returnKeyType="search"
      />
      <View className="gap-2">
        {rows.map((s, i) => (
          <SongRow
            key={s.songKey}
            testID={`quiz-song-${i}`}
            song={s}
            selected={picked(s.songKey)}
            onPress={() => toggleSong(s)}
          />
        ))}
      </View>
    </View>
  );
}
