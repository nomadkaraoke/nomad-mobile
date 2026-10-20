import { Ionicons } from '@expo/vector-icons';
import { getJob } from '@nomad/api-gen';
import { useTranslations } from '@nomad/i18n';
import { countUntimedWords } from '@nomad/review-core';
import { Button, colors, StartText } from '@nomad/ui';
import { useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { instrumentalUrl } from '../audio/mediaSources';
import { useReviewStore } from '../store';
import { InstrumentalChooser, useInstrumentalChoice, type Stems } from './InstrumentalChooser';
import { PreviewPanel } from './PreviewPanel';
import { createAudioFocus, AudioFocusContext } from './audioFocus';
import type { Submitter } from './useSubmitReview';

type Props = {
  jobId: string;
  stems: Stems;
  /** "Make my video", held by the review body so switching steps can't drop or repeat it. */
  submitter: Submitter;
  /** False for a job with the singer's own instrumental (`custom`): no chooser, no wait for stems. */
  showChooser: boolean;
  onBackToLyrics: () => void;
  /** The menu's "Continue on web", also offered next to Retry when the submit failed (the way out). */
  onContinueOnWeb?: () => void;
};

/**
 * Finish step (spec §4.5): a summary, the instrumental chooser, the optional preview and
 * "Make my video". Making waits for the stems (gen can't resolve a selection without them) and for
 * every word to be timed; it never waits for the preview.
 */
export function FinishStep({ jobId, stems, submitter, showChooser, onBackToLyrics, onContinueOnWeb }: Props) {
  const t = useTranslations('review.finish');
  const tr = useTranslations('review');
  const tl = useTranslations('review.lyrics');
  const editCount = useReviewStore((s) => s.editCount);
  const isDuet = useReviewStore((s) => s.doc.isDuet);
  const untimed = useReviewStore((s) => countUntimedWords(s.doc.segments));
  const choice = useInstrumentalChoice(stems);
  const { submit, state, error } = submitter;
  const locked = state === 'saving' || state === 'done';
  const scrollRef = useRef<ScrollView>(null);
  // Set when the preview turns ready: the next content-size change (the video laid out) scrolls to it.
  const scrollToPreview = useRef(false);
  const [focus] = useState(createAudioFocus);
  // translation_language lives on the job, not the correction doc. Best effort: no note without it.
  const job = useQuery({
    queryKey: ['job', jobId],
    queryFn: () => getJob(jobId),
  });
  const translation = job.data?.translation_language;

  const waitingStems = showChooser && !stems.ready;
  const blocked = waitingStems || untimed > 0;
  const stemUri = showChooser && stems.ready ? instrumentalUrl(jobId, stems.options, choice.chosen) : null;

  if (state === 'done') {
    return (
      <View testID="review-step-finish" className="flex-1 items-center justify-center gap-3 px-6">
        <View testID="review-finish-success" className="items-center gap-3" accessibilityLiveRegion="polite">
          <Ionicons name="checkmark-circle" size={64} color={colors.success} />
          <StartText className="text-center text-xl font-bold text-text">{t('success')}</StartText>
          <StartText className="text-center text-base text-muted">{t('successBody')}</StartText>
        </View>
      </View>
    );
  }

  return (
    <AudioFocusContext.Provider value={focus}>
      <View testID="review-step-finish" className="flex-1">
        <ScrollView
          testID="review-finish-scroll"
          ref={scrollRef}
          contentContainerClassName="gap-4 p-3 pb-6"
          onContentSizeChange={() => {
            if (!scrollToPreview.current) return;
            scrollToPreview.current = false;
            scrollRef.current?.scrollToEnd({ animated: true });
          }}
        >
          <View className="gap-1">
            <StartText testID="review-finish-lyrics" className="text-base text-text">
              {editCount > 0 ? t('lyricsFixes', { count: editCount }) : t('lyricsApproved')}
            </StartText>
            {isDuet ? (
              <StartText testID="review-finish-duet" className="text-base text-text">
                {t('duet')}
              </StartText>
            ) : null}
          </View>

          {showChooser ? <InstrumentalChooser jobId={jobId} stems={stems} locked={locked} /> : null}

          <PreviewPanel
            jobId={jobId}
            stemUri={stemUri}
            translationLanguage={typeof translation === 'string' ? translation : null}
            onBackToLyrics={onBackToLyrics}
            // A ready preview renders at the bottom: bring it into view.
            onReady={() => {
              scrollToPreview.current = true;
              scrollRef.current?.scrollToEnd({ animated: true });
            }}
          />
        </ScrollView>

        <View className="gap-2 border-t border-border bg-card p-3">
          {state === 'error' ? (
            <View className="gap-2">
              <StartText testID="review-finish-error" className="text-sm text-danger" accessibilityLiveRegion="polite">
                {error === 'network' ? t('failedNetwork') : t('failed')}
              </StartText>
              <View className="flex-row gap-2">
                {onContinueOnWeb ? (
                  <View className="flex-1">
                    <Button testID="review-finish-web" variant="secondary" label={tr('menuWeb')} onPress={onContinueOnWeb} />
                  </View>
                ) : null}
                <View className="flex-1">
                  {/* Retry respects what blocks Make my video (untimed words, stems not ready). */}
                  <Button testID="review-finish-retry" label={t('retry')} disabled={blocked} onPress={() => void submit()} />
                </View>
              </View>
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
            <StartText testID="review-finish-saving" className="text-center text-sm text-muted" accessibilityLiveRegion="polite">
              {t('saving')}
            </StartText>
          ) : null}
          {waitingStems && state !== 'saving' ? (
            <StartText testID="review-finish-waiting-hint" className="text-center text-sm text-muted">
              {t('waitingStemsHint')}
            </StartText>
          ) : null}
          {!waitingStems && untimed > 0 ? (
            <StartText testID="review-finish-untimed" className="text-center text-sm text-muted">
              {tl('needTiming', { count: untimed })}
            </StartText>
          ) : null}
        </View>
      </View>
    </AudioFocusContext.Provider>
  );
}
