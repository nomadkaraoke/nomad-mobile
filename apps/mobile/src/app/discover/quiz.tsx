import { loveSong, submitQuiz, type QuizSubmitRequest } from '@nomad/api-decide';
import { canAdvance, mergeSubmit, toSubmitRequest, type QuizDraft } from '@nomad/core';
import { useTranslations } from '@nomad/i18n';
import { Button, colors, Text } from '@nomad/ui';
import { useQueryClient } from '@tanstack/react-query';
import { router, useFocusEffect, useLocalSearchParams, type Href } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { openSignIn } from '../../auth/signInUi';
import { useAuth } from '../../auth/store';
import { ArtistStep } from '../../discover/quiz/ArtistStep';
import { DecadeEnergyStep } from '../../discover/quiz/DecadeEnergyStep';
import { GenreStep } from '../../discover/quiz/GenreStep';
import { SongStep } from '../../discover/quiz/SongStep';
import { useQuizDraft } from '../../discover/quizStore';
import { RECS_KEY } from '../../discover/useRecommendations';

const STEPS = 4;
type Step = QuizDraft['step'];
const isStep = (n: number): n is Step => n === 1 || n === 2 || n === 3 || n === 4;

/** "Get your picks in 30 seconds" (spec §8.2): a modal over Discover. Signed out, it opens sign-in first. */
export default function QuizRoute() {
  const email = useAuth((s) => (s.state.status === 'signedIn' ? s.state.session.email : null));
  useEffect(() => {
    if (!email) openSignIn('/discover/quiz');
  }, [email]);
  if (!email) return <SignedOut />;
  return <Quiz owner={email} />;
}

/** Behind the sign-in sheet; also what's left if sign-in is closed without signing in. */
function SignedOut() {
  const t = useTranslations('discover');
  return (
    <View testID="quiz-signed-out" className="flex-1 justify-center gap-4 bg-bg p-4">
      <Text className="text-lg font-semibold">{t('signInForPicks')}</Text>
      <Text variant="muted">{t('signInForPicksBody')}</Text>
      <Button testID="quiz-signin" label={t('signInForPicksAction')} onPress={() => openSignIn('/discover/quiz')} />
    </View>
  );
}

/**
 * How far the screen's content starts below the top of the window, for KeyboardAvoidingView's
 * keyboardVerticalOffset. Measured, because under an iOS page-sheet modal it is the sheet's top inset plus the
 * header, which no constant gets right on every device.
 */
function useWindowTop() {
  const ref = useRef<View>(null);
  const [top, setTop] = useState(0);
  const onLayout = useCallback(() => {
    ref.current?.measureInWindow?.((_x, y) => {
      if (Number.isFinite(y)) setTop(y);
    });
  }, []);
  return { ref, top, onLayout };
}

/** True when step 2 or 3 has no answer yet: its button says Skip instead of Next. */
function unanswered(d: QuizDraft): boolean {
  if (d.step === 2) return d.decades.length === 0 && d.energy === null;
  if (d.step === 3) return d.artists.length === 0;
  return false;
}

function Quiz({ owner }: { owner: string }) {
  const t = useTranslations('quiz');
  const insets = useSafeAreaInsets();
  const { ref: windowTopRef, top: windowTop, onLayout: onWindowTopLayout } = useWindowTop();
  const queryClient = useQueryClient();
  const { step: stepParam, from } = useLocalSearchParams<{ step?: string; from?: string }>();
  const fromProfile = from === 'profile';
  const loaded = useQuizDraft((s) => s.owner === owner);
  const draft = useQuizDraft((s) => s.draft);
  const [submitting, setSubmitting] = useState(false);
  const [failed, setFailed] = useState(false);

  // Resume (decide's saved progress, else this phone's copy); `?step=` opens that step. Closing sends any
  // pending autosave.
  useEffect(() => {
    let live = true;
    void useQuizDraft
      .getState()
      .load(owner, stepParam !== undefined)
      .then(() => {
        const want = Number(stepParam);
        if (live && isStep(want) && useQuizDraft.getState().draft.step !== want) {
          useQuizDraft.getState().update((d) => ({ ...d, step: want }));
        }
      });
    return () => {
      live = false;
      useQuizDraft.getState().flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the step param only applies when the quiz opens
  }, [owner]);

  const goTo = useCallback((step: Step) => {
    const s = useQuizDraft.getState();
    // decide web's latency trick: the slow smart-artist call starts when step 2 is left, before step 3 shows.
    if (s.draft.step === 2 && step === 3) s.suggestIfStale();
    s.update((d) => ({ ...d, step }));
  }, []);

  // Android back goes to the previous step; on step 1 it closes the quiz as usual.
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        const { draft: d, owner: o } = useQuizDraft.getState();
        if (o !== owner || d.step === 1) return false;
        goTo((d.step - 1) as Step);
        return true;
      });
      return () => sub.remove();
    }, [goTo, owner]),
  );

  const finish = async () => {
    setSubmitting(true);
    setFailed(false);
    const s = useQuizDraft.getState();
    s.flush();
    const { draft: d, saved, touched } = s;
    try {
      await submitQuiz(mergeSubmit(saved, toSubmitRequest(d), touched) as QuizSubmitRequest);
    } catch {
      setFailed(true);
      setSubmitting(false);
      return;
    }
    // The quiz submit doesn't take songs: each loved song goes to "songs you love" (best effort).
    await Promise.allSettled(d.songs.map((x) => loveSong(x.songKey, { artist: x.artist, title: x.title })));
    // Reset (not just invalidate): Discover shows its picks loading, not the old "take the quiz" card.
    void queryClient.resetQueries({ queryKey: RECS_KEY });
    router.dismissTo((fromProfile ? '/me/music-profile' : '/discover') as Href);
    // After leaving, and without resetting what's on screen, so the closing modal doesn't flash the loader.
    useQuizDraft.getState().clear();
  };

  if (!loaded) {
    return (
      <View testID="quiz-loading" className="flex-1 items-center justify-center bg-bg">
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const { step } = draft;
  const skip = unanswered(draft);
  return (
    <View ref={windowTopRef} onLayout={onWindowTopLayout} style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardAvoidingView
        testID="quiz-screen"
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={windowTop}
      >
        <ScrollView contentContainerClassName="gap-4 p-4" keyboardShouldPersistTaps="handled">
          <Text testID="quiz-step" variant="muted">
            {t('stepOf', { step, total: STEPS })}
          </Text>
          {step === 1 ? <GenreStep /> : step === 2 ? <DecadeEnergyStep /> : step === 3 ? <ArtistStep /> : <SongStep />}
        </ScrollView>
        {/* Sticky: Next / Skip / Finish never scroll away. */}
        <View
          className="gap-2 border-t border-border bg-bg px-4 pt-3"
          style={{ paddingBottom: Math.max(insets.bottom, 12) }}
        >
          {failed ? (
            <Text testID="quiz-error" variant="error">
              {t('submitError')}
            </Text>
          ) : null}
          <View className="flex-row gap-3">
            {step > 1 ? (
              <View className="flex-1">
                <Button
                  testID="quiz-back"
                  variant="secondary"
                  label={t('back')}
                  disabled={submitting}
                  onPress={() => goTo((step - 1) as Step)}
                />
              </View>
            ) : null}
            <View className="flex-[2]">
              {step === STEPS ? (
                <Button testID="quiz-finish" label={t('finish')} loading={submitting} onPress={() => void finish()} />
              ) : skip ? (
                <Button
                  testID="quiz-skip"
                  variant="secondary"
                  label={t('skip')}
                  onPress={() => goTo((step + 1) as Step)}
                />
              ) : (
                <Button
                  testID="quiz-next"
                  label={t('next')}
                  disabled={!canAdvance(draft)}
                  onPress={() => goTo((step + 1) as Step)}
                />
              )}
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}
