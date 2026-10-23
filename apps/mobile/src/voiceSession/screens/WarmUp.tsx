import { midiToName } from '@nomad/core';
import { isolate, useTranslations } from '@nomad/i18n';
import { Button, PianoStrip, StartText, Text } from '@nomad/ui';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { StepLayout } from '../../voice/StepLayout';

/** The warm-up's length and its hum part (spec §4.2: 60 s, hums then sirens). */
export const WARMUP_S = 60;
export const HUM_S = 20;
/** The live strip spans every voice type's range (E2–C6) from C2, as 3c's test. */
const STRIP_LOW = 36;
const STRIP_HIGH = 84;

/** Whole seconds since mount. */
function useElapsed(): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const t0 = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 250);
    return () => clearInterval(id);
  }, []);
  return elapsed;
}

/** The guided 60 s warm-up: a hum (20 s) then sirens (40 s) over the live pitch ribbon. Done any time. */
export function WarmUp({ livePitch, onDone }: { livePitch: number | null; onDone: () => void }) {
  const t = useTranslations('voiceSession.warmup');
  const elapsed = Math.min(WARMUP_S, useElapsed());
  const hum = elapsed < HUM_S;
  return (
    <StepLayout testID="vs-warmup" footer={<Button testID="vs-warmup-done" label={t('done')} onPress={onDone} />}>
      <Text testID="vs-warmup-prompt" className="text-2xl font-bold">
        {hum ? t('hum') : t('siren')}
      </Text>
      <View className="gap-1">
        <View
          testID="vs-warmup-progress"
          accessible
          accessibilityRole="progressbar"
          accessibilityValue={{ min: 0, max: WARMUP_S, now: elapsed }}
          className="h-2 overflow-hidden rounded-full bg-card"
        >
          <View className="h-2 rounded-full bg-primary" style={{ width: `${(elapsed / WARMUP_S) * 100}%` }} />
        </View>
        <Text variant="muted">{t('left', { seconds: Math.max(0, WARMUP_S - elapsed) })}</Text>
      </View>
      <View className="items-center py-4">
        <StartText testID="vs-warmup-note" className="h-14 text-5xl font-bold text-primary">
          {livePitch !== null ? isolate(midiToName(livePitch)) : ''}
        </StartText>
      </View>
      <PianoStrip
        testID="vs-warmup-keys"
        lowMidi={STRIP_LOW}
        highMidi={STRIP_HIGH}
        height={84}
        live={livePitch}
        marks={[]}
        accessibilityLabel={t('keys')}
      />
    </StepLayout>
  );
}
