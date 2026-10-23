import { VOICE_TYPES, type Register, type VoiceType } from '@nomad/core';
import { useTranslations } from '@nomad/i18n';
import { Button, Chip, StartText, Text } from '@nomad/ui';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { StepLayout } from './StepLayout';
import { noteRange, useVoiceLabels } from './voiceLabels';

const REGISTERS: readonly Register[] = ['lower', 'middle', 'higher'];

export type SelfReportStepProps = {
  onSave: (choice: VoiceType | Register) => void;
  onTakeTest: () => void;
};

/** "Skip the test" (spec §4.4): Bass … Soprano, or "Not sure: lower / middle / higher voice". */
export function SelfReportStep({ onSave, onTakeTest }: SelfReportStepProps) {
  const t = useTranslations('voice');
  const labels = useVoiceLabels();
  const [choice, setChoice] = useState<VoiceType | Register | null>(null);
  return (
    <StepLayout
      testID="voice-self"
      footer={
        // Stacked, full width: side by side, "Take the mic test instead" wrapped to two lines (three in ar) and
        // stood taller than Save.
        <View className="gap-2">
          <Button testID="voice-self-save" label={t('save')} disabled={!choice} onPress={() => choice && onSave(choice)} />
          <Button testID="voice-self-take-test" variant="secondary" label={t('takeTest')} onPress={onTakeTest} />
        </View>
      }
    >
      <View className="gap-1">
        <Text className="text-xl font-bold">{t('selfTitle')}</Text>
        <Text variant="muted">{t('selfBody')}</Text>
      </View>
      <View className="flex-row flex-wrap gap-3">
        {VOICE_TYPES.map((v) => {
          const selected = choice === v.type;
          const name = labels.typeName(v.type);
          return (
            <Pressable
              key={v.type}
              testID={`voice-self-${v.type}`}
              accessibilityRole="radio"
              accessibilityLabel={name}
              accessibilityState={{ selected, checked: selected }}
              onPress={() => setChoice(v.type)}
              className={`min-h-16 grow basis-[45%] justify-center rounded-lg border px-4 py-3 ${
                selected ? 'border-primary bg-primary' : 'border-border bg-card'
              }`}
            >
              <StartText className={`text-base font-bold ${selected ? 'text-primary-fg' : 'text-text'}`}>{name}</StartText>
              <StartText className={`text-sm ${selected ? 'text-primary-fg' : 'text-muted'}`}>{noteRange(v.lo, v.hi)}</StartText>
            </Pressable>
          );
        })}
      </View>
      <View className="gap-3">
        <Text className="text-base font-semibold">{t('notSure')}</Text>
        <View className="flex-row flex-wrap gap-2">
          {REGISTERS.map((r) => (
            <Chip
              key={r}
              testID={`voice-self-${r}`}
              role="radio"
              label={labels.registerName(r)}
              selected={choice === r}
              onPress={() => setChoice(r)}
            />
          ))}
        </View>
      </View>
    </StepLayout>
  );
}
