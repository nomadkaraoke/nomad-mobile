import { isolate, useTranslations } from '@nomad/i18n';
import { List, Text, type ListHandle } from '@nomad/ui';
import { useMemo, useRef } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { useAuth } from '../../auth/store';
import { groupArtists, type ArtistRow } from '../../discover/profile/artistGroups';
import { useMusicProfile } from '../../discover/profile/useMusicProfile';

/** Me -> music profile -> All artists: every artist A-Z with a letter jump bar. */
export default function ArtistsAllScreen() {
  const t = useTranslations('account');
  const signedIn = useAuth((s) => s.state.status === 'signedIn');
  const p = useMusicProfile();
  const listRef = useRef<ListHandle>(null);
  const names = useMemo(() => (p.artists.data?.artists ?? []).map((a) => a.artist_name), [p.artists.data]);
  const rows = useMemo(() => groupArtists(names), [names]);
  const headerIndex = useMemo(() => {
    const m = new Map<string, number>();
    rows.forEach((r, i) => r.kind === 'header' && m.set(r.letter, i));
    return m;
  }, [rows]);

  if (!signedIn) {
    return (
      <View testID="artists-screen" className="flex-1 bg-bg p-4">
        <Text variant="muted">{t('musicProfileSignedOut')}</Text>
      </View>
    );
  }

  if (p.artists.isPending) {
    return (
      <View testID="artists-screen" className="flex-1 bg-bg p-4">
        <ActivityIndicator testID="artists-loading" />
      </View>
    );
  }
  if (rows.length === 0) {
    return (
      <View testID="artists-screen" className="flex-1 bg-bg p-4">
        <Text testID="artists-empty" variant="muted">
          {t('musicProfileArtistsEmpty')}
        </Text>
      </View>
    );
  }

  const renderRow = (r: ArtistRow) =>
    r.kind === 'header' ? (
      <View testID={`artists-header-${r.letter}`} className="px-4 pb-1 pt-4">
        <Text className="font-bold text-primary">{r.letter}</Text>
      </View>
    ) : (
      <View className="min-h-11 flex-row items-center justify-between gap-2 px-4">
        <Text testID={`artists-row-${r.index}`} className="flex-1">
          {isolate(r.name)}
        </Text>
        <Pressable
          testID={`artists-remove-${r.index}`}
          accessibilityRole="button"
          accessibilityLabel={t('artistsRemoveA11y', { artist: isolate(r.name) })}
          onPress={() => p.removeArtist(r.name)}
          className="min-h-11 min-w-11 items-center justify-center"
        >
          <Text className="font-bold">{t('artistsRemoveGlyph')}</Text>
        </Pressable>
      </View>
    );

  return (
    <View testID="artists-screen" className="flex-1 flex-row bg-bg">
      <View className="flex-1">
        <List
          ref={listRef}
          testID="artists-list"
          data={rows}
          keyExtractor={(r) => (r.kind === 'header' ? `h_${r.letter}` : `a_${r.name}`)}
          getItemType={(r) => r.kind}
          renderItem={renderRow}
        />
      </View>
      <View className="justify-center py-2">
        {[...headerIndex.keys()].map((letter) => (
          <Pressable
            key={letter}
            testID={`artists-jump-${letter}`}
            accessibilityRole="button"
            accessibilityLabel={letter}
            onPress={() => listRef.current?.scrollToIndex(headerIndex.get(letter) ?? 0, { animated: false })}
            className="min-h-6 min-w-8 items-center justify-center"
          >
            <Text className="text-xs font-semibold text-primary">{letter}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
