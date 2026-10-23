import type { NextSongOut } from '@nomad/api-decide';
import { isolate, useTranslations } from '@nomad/i18n';
import { Button, Text } from '@nomad/ui';
import type { ReactNode } from 'react';
import { View } from 'react-native';

import { StepLayout } from '../../voice/StepLayout';
import type { SkipReason } from '../useVoiceSession';

export type PickCardProps = {
  song: NextSongOut;
  /** decide's attempt number for this song (1 = the first song). */
  attemptN: number;
  busy: boolean;
  onKnow: () => void;
  onSkip: (reason: SkipReason) => void;
  onFinish: () => void;
  /** The posture / warmth chip. */
  context?: ReactNode;
};

/** The offered song (spec §4.3 step 1): why it was picked, then sing it, skip it, or finish (after the first song). */
export function PickCard({ song, attemptN, busy, onKnow, onSkip, onFinish, context }: PickCardProps) {
  const t = useTranslations('voiceSession');
  const canFinish = attemptN > 1;
  return (
    <StepLayout
      testID="vs-pick"
      footer={
        <>
          <Button testID="vs-pick-know" label={t('pick.know')} disabled={busy} onPress={onKnow} />
          <View className="flex-row gap-3">
            <View className="flex-1">
              <Button testID="vs-pick-dont-know" variant="secondary" label={t('pick.dontKnow')} disabled={busy} onPress={() => onSkip('dont_know')} />
            </View>
            <View className="flex-1">
              <Button testID="vs-pick-else" variant="secondary" label={t('pick.else')} disabled={busy} onPress={() => onSkip('something_else')} />
            </View>
          </View>
          {canFinish ? <Button testID="vs-finish" variant="secondary" label={t('pick.finish')} disabled={busy} onPress={onFinish} /> : null}
        </>
      }
    >
      <View className="flex-row items-center justify-between gap-2">
        <Text testID="vs-progress" variant="muted">
          {t('progress', { n: attemptN })}
        </Text>
        {context}
      </View>
      <View className="gap-2 rounded-2xl border border-border bg-card p-4">
        <Text testID="vs-pick-reason" className="font-semibold text-gold">
          {t(`reason.${song.reason_type}`)}
        </Text>
        <Text testID="vs-pick-title" className="text-3xl font-bold">
          {isolate(song.title)}
        </Text>
        <Text testID="vs-pick-artist" className="text-lg">
          {isolate(song.artist)}
        </Text>
        <Text variant="muted">{t('pick.version', { brand: isolate(song.version.brand_name) })}</Text>
      </View>
    </StepLayout>
  );
}
