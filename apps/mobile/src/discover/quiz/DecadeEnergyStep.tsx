import { DECADES, toggle, type QuizDraft } from '@nomad/core';
import { useTranslations } from '@nomad/i18n';
import { Chip } from '@nomad/ui';
import { View } from 'react-native';

import { useQuizDraft } from '../quizStore';
import { StepHeading } from './StepHeading';

const ENERGIES = ['chill', 'medium', 'high'] as const satisfies readonly NonNullable<QuizDraft['energy']>[];

/** Step 2: decades (several) and energy (one, tap again to clear). Skippable. */
export function DecadeEnergyStep() {
  const t = useTranslations('quiz');
  const td = useTranslations('discover.filter.decade');
  const decades = useQuizDraft((s) => s.draft.decades);
  const energy = useQuizDraft((s) => s.draft.energy);
  const update = useQuizDraft((s) => s.update);
  return (
    <View className="gap-6">
      <View className="gap-4">
        <StepHeading title={t('decadesTitle')} hint={t('decadesHint')} />
        <View className="flex-row flex-wrap gap-2">
          {DECADES.map((d) => (
            <Chip
              key={d}
              testID={`quiz-decade-${d}`}
              label={td(`d${d}`)}
              selected={decades.includes(d)}
              onPress={() => update((q) => ({ ...q, decades: toggle(q.decades, d) }))}
            />
          ))}
        </View>
      </View>
      <View className="gap-4" accessibilityRole="radiogroup">
        <StepHeading title={t('energyTitle')} />
        <View className="flex-row flex-wrap gap-2">
          {ENERGIES.map((e) => (
            <Chip
              key={e}
              role="radio"
              testID={`quiz-energy-${e}`}
              label={t(`energy.${e}`)}
              selected={energy === e}
              onPress={() => update((q) => ({ ...q, energy: q.energy === e ? null : e }))}
            />
          ))}
        </View>
      </View>
    </View>
  );
}
