import { isolate, useTranslations } from '@nomad/i18n';
import { Button, Text } from '@nomad/ui';
import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';

import { SetlistNameSheet } from '../../../me/SetlistNameSheet';
import { useSetlists } from '../../../me/useSetlists';

/** Me -> Setlists: your setlists, newest changes applied at once (optimistic, synced in the background). */
export default function SetlistsScreen() {
  const t = useTranslations('me.setlists');
  const { setlists, loading, createSetlist } = useSetlists();
  const [naming, setNaming] = useState(false);
  return (
    <View testID="setlists" className="flex-1 bg-bg">
      <ScrollView contentContainerClassName="gap-3 p-4">
        <Button testID="setlists-new" label={t('new')} onPress={() => setNaming(true)} />
        {loading && setlists.length === 0 ? <ActivityIndicator testID="setlists-loading" /> : null}
        {!loading && setlists.length === 0 ? (
          <Text testID="setlists-empty" variant="muted">
            {t('empty')}
          </Text>
        ) : null}
        {setlists.map((s) => (
          <Pressable
            key={s.id}
            testID={`setlists-row-${s.id}`}
            accessibilityRole="button"
            onPress={() => router.push(`/me/setlists/${s.id}` as Href)}
            className="min-h-11 gap-1 rounded-xl border border-border bg-card p-3"
          >
            <Text className="font-semibold" numberOfLines={1}>
              {isolate(s.name)}
            </Text>
            <Text variant="muted">{t('count', { count: s.items?.length ?? s.song_count })}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <SetlistNameSheet visible={naming} title={t('newTitle')} onSave={(name) => createSetlist(name)} onClose={() => setNaming(false)} />
    </View>
  );
}
