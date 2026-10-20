import { useTranslations } from '@nomad/i18n';
import { planSteps, type CorrectionData, type ReviewStep } from '@nomad/review-core';
import { colors } from '@nomad/ui';
import { useEffect, useMemo, useState } from 'react';
import { AppState, BackHandler, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useReviewPlayer } from './audio/useReviewPlayer';
import { FinishStep } from './finish/FinishStep';
import { IconButton } from './IconButton';
import { LyricsStep, type TextRequest } from './lyrics/LyricsStep';
import { useVocalsPeaks } from './lyrics/useVocalsPeaks';
import { ReviewMenu } from './ReviewMenu';
import { createReviewStore, ReviewStoreContext, useReviewStore } from './store';
import { useEncoderWarmup } from './useEncoderWarmup';
import { useStemsPoll, type StemsState } from './useStemsPoll';

/** The sheet the review wants open. The sheets themselves are mounted by the editing tasks that follow. */
export type ReviewSheet =
  | { kind: 'edit' | 'resync' | 'nudge'; segment: number }
  | { kind: 'word'; segment: number; word: number }
  | { kind: 'text'; request: TextRequest }
  | null;

export type ReviewScreenProps = {
  jobId: string;
  /** The loaded correction doc (`useReviewLoader`). */
  data: CorrectionData;
  /** Menu "Continue on web"; hidden when undefined. */
  onContinueOnWeb?: () => void;
};

/** The native review (spec §4): one store per open review, a Lyrics step and a Finish step. */
export function ReviewScreen(props: ReviewScreenProps) {
  const { jobId, data } = props;
  const [store] = useState(() => createReviewStore(jobId, data));

  // Leaving the screen or backgrounding the app writes the pending draft now (the app may be killed).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') store.getState().flushDraft();
    });
    return () => {
      sub.remove();
      store.getState().flushDraft();
    };
  }, [store]);

  return (
    <ReviewStoreContext.Provider value={store}>
      <ReviewBody {...props} />
    </ReviewStoreContext.Provider>
  );
}

function initialStems(data: CorrectionData): StemsState {
  return {
    options: data.instrumental_options ?? [],
    audioComplete: typeof data.audio_complete === 'boolean' ? data.audio_complete : undefined,
    analysis: data.backing_vocals_analysis,
    autoApproval: data.auto_approval,
  };
}

function ReviewBody({ jobId, data, onContinueOnWeb }: ReviewScreenProps) {
  const t = useTranslations('review');
  const plan = useMemo(() => planSteps(data), [data]);
  const [step, setStep] = useState<ReviewStep>(plan.steps[0] ?? 'finish');
  const [menuOpen, setMenuOpen] = useState(false);
  // Read by the word / line / Tap To Sync sheets once they are mounted here.
  const [, setSheet] = useState<ReviewSheet>(null);

  const canUndo = useReviewStore((s) => s.undo.canUndo);
  const undoLast = useReviewStore((s) => s.undoLast);
  const isDuet = useReviewStore((s) => s.doc.isDuet);
  const setDuet = useReviewStore((s) => s.setDuet);
  const discard = useReviewStore((s) => s.discard);
  const restored = useReviewStore((s) => s.restoredFromDraft);

  useEncoderWarmup(jobId);
  const [stemsStart] = useState(() => initialStems(data));
  const stems = useStemsPoll(jobId, stemsStart);
  const player = useReviewPlayer(jobId, { vocalsReady: stems.ready });
  const peaks = useVocalsPeaks(jobId);
  const { pause } = player;

  const goTo = (next: ReviewStep) => {
    if (next !== 'lyrics') pause();
    setStep(next);
  };

  // Android back steps back from Finish to Lyrics before it leaves the review (the draft is kept either way).
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (step === 'finish' && plan.steps.includes('lyrics')) {
        setStep('lyrics');
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [step, plan]);

  const title = data.metadata?.title;
  const artist = data.metadata?.artist;

  return (
    <SafeAreaView testID="review-screen" edges={['bottom', 'left', 'right']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <View className="flex-row items-center gap-1 ps-4 pe-1">
        <View className="flex-1">
          {title ? (
            <Text numberOfLines={1} className="text-base font-bold text-text">
              {title}
            </Text>
          ) : null}
          {artist ? (
            <Text numberOfLines={1} className="text-sm text-muted">
              {artist}
            </Text>
          ) : null}
        </View>
        <IconButton testID="review-undo" icon="arrow-undo" label={t('undo')} disabled={!canUndo} onPress={undoLast} />
        <IconButton testID="review-menu" icon="ellipsis-horizontal-circle" label={t('menu')} onPress={() => setMenuOpen(true)} />
      </View>

      <StepsHeader step={step} onStep={goTo} />

      {restored ? (
        <View className="mx-3 mb-1 flex-row items-center rounded-xl border border-border bg-card ps-3">
          <Text className="flex-1 text-sm text-text">{t('restored')}</Text>
          <Pressable
            testID="review-restored-discard"
            accessibilityRole="button"
            accessibilityLabel={t('discard')}
            onPress={discard}
            className="min-h-11 justify-center px-3"
          >
            <Text className="text-sm font-semibold text-primary">{t('restoredDiscard')}</Text>
          </Pressable>
        </View>
      ) : null}

      {step === 'lyrics' ? (
        <LyricsStep
          player={player}
          peaks={peaks}
          vocalsReady={stems.ready}
          onEditLine={(segment) => setSheet({ kind: 'edit', segment })}
          onResync={(segment) => setSheet({ kind: 'resync', segment })}
          onNudge={(segment) => setSheet({ kind: 'nudge', segment })}
          onWordPress={(segment, word) => setSheet({ kind: 'word', segment, word })}
          onRequestText={(request) => setSheet({ kind: 'text', request })}
          onNext={() => goTo('finish')}
        />
      ) : (
        <FinishStep />
      )}

      <ReviewMenu
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        isDuet={isDuet}
        onSetDuet={setDuet}
        onDiscard={discard}
        onContinueOnWeb={onContinueOnWeb}
      />
    </SafeAreaView>
  );
}

const STEPS: ReviewStep[] = ['lyrics', 'finish'];

/** Two-part progress, Lyrics · Finish; either part can be tapped. */
function StepsHeader({ step, onStep }: { step: ReviewStep; onStep: (s: ReviewStep) => void }) {
  const t = useTranslations('review.steps');
  return (
    <View className="mx-3 mb-2 flex-row gap-2" accessibilityRole="tablist">
      {STEPS.map((s, i) => {
        const on = s === step;
        return (
          <Pressable
            key={s}
            testID={`review-steps-${s}`}
            accessibilityRole="tab"
            accessibilityLabel={t('a11y', { n: i + 1, total: STEPS.length, name: t(s) })}
            accessibilityState={{ selected: on }}
            onPress={() => onStep(s)}
            className="min-h-11 flex-1 justify-end pb-1"
          >
            <Text className={`text-center text-sm font-semibold ${on ? 'text-primary' : 'text-muted'}`}>{t(s)}</Text>
            <View className={`mt-1 h-1 rounded-full ${on ? 'bg-primary' : 'bg-border'}`} />
          </Pressable>
        );
      })}
    </View>
  );
}
