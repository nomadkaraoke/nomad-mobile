import type { MeSong } from '@nomad/core';
import { queryLibrary } from '@nomad/core';
import { useTranslations } from '@nomad/i18n';
import { List, Text } from '@nomad/ui';
import { router, Stack, type Href } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { useLibraryFilter } from '../../find/library';
import { CollectionRow } from '../../me/CollectionRow';
import { INITIAL_FILTER, SongsFilters, toQuery, type SongsFilter } from '../../me/SongsFilters';
import { useLibrary } from '../../me/useLibrary';
import { useOffline } from '../../net/useOffline';

const VIBE_ORDER = ['party', 'ballad', 'warm_up', 'duet', 'emotional', 'rock_out', 'singalong'];

/** Me -> All your songs: everything you've sung, saved or put on a setlist, with search, sort and filters. */
export default function SongsScreen() {
  const t = useTranslations('me.songs');
  const offline = useOffline();
  const { items, loading, error, refetch } = useLibrary();
  const library = useLibraryFilter((s) => s.filter);
  const [filter, setFilter] = useState<SongsFilter>(INITIAL_FILTER);
  const vibesInUse = useMemo(() => {
    const used = new Set(items.flatMap((s) => s.vibes));
    return VIBE_ORDER.filter((v) => used.has(v));
  }, [items]);
  const rows = useMemo(() => queryLibrary(items, toQuery(filter, library)), [items, filter, library]);

  const empty = loading ? (
    <ActivityIndicator testID="me-songs-loading" />
  ) : error ? (
    <Pressable testID="me-songs-error" accessibilityRole="button" onPress={refetch} className="min-h-11 px-4 py-3">
      <Text variant="error">{t('loadError')}</Text>
    </Pressable>
  ) : (
    <Text testID="me-songs-empty" variant="muted" className="px-4 py-3">
      {items.length === 0 ? t('empty') : t('emptyFiltered')}
    </Text>
  );

  return (
    <View testID="me-songs" className="flex-1 bg-bg">
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable testID="me-songs-add-past" accessibilityRole="button" accessibilityLabel={t('addPast')} onPress={() => router.push('/me/sung-before' as Href)} className="min-h-11 justify-center px-2">
              <Text className="font-semibold text-primary">{t('addPast')}</Text>
            </Pressable>
          ),
        }}
      />
      {offline ? (
        <Text testID="me-songs-offline" variant="muted" className="px-4 pt-2">
          {t('offline')}
        </Text>
      ) : null}
      <List<MeSong>
        testID="me-songs-list"
        data={rows}
        keyExtractor={(s) => s.key}
        renderItem={(s, i) => <CollectionRow song={s} index={i} />}
        ListHeaderComponent={<SongsFilters value={filter} onChange={setFilter} vibesInUse={vibesInUse} />}
        ListEmptyComponent={empty}
      />
    </View>
  );
}
