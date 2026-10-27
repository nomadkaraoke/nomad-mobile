// One voice result on Me's "Your voice" (Phase 3d tuning batch 1): where it came from (the mic test or the latest
// voice session), its lines (type, range or confidence, comfort, songs), when, and "Used for song fit" on the card
// behind the saved profile. Extra content (a session's adopt) goes in `children`.
import { useFormatter, useTranslations } from '@nomad/i18n';
import { Text } from '@nomad/ui';
import type { ReactNode } from 'react';
import { View } from 'react-native';

export type VoiceResultCardProps = {
  testID: string;
  title: string;
  /** The hedged type line ("Likely Baritone", "Between Baritone and Tenor"). */
  type: string;
  /** Range, confidence, comfort, songs: one muted line each, in order. */
  lines: string[];
  /** ISO time it was measured / computed (null: no date line). */
  at: string | null;
  /** This result is the saved profile, the one song fit uses. */
  active: boolean;
  children?: ReactNode;
};

export function VoiceResultCard({ testID, title, type, lines, at, active, children }: VoiceResultCardProps) {
  const t = useTranslations('fit');
  const format = useFormatter();
  const date = at ? new Date(at) : null;
  return (
    <View testID={testID} className={`gap-1 rounded-xl border p-3 ${active ? 'border-primary' : 'border-border'}`}>
      <View className="flex-row flex-wrap items-center justify-between gap-2">
        <Text className="font-semibold">{title}</Text>
        {active ? (
          <Text testID="voice-active-badge" className="text-gold">
            {t('profileActive')}
          </Text>
        ) : null}
      </View>
      <Text className="text-lg font-bold">{type}</Text>
      {lines.map((line, i) => (
        <Text key={i} variant="muted">
          {line}
        </Text>
      ))}
      {date && !Number.isNaN(date.getTime()) ? <Text variant="muted">{format.dateTime(date, { dateStyle: 'medium' })}</Text> : null}
      {children}
    </View>
  );
}
