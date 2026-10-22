import { GENRE_IDS, toggle } from '@nomad/core';
import { useTranslations } from '@nomad/i18n';
import { Chip } from '@nomad/ui';
import { View } from 'react-native';

import { useQuizDraft } from '../quizStore';
import { StepHeading } from './StepHeading';

/** decide's genre ids to their message keys (`classic-rock` is `classicRock`). */
const labelKey = (id: string) => id.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());

/** Step 1: decide's 22 genres (the last is "Something else"). At least one is needed to go on. */
export function GenreStep() {
  const t = useTranslations('quiz');
  const tg = useTranslations('discover.filter.genre');
  const genres = useQuizDraft((s) => s.draft.genres);
  const update = useQuizDraft((s) => s.update);
  return (
    <View className="gap-4">
      <StepHeading title={t('genresTitle')} hint={t('genresHint')} />
      <View className="flex-row flex-wrap gap-2">
        {GENRE_IDS.map((g) => (
          <Chip
            key={g}
            testID={`quiz-genre-${g}`}
            label={tg(labelKey(g))}
            selected={genres.includes(g)}
            onPress={() => update((d) => ({ ...d, genres: toggle(d.genres, g) }))}
          />
        ))}
      </View>
    </View>
  );
}
