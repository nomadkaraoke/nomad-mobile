import { Ionicons } from '@expo/vector-icons';
import { getJob } from '@nomad/api-gen';
import { useTranslations } from '@nomad/i18n';
import { countUntimedWords } from '@nomad/review-core';
import { Button, colors } from '@nomad/ui';
import { useQuery } from '@tanstack/react-query';
import { ScrollView, Text, View } from 'react-native';

import { instrumentalUrl } from '../audio/mediaSources';
import { useReviewStore } from '../store';
import { InstrumentalChooser, useInstrumentalChoice, type Stems } from './InstrumentalChooser';
import { PreviewPanel } from './PreviewPanel';
import { useSubmitReview } from './useSubmitReview';

type Props = {
  jobId: string;
  stems: Stems;
  /** False for a job with the singer's own instrumental (`custom`): no chooser, no wait for stems. */
  showChooser: boolean;
  onBackToLyrics: () => void;
};

/**
 * Finish step (spec §4.5): a summary, the instrumental chooser, the optional preview and
 * "Make my video". Making waits for the stems (gen can't resolve a selection without them) and for
 * every word to be timed; it never waits for the preview.
 */
export function FinishStep({ jobId, stems, showChooser, onBackToLyrics }: Props) {
  const t = useTranslations('review.finish');
  const tl = useTranslations('review.lyrics');
  const editCount = useReviewStore((s) => s.editCount);
  const isDuet = useReviewStore((s) => s.doc.isDuet);
  const untimed = useReviewStore((s) => countUntimedWords(s.doc.segments));
  const choice = useInstrumentalChoice(stems);
  const selection = showChooser ? choice.submit : 'custom';
  const { submit, state, error } = useSubmitReview(jobId, selection);
  // translation_language lives on the job, not the correction doc. Best effort: no note without it.
  const job = useQuery({ queryKey: ['job', jobId], queryFn: () => getJob(jobId) });
  const translation = job.data?.translation_language;

  const waitingStems = showChooser && !stems.ready;
  const blocked = waitingStems || untimed > 0;
  const stemUri = showChooser && stems.ready ? instrumentalUrl(jobId, stems.options, choice.chosen) : null;

  if (state === 'done') {
    return (
      <View testID="review-step-finish" className="flex-1 items-center justify-center gap-3 px-6">
        <View testID="review-finish-success" className="items-center gap-3" accessibilityLiveRegion="polite">
          <Ionicons name="checkmark-circle" size={64} color={colors.success} />
          <Text className="text-center text-xl font-bold text-text">{t('success')}</Text>
          <Text className="text-center text-base text-muted">{t('successBody')}</Text>
        </View>
      </View>
    );
  }

  return (
    <View testID="review-step-finish" className="flex-1">
      <ScrollView contentContainerClassName="gap-4 p-3 pb-6">
        <View className="gap-1">
          <Text testID="review-finish-lyrics" className="text-base text-text">
            {editCount > 0 ? t('lyricsFixes', { count: editCount }) : t('lyricsApproved')}
          </Text>
          {isDuet ? (
            <Text testID="review-finish-duet" className="text-base text-text">
              {t('duet')}
            </Text>
          ) : null}
        </View>

        {showChooser ? <InstrumentalChooser jobId={jobId} stems={stems} /> : null}

        <PreviewPanel
          jobId={jobId}
          stemUri={stemUri}
          translationLanguage={typeof translation === 'string' ? translation : null}
          onBackToLyrics={onBackToLyrics}
        />
      </ScrollView>

      <View className="gap-2 border-t border-border bg-card p-3">
        {state === 'error' ? (
          <View className="gap-2">
            <Text testID="review-finish-error" className="text-sm text-danger" accessibilityLiveRegion="polite">
              {error === 'network' ? t('failedNetwork') : t('failed')}
            </Text>
            <Button testID="review-finish-retry" label={t('retry')} onPress={() => void submit()} />
          </View>
        ) : (
          <Button
            testID="review-finish-submit"
            label={waitingStems ? t('waitingStems') : t('submit')}
            loading={state === 'saving'}
            disabled={blocked}
            onPress={() => void submit()}
          />
        )}
        {state === 'saving' ? (
          <Text testID="review-finish-saving" className="text-center text-sm text-muted" accessibilityLiveRegion="polite">
            {t('saving')}
          </Text>
        ) : null}
        {waitingStems && state !== 'saving' ? (
          <Text testID="review-finish-waiting-hint" className="text-center text-sm text-muted">
            {t('waitingStemsHint')}
          </Text>
        ) : null}
        {!waitingStems && untimed > 0 ? (
          <Text testID="review-finish-untimed" className="text-center text-sm text-muted">
            {tl('needTiming', { count: untimed })}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
