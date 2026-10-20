import { useTranslations } from '@nomad/i18n';
import { countUntimedWords, planSteps, type CorrectionData, type ReviewStep } from '@nomad/review-core';
import { colors } from '@nomad/ui';
import { Stack, useNavigation } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useReviewPlayer } from './audio/useReviewPlayer';
import { FinishStep } from './finish/FinishStep';
import { LyricsStep, type LyricsStepHandle, type TextRequest } from './lyrics/LyricsStep';
import { useVocalsPeaks } from './lyrics/useVocalsPeaks';
import { ReviewHeaderButtons, ReviewHeaderTitle } from './ReviewHeader';
import { ReviewMenu, useConfirmDiscard } from './ReviewMenu';
import { EditLineSheet } from './sheets/EditLineSheet';
import { NudgeSheet } from './sheets/NudgeSheet';
import { WordSheet } from './sheets/WordSheet';
import { createReviewStore, ReviewStoreContext, useReviewStore } from './store';
import { TapSyncSheet } from './sync/TapSyncSheet';
import { useEncoderWarmup } from './useEncoderWarmup';
import { useStemsPoll, type StemsState } from './useStemsPoll';

/** The sheet the review wants open. */
export type ReviewSheet =
  | { kind: 'edit' | 'nudge'; segment: number }
  /** `keepGoing`: start Tap To Sync with "Keep going into the next lines" on (several lines were just typed). */
  | { kind: 'resync'; segment: number; keepGoing?: boolean }
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
  const navigation = useNavigation();
  const plan = useMemo(() => planSteps(data), [data]);
  const [step, setStep] = useState<ReviewStep>(plan.steps[0] ?? 'finish');
  const [menuOpen, setMenuOpen] = useState(false);
  const [sheet, setSheet] = useState<ReviewSheet>(null);
  const closeSheet = useCallback(() => setSheet(null), []);
  // Ruling D: "Re-sync" from a sheet swaps it for Tap To Sync on that line.
  const resync = useCallback(
    (segment: number, opts?: { keepGoing: boolean }) =>
      setSheet(opts?.keepGoing ? { kind: 'resync', segment, keepGoing: true } : { kind: 'resync', segment }),
    [],
  );
  const lyricsRef = useRef<LyricsStepHandle>(null);
  const confirmDiscard = useConfirmDiscard();

  const canUndo = useReviewStore((s) => s.undo.canUndo);
  const undoLast = useReviewStore((s) => s.undoLast);
  const isDuet = useReviewStore((s) => s.doc.isDuet);
  const setDuet = useReviewStore((s) => s.setDuet);
  const discard = useReviewStore((s) => s.discard);
  const restored = useReviewStore((s) => s.restoredFromDraft);
  const untimed = useReviewStore((s) => countUntimedWords(s.doc.segments));

  useEncoderWarmup(jobId);
  const [stemsStart] = useState(() => initialStems(data));
  const stems = useStemsPoll(jobId, stemsStart);
  const player = useReviewPlayer(jobId, { vocalsReady: stems.ready });
  const audioDuration = player.duration > 0 ? player.duration : undefined;
  const peaks = useVocalsPeaks(jobId, stems.ready);
  const { pause } = player;

  /** Back to Lyrics is always allowed; on to Finish only once every word is timed (else, like the CTA, jump). */
  const goTo = (next: ReviewStep) => {
    if (next === 'finish' && untimed > 0) {
      if (step === 'lyrics') lyricsRef.current?.jumpToFirstUntimed();
      else setStep('lyrics');
      return;
    }
    if (next !== 'lyrics') pause();
    setStep(next);
  };

  // Back (header chevron, Android back) from Finish returns to Lyrics before it leaves the review.
  // Only back actions: a replace (after a successful finish) must still leave. The draft is kept either way.
  const backToLyrics = step === 'finish' && plan.steps.includes('lyrics');
  useEffect(() => {
    if (!backToLyrics) return;
    return navigation.addListener('beforeRemove', (e) => {
      const type = e.data.action.type;
      if (type !== 'GO_BACK' && type !== 'POP') return;
      e.preventDefault();
      setStep('lyrics');
    });
  }, [navigation, backToLyrics]);

  const title = data.metadata?.title;
  const artist = data.metadata?.artist;

  return (
    <SafeAreaView testID="review-screen" edges={['bottom', 'left', 'right']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen
        options={{
          headerTitle: () => <ReviewHeaderTitle title={title} artist={artist} />,
          headerRight: () => (
            <ReviewHeaderButtons
              canUndo={canUndo}
              onUndo={undoLast}
              onMenu={() => setMenuOpen(true)}
              undoLabel={t('undo')}
              menuLabel={t('menu')}
            />
          ),
          // iOS swipe-back can't be intercepted: on Finish the back chevron steps back to Lyrics instead.
          gestureEnabled: !backToLyrics,
        }}
      />

      <StepsHeader step={step} onStep={goTo} />

      {restored ? (
        <View className="mx-3 mb-1 flex-row items-center rounded-xl border border-border bg-card ps-3">
          <Text className="flex-1 text-sm text-text">{t('restored')}</Text>
          <Pressable
            testID="review-restored-discard"
            accessibilityRole="button"
            accessibilityLabel={t('discard')}
            onPress={() => confirmDiscard(discard)}
            className="min-h-11 justify-center px-3"
          >
            <Text className="text-sm font-semibold text-primary">{t('restoredDiscard')}</Text>
          </Pressable>
        </View>
      ) : null}

      {step === 'lyrics' ? (
        <LyricsStep
          ref={lyricsRef}
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

      {sheet?.kind === 'word' ? (
        <WordSheet
          segment={sheet.segment}
          word={sheet.word}
          player={player}
          onClose={closeSheet}
          onResyncRequested={resync}
        />
      ) : null}
      {sheet?.kind === 'text' ? (
        <EditLineSheet
          key={sheet.request.kind === 'gap' ? `gap-${sheet.request.gap.start}` : `insertAfter-${sheet.request.segment}`}
          target={sheet.request}
          onClose={closeSheet}
          onResyncRequested={resync}
          audioDuration={audioDuration}
        />
      ) : null}
      {sheet?.kind === 'edit' ? (
        <EditLineSheet
          key={`edit-${sheet.segment}`}
          target={{ kind: 'edit', segment: sheet.segment }}
          onClose={closeSheet}
          onResyncRequested={resync}
        />
      ) : null}
      {sheet?.kind === 'nudge' ? (
        <NudgeSheet segment={sheet.segment} player={player} onClose={closeSheet} onResyncRequested={resync} />
      ) : null}
      {sheet?.kind === 'resync' ? (
        <TapSyncSheet
          key={`resync-${sheet.segment}`}
          segment={sheet.segment}
          keepGoing={sheet.keepGoing}
          player={player}
          onClose={closeSheet}
        />
      ) : null}

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
