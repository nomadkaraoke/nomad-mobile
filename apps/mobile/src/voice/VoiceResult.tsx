import { useTranslations } from '@nomad/i18n';
import { Button, colors, PianoStrip, StartText, Text } from '@nomad/ui';
import { View } from 'react-native';

import { StepLayout } from './StepLayout';
import { noteRange, useVoiceLabels } from './voiceLabels';
import type { LocalVoiceProfile } from './voiceStore';

export type ShownVoice = Omit<LocalVoiceProfile, 'measuredAt'>;

const BLACK = new Set([1, 3, 6, 8, 10]);
/** A few keys either side of the range, widened to white keys so the strip starts and ends cleanly. */
export function stripBounds(low: number, high: number): [number, number] {
  let lo = low - 3;
  let hi = high + 3;
  while (BLACK.has(((lo % 12) + 12) % 12)) lo--;
  while (BLACK.has(((hi % 12) + 12) % 12)) hi++;
  return [lo, hi];
}

const CONFIDENCE_KEY = { high: 'confidenceHigh', medium: 'confidenceMedium', low: 'confidenceLow' } as const;

export type VoiceResultProps = {
  profile: ShownVoice;
  saved: boolean;
  signedIn: boolean;
  onSave: () => void;
  onTryAgain: () => void;
  onClose: () => void;
};

/** The result: range on a keyboard, the hedged voice type, a confidence line, then Save / Try again. */
export function VoiceResult({ profile: p, saved, signedIn, onSave, onTryAgain, onClose }: VoiceResultProps) {
  const t = useTranslations('voice');
  const labels = useVoiceLabels();
  const [lo, hi] = stripBounds(p.lowMidi, p.highMidi);
  const marks = [];
  // The range in pink, its comfortable middle in gold (the colours of the range and comfort lines below).
  for (let m = p.lowMidi; m <= p.highMidi; m++) {
    marks.push({ midi: m, color: m >= p.comfortLow && m <= p.comfortHigh ? colors.gold : colors.primary });
  }

  return (
    <StepLayout
      testID="voice-result"
      footer={
        saved ? (
          <>
            <Text testID="voice-saved" className="text-center">
              {t('saved')}
            </Text>
            <Button testID="voice-close" label={t('close')} onPress={onClose} />
          </>
        ) : (
          <>
            {signedIn ? null : (
              <Text testID="voice-save-signin" variant="muted" className="text-center">
                {t('saveSignIn')}
              </Text>
            )}
            <View className="flex-row gap-3">
              <View className="flex-1">
                <Button testID="voice-try-again" variant="secondary" label={t('retry')} onPress={onTryAgain} />
              </View>
              <View className="flex-[2]">
                <Button testID="voice-save" label={t('save')} onPress={onSave} />
              </View>
            </View>
          </>
        )
      }
    >
      <Text testID="voice-result-type" className="text-4xl font-bold">
        {labels.likely(p)}
      </Text>
      <View className="gap-1">
        <Text variant="muted">{t('resultTitle')}</Text>
        <StartText testID="voice-result-range" className="text-2xl font-bold text-primary">
          {noteRange(p.lowMidi, p.highMidi)}
        </StartText>
      </View>
      <PianoStrip
        testID="voice-result-keys"
        lowMidi={lo}
        highMidi={hi}
        height={72}
        marks={marks}
        accessibilityLabel={t('rangeKeysLabel')}
      />
      <StartText testID="voice-result-comfort" className="text-base text-gold">
        {t('comfort', { range: noteRange(p.comfortLow, p.comfortHigh) })}
      </StartText>
      <Text testID="voice-result-confidence" variant="muted">
        {p.method === 'self' ? t('confidenceSelf') : t(CONFIDENCE_KEY[p.confidence])}
      </Text>
    </StepLayout>
  );
}
