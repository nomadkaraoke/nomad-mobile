import type { RotationEntry } from '@nomad/api-kjbox';
import { isolate, useTranslations } from '@nomad/i18n';
import { Text } from '@nomad/ui';
import { Pressable, View } from 'react-native';

import { splitWait } from './model';

/** Rows to show: the box already drops Cancelled/Done/Left; drop Cancelled again defensively (A.63). */
export const visibleRotation = (entries: RotationEntry[]): RotationEntry[] =>
  entries.filter((e) => e.status.toLowerCase() !== 'cancelled');

export function RotationHeader({ empty }: { empty: boolean }) {
  const t = useTranslations('tonight.night');
  return (
    <View testID="tonight-rotation" className="gap-1 pt-2">
      <Text className="text-lg font-bold">{t('rotation.title')}</Text>
      <Text variant="muted">{t('rotation.caveat')}</Text>
      {empty ? (
        <Text testID="tonight-rotation-empty" variant="muted">
          {t('rotation.empty')}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * One rotation row with its wait estimate. `elapsedS` = seconds since the response that carried the estimates
 * (a 304 keeps the older ones, so the app counts down locally).
 */
export function RotationRow({ entry, elapsedS, onPreview }: { entry: RotationEntry; elapsedS: number; onPreview?: (entry: RotationEntry) => void }) {
  const t = useTranslations('tonight.night');
  const name = isolate(entry.display_name || entry.first_name);
  const beingMade = entry.status.toLowerCase().startsWith('being made');
  const eta =
    entry.now_singing || beingMade || entry.expected_s == null
      ? null
      : t('rotation.eta', { wait: t('wait', splitWait(Math.max(0, entry.expected_s - elapsedS))) });
  const label = entry.now_singing ? t('rotation.onNow') : beingMade ? t('rotation.beingMade') : eta;
  return (
    <View testID={`tonight-rotation-${entry.entry_id}`} className="flex-row items-center gap-3 border-b border-border py-2">
      <Text className="w-8 text-center font-bold text-muted">{entry.position}</Text>
      <View className="flex-1">
        <Text className={entry.now_singing ? 'font-bold text-success' : 'font-semibold'}>{name}</Text>
        {entry.song_artist ? <Text variant="muted">{entry.song_artist}</Text> : null}
        {label ? <Text variant="muted">{label}</Text> : null}
      </View>
      {entry.previewable ? (
        <Pressable
          testID={`tonight-rotation-preview-${entry.entry_id}`}
          accessibilityRole="button"
          accessibilityLabel={t('rotation.preview', { song: entry.song_artist })}
          onPress={() => onPreview?.(entry)}
          className="min-h-11 min-w-11 items-center justify-center rounded-md border border-border"
        >
          <Text>{'▶'}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
