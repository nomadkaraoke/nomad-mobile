import { karaokeStats, type MeSong, type PendingLog } from '@nomad/core';
import { isolate, useTranslations } from '@nomad/i18n';
import { Chip, ChipRow, Text } from '@nomad/ui';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { artistLabel } from '../tonight/log/logStore';

/** Karaoke stats with a This year / All time switch (counts come from the library and the log mirror). */
export function StatsCard({ items, log }: { items: MeSong[]; log: PendingLog[] }) {
  const t = useTranslations('me.home');
  const tu = useTranslations('tonight.other');
  const [scope, setScope] = useState<'year' | 'all'>('year');
  const stats = useMemo(() => karaokeStats(items, log, scope === 'year' ? { year: new Date().getFullYear() } : {}), [items, log, scope]);
  return (
    <View testID="me-stats" className="gap-3 rounded-xl border border-border bg-card p-3">
      <Text accessibilityRole="header" className="text-lg font-bold">
        {t('statsTitle')}
      </Text>
      <ChipRow testID="me-stats-scope">
        <Chip testID="me-stats-year" label={t('thisYear')} selected={scope === 'year'} onPress={() => setScope('year')} role="radio" />
        <Chip testID="me-stats-all" label={t('allTime')} selected={scope === 'all'} onPress={() => setScope('all')} role="radio" />
      </ChipRow>
      {stats.performances === 0 ? (
        <Text testID="me-stats-empty" variant="muted">
          {t('statsEmpty')}
        </Text>
      ) : (
        <View className="gap-1">
          <Text testID="me-stats-songs">{t('songs', { count: stats.songs })}</Text>
          <Text testID="me-stats-performances">{t('performances', { count: stats.performances })}</Text>
          <Text testID="me-stats-nights">{t('nights', { count: stats.nights })}</Text>
          <Text testID="me-stats-venues">{t('venues', { count: stats.venues })}</Text>
          {stats.topArtist ? <Text testID="me-stats-top-artist">{t('topArtist', { artist: isolate(artistLabel(stats.topArtist, tu('unknownArtist'))) })}</Text> : null}
          {stats.mostSung ? (
            <Text testID="me-stats-most-sung">
              {t('mostSung', { song: isolate(stats.mostSung.title), count: stats.mostSung.count })}
            </Text>
          ) : null}
          {stats.greatShare !== null ? <Text testID="me-stats-great">{t('greatShare', { percent: Math.round(stats.greatShare * 100) })}</Text> : null}
        </View>
      )}
    </View>
  );
}
