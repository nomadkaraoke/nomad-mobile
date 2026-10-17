import type { SongResponse } from '@nomad/api-decide';
import { useTranslations } from '@nomad/i18n';
import { Button, List, Screen, Text, TextField } from '@nomad/ui';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Keyboard, Pressable, View } from 'react-native';

import { useSongSearch } from '../../find/useSongSearch';

function SongRow({ song }: { song: SongResponse }) {
  const t = useTranslations('find');
  return (
    <Pressable
      testID={`song-row-${song.id}`}
      accessibilityRole="button"
      onPress={() => {
        Keyboard.dismiss();
        router.push({ pathname: '/song/[id]', params: { id: String(song.id) } });
      }}
      className="border-b border-border py-3"
    >
      <Text className="font-semibold">{song.title}</Text>
      <Text variant="muted">{song.artist}</Text>
      <Text variant="muted" className={song.brand_count > 0 ? 'text-gold' : ''}>
        {t('karaokeVersions', { count: song.brand_count })}
      </Text>
    </Pressable>
  );
}

export default function DiscoverScreen() {
  const t = useTranslations();
  const [query, setQuery] = useState('');
  const { mode, songs, isLoading, isError, refetch, query: activeQuery } = useSongSearch(query);

  const empty = isLoading ? (
    <ActivityIndicator testID="discover-loading" />
  ) : isError ? (
    <View className="items-start gap-2">
      <Text variant="error">{t('common.error')}</Text>
      <Button testID="discover-retry" label={t('common.retry')} variant="secondary" onPress={refetch} />
    </View>
  ) : mode === 'search' ? (
    <Text variant="muted">{t('find.noResults', { query: activeQuery })}</Text>
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
      {mode === 'popular' && !isError ? <Text variant="title">{t('find.popularHeading')}</Text> : null}
      <View className="flex-1">
        <List
          testID="discover-list"
          data={songs}
          keyExtractor={(s) => String(s.id)}
          renderItem={(s) => <SongRow song={s} />}
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
