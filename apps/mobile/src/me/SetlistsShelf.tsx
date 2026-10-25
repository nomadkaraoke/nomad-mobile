import { isolate, useTranslations } from '@nomad/i18n';
import { Text } from '@nomad/ui';
import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView } from 'react-native';

import { SetlistNameSheet } from './SetlistNameSheet';
import { Shelf } from './Shelf';
import { useSetlists } from './useSetlists';

const ROW_STYLE = { flexGrow: 0 } as const;

/** Your setlists as horizontal cards, a New setlist card (asks for a name, then opens it) and See all. */
export function SetlistsShelf() {
  const t = useTranslations('me.setlists');
  const th = useTranslations('me.home');
  const { setlists, createSetlist } = useSetlists();
  const [naming, setNaming] = useState(false);
  return (
    <Shelf testID="me-setlists" title={t('title')} onSeeAll={setlists.length ? () => router.push('/me/setlists' as Href) : undefined}>
      {setlists.length === 0 ? <Text variant="muted">{th('setlistsEmpty')}</Text> : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={ROW_STYLE} contentContainerClassName="gap-2" keyboardShouldPersistTaps="handled">
        {setlists.map((s) => (
          <Pressable
            key={s.id}
            testID={`me-setlist-${s.id}`}
            accessibilityRole="button"
            onPress={() => router.push(`/me/setlists/${s.id}` as Href)}
            className="min-h-20 w-40 justify-between gap-1 rounded-xl border border-border bg-card p-3"
          >
            <Text className="font-semibold" numberOfLines={2}>
              {isolate(s.name)}
            </Text>
            <Text variant="muted">{t('count', { count: s.items?.length ?? s.song_count })}</Text>
          </Pressable>
        ))}
        <Pressable
          testID="me-setlist-new"
          accessibilityRole="button"
          onPress={() => setNaming(true)}
          className="min-h-20 w-40 items-center justify-center rounded-xl border border-dashed border-primary p-3"
        >
          <Text className="font-semibold text-primary">{t('new')}</Text>
        </Pressable>
      </ScrollView>
      <SetlistNameSheet
        visible={naming}
        title={t('newTitle')}
        onSave={(name) => router.push(`/me/setlists/${createSetlist(name)}` as Href)}
        onClose={() => setNaming(false)}
      />
    </Shelf>
  );
}
