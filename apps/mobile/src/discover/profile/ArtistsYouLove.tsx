import { isolate, useTranslations } from '@nomad/i18n';
import { Text, TextField } from '@nomad/ui';
import { router, type Href } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { sortByAffinity } from './artistGroups';

export const ARTISTS_PREVIEW = 12;

type Artist = { artist_name: string; affinity?: string | null };

/** The top artists as removable chips, a filter field, and See all (the A-Z screen). */
export function ArtistsYouLove({ artists, onRemove }: { artists: readonly Artist[]; onRemove: (name: string) => void }) {
  const t = useTranslations('account');
  const [query, setQuery] = useState('');
  const sorted = useMemo(() => sortByAffinity(artists), [artists]);
  const q = query.trim().toLowerCase();
  const shown = useMemo(
    () => (q ? sorted.filter((a) => a.artist_name.toLowerCase().includes(q)) : sorted).slice(0, ARTISTS_PREVIEW),
    [sorted, q],
  );
  return (
    <View className="gap-3">
      <TextField
        testID="profile-artists-search"
        label={t('artistsSearch')}
        value={query}
        onChangeText={setQuery}
        autoCapitalize="none"
      />
      {shown.length === 0 ? <Text variant="muted">{t('artistsNoMatch')}</Text> : null}
      <View className="flex-row flex-wrap gap-2">
        {shown.map((a, i) => (
          <View
            key={a.artist_name}
            testID={`profile-artist-chip-${i}`}
            className="min-h-11 flex-row items-center gap-1 rounded-full border border-border bg-card ps-4"
          >
            <Text className="text-sm font-semibold">{isolate(a.artist_name)}</Text>
            <Pressable
              testID={`profile-artist-remove-${i}`}
              accessibilityRole="button"
              accessibilityLabel={t('artistsRemoveA11y', { artist: isolate(a.artist_name) })}
              onPress={() => onRemove(a.artist_name)}
              className="min-h-11 min-w-11 items-center justify-center"
            >
              <Text className="text-base font-bold">{t('artistsRemoveGlyph')}</Text>
            </Pressable>
          </View>
        ))}
      </View>
      <Pressable
        testID="profile-artists-all"
        accessibilityRole="button"
        onPress={() => router.push('/me/artists' as Href)}
        className="min-h-11 justify-center"
      >
        <Text className="text-primary">{t('artistsSeeAll', { count: artists.length })}</Text>
      </Pressable>
    </View>
  );
}
