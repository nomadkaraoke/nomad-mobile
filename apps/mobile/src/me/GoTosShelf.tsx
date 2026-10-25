import { isGoTo, queryLibrary, type MeSong } from '@nomad/core';
import { isolate, useTranslations } from '@nomad/i18n';
import { Button, Text } from '@nomad/ui';
import { router, type Href } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, View } from 'react-native';

import { artistLabel } from '../tonight/log/logStore';
import { Shelf } from './Shelf';
import { openSongHref } from './songHref';

const MAX = 5;

/** Your go-tos: the songs you reliably sing well (the shared isGoTo rule), most-sung first, five at most. */
export function GoTosShelf({ items }: { items: MeSong[] }) {
  const t = useTranslations('me.home');
  const tu = useTranslations('tonight.other');
  const goTos = useMemo(
    () => queryLibrary(items, { sort: 'goto' }).filter(isGoTo).slice(0, MAX),
    [items],
  );
  return (
    <Shelf
      testID="me-gotos"
      title={t('gotosTitle')}
      onSeeAll={goTos.length ? () => router.push('/me/songs' as Href) : undefined}
      empty={
        goTos.length === 0 ? (
          <View className="gap-2 rounded-xl border border-border bg-card p-3">
            <Text variant="muted">{t('gotosEmpty')}</Text>
            <Button testID="me-gotos-empty-cta" label={t('gotosEmptyCta')} variant="secondary" onPress={() => router.push('/me/sung-before' as Href)} />
          </View>
        ) : undefined
      }
    >
      {goTos.map((s, i) => (
        <Pressable
          key={s.key}
          testID={`me-goto-${i}`}
          accessibilityRole="button"
          onPress={() => openSongHref(s)}
          className="min-h-11 flex-row items-center justify-between gap-2 rounded-xl border border-border bg-card p-3"
        >
          <View className="flex-1">
            <Text className="font-semibold" numberOfLines={1}>
              {isolate(s.title)}
            </Text>
            <Text variant="muted" numberOfLines={1}>
              {isolate(artistLabel(s.artist, tu('unknownArtist')))}
            </Text>
          </View>
        </Pressable>
      ))}
    </Shelf>
  );
}
