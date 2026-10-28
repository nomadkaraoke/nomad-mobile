import { useTranslations } from '@nomad/i18n';
import { Text } from '@nomad/ui';
import { router, type Href } from 'expo-router';
import { Pressable } from 'react-native';

import { GetMadeShelf } from './GetMadeShelf';
import { GoTosShelf } from './GoTosShelf';
import { ProfileSummaryCard } from './ProfileSummaryCard';
import { SetlistsShelf } from './SetlistsShelf';
import { StatsCard } from './StatsCard';
import { useLibrary } from './useLibrary';
import { useStatsLog } from './useStatsLog';

/**
 * The signed-in top of Me: profile card, shelves, All your songs, stats. Phase 4c's "Were these you?" row goes
 * between the card and the go-tos; Get this made (4b) comes after the setlists.
 */
export function MeHome() {
  const t = useTranslations('me.home');
  const { items } = useLibrary();
  const log = useStatsLog();
  return (
    <>
      <ProfileSummaryCard items={items} />
      {/* 4c slot: "Were these you?" (nothing yet) */}
      <GoTosShelf items={items} />
      <SetlistsShelf />
      <GetMadeShelf />
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
