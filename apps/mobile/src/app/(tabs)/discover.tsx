import type { SongGroup } from '@nomad/api-decide';
import { useTranslations } from '@nomad/i18n';
import { Button, List, Screen, Text, TextField } from '@nomad/ui';
import { router, useIsFocused } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, AppState, Keyboard, Pressable, View } from 'react-native';

import { MIN_QUERY_CHARS, useSearch } from '../../find/useSearch';

// Interim list until Task C5 renders the four search outcomes; the song page reads a song_key from Task C6.
function SongRow({ song, index }: { song: SongGroup; index: number }) {
  const t = useTranslations('find');
  return (
    <Pressable
      testID={`song-row-${index}`}
      accessibilityRole="button"
      onPress={() => {
        Keyboard.dismiss();
        router.push({ pathname: '/song/[id]', params: { id: song.song_key } });
      }}
      className="border-b border-border py-3"
    >
      <Text className="font-semibold">{song.title}</Text>
      <Text variant="muted">{song.artist}</Text>
      <Text variant="muted" className={song.version_count > 0 ? 'text-gold' : ''}>
        {t('karaokeVersions', { count: song.version_count })}
      </Text>
    </Pressable>
  );
}

export default function DiscoverScreen() {
  const t = useTranslations();
  const [query, setQuery] = useState('');
  const search = useSearch(query);
  const popular = search.query.length < MIN_QUERY_CHARS;
  const isError = search.error !== null;

  // The search field never takes focus by itself: on Android a resumed activity can hand focus back to
  // it (or a sheet can leave the keyboard up), covering the tab bar. Focus only on the user's tap.
  // Only while Discover is on screen: with the sign-in code screen on top, coming back from the mail
  // app must keep the code field focused.
  const focused = useIsFocused();
  useEffect(() => {
    if (!focused) return;
    Keyboard.dismiss();
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') Keyboard.dismiss();
    });
    return () => sub?.remove(); // jest-expo's AppState mock returns no subscription
  }, [focused]);

  const empty = search.loading ? (
    <ActivityIndicator testID="discover-loading" />
  ) : isError ? (
    <View className="items-start gap-2">
      <Text variant="error">{t('common.error')}</Text>
      <Button testID="discover-retry" label={t('common.retry')} variant="secondary" onPress={search.retry} />
    </View>
  ) : !popular ? (
    <Text variant="muted">{t('find.noResults', { query: search.query })}</Text>
  ) : null;

  return (
    <Screen testID="discover-screen">
      <TextField
        testID="discover-search-input"
        label={t('find.searchPlaceholder')}
        placeholder={t('find.searchPlaceholder')}
        value={query}
        onChangeText={setQuery}
        autoCapitalize="none"
        returnKeyType="search"
      />
      {popular && !isError ? <Text variant="title">{t('find.popularHeading')}</Text> : null}
      <View className="flex-1">
        <List
          testID="discover-list"
          data={search.groups}
          keyExtractor={(s) => s.song_key}
          renderItem={(s, i) => <SongRow song={s} index={i} />}
          ListEmptyComponent={empty ?? undefined}
          ListFooterComponent={
            <View className="py-4">
              <Button
                testID="discover-make-any"
                label={t('find.makeAnySong')}
                variant="secondary"
                onPress={() => router.push({ pathname: '/song/[id]', params: { id: 'new' } })}
              />
            </View>
          }
        />
      </View>
    </Screen>
  );
}
