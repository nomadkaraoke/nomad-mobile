import { useTranslations } from '@nomad/i18n';
import { Text } from '@nomad/ui';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';

/** The age label re-renders this often, so it never claims "just now" for a stale screen (A.48). */
export const FRESHNESS_TICK_MS = 5_000;

/** Ticks every 5 s and returns Date.now(). */
export function useTick(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/** "Updated 20s ago" + ↻ (spec §4.1 Freshness). `updatedAt` 0 = nothing loaded yet. */
export function Freshness({ updatedAt, onRefresh, refreshing }: { updatedAt: number; onRefresh: () => void; refreshing?: boolean }) {
  const t = useTranslations('tonight.night');
  const now = useTick(FRESHNESS_TICK_MS);
  const age = Math.max(0, Math.round((now - updatedAt) / 1000));
  const label = age < 10 ? t('freshness.now') : age < 60 ? t('freshness.seconds', { count: age }) : t('freshness.minutes', { count: Math.round(age / 60) });
  return (
    <View className="flex-row items-center justify-between gap-2">
      {updatedAt ? (
        <Text testID="tonight-freshness" variant="muted">
          {label}
        </Text>
      ) : (
        <View />
      )}
      <Pressable
        testID="tonight-refresh"
        accessibilityRole="button"
        accessibilityLabel={t('freshness.refresh')}
        accessibilityState={{ busy: Boolean(refreshing) }}
        disabled={refreshing}
        onPress={onRefresh}
        className="min-h-11 justify-center rounded-md border border-border px-3"
      >
        <Text>{t('freshness.refresh')}</Text>
      </Pressable>
    </View>
  );
}
