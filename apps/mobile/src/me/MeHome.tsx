import type { PendingLog } from '@nomad/core';
import { useTranslations } from '@nomad/i18n';
import { Text } from '@nomad/ui';
import { router, type Href } from 'expo-router';
import { useMemo } from 'react';
import { Pressable } from 'react-native';

import { GoTosShelf } from './GoTosShelf';
import { ProfileSummaryCard } from './ProfileSummaryCard';
import { SetlistsShelf } from './SetlistsShelf';
import { StatsCard } from './StatsCard';
import { useLibrary } from './useLibrary';
import { useLogMirror } from './useLogMirror';

/**
 * The signed-in top of Me: profile card, shelves, All your songs, stats. Phase 4c's "Were these you?" row goes
 * between the card and the go-tos; Phase 4b's "Get this made" shelf goes after the setlists.
 */
export function MeHome() {
  const t = useTranslations('me.home');
  const { items } = useLibrary();
  const { entries } = useLogMirror();
  const log = useMemo<PendingLog[]>(
    () =>
      entries.map((e) => ({
        id: e.id,
        artist: e.artist ?? '',
        title: e.title ?? '',
        song_key: e.song_key ?? null,
        state: e.state ?? '',
        times: e.times,
        origin: e.origin ?? undefined,
        deleted: e.deleted,
        sung_at: e.sung_at ?? null,
        survey: e.survey ? ({ ...e.survey, feel: e.survey.feel ?? undefined, key: e.survey.key ?? undefined } as PendingLog['survey']) : undefined,
        night: e.night
          ? { id: e.night.id ?? undefined, date: e.night.date ?? undefined, venue_name: e.night.venue_name ?? undefined, kind: e.night.kind ?? undefined }
          : undefined,
      })),
    [entries],
  );
  return (
    <>
      <ProfileSummaryCard items={items} />
      {/* 4c slot: "Were these you?" (nothing yet) */}
      <GoTosShelf items={items} />
      <SetlistsShelf />
      {/* 4b slot: "Get this made" shelf (nothing yet) */}
      <Pressable
        testID="me-all-songs"
        accessibilityRole="button"
        onPress={() => router.push('/me/songs' as Href)}
        className="min-h-12 flex-row items-center justify-between gap-2 rounded-xl border border-border bg-card px-4 py-3"
      >
        <Text className="font-semibold">{t('allSongsRow', { count: items.length })}</Text>
        <Text importantForAccessibility="no" className="text-lg text-muted">
          {'›'}
        </Text>
      </Pressable>
      <StatsCard items={items} log={log} />
    </>
  );
}
