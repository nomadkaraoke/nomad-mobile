import { Ionicons } from '@expo/vector-icons';
import { midiToName, type Register, type VoiceType } from '@nomad/core';
import { isolate, useTranslations } from '@nomad/i18n';
import { Button, colors, PianoStrip, StartText, Text } from '@nomad/ui';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, View } from 'react-native';

import { openSignIn } from '../auth/signInUi';
import { useAuth } from '../auth/store';
import { SelfReportStep } from './SelfReportStep';
import { StepLayout } from './StepLayout';
import { usePitchSource } from './usePitchSource';
import { useVoiceTest, type VoiceResult as MicResult } from './useVoiceTest';
import { VoiceResult } from './VoiceResult';
import { useSaveVoiceProfile } from './useVoiceProfile';
import { profileFromResult, profileFromSelfReport, useVoiceStore, type LocalVoiceProfile } from './voiceStore';

/** The live strip spans every voice type's range (E2–C6) from C2. */
const STRIP_LOW = 36;
const STRIP_HIGH = 84;
const CAPTURE_STEPS = 3;
/** The sing step ends by itself after this long (useVoiceTest's SING_MS). */
const SING_S = 15;
const LISTENING_STEPS: ReadonlySet<string> = new Set(['low', 'high', 'sing']);

/**
 * `/discover/voice` (spec §4.2): the ~60 s mic test (intro → lowest → highest → sing → result), the
 * self-report picker and the result. Signed out, Save keeps the result on this phone and opens sign-in; it
 * counts as saved once sign-in returns here. useSaveVoiceProfile sends it to decide (pending until it lands).
 */
export function VoiceTestScreen() {
  const source = usePitchSource();
  const test = useVoiceTest(source);
  const { cancel, begin } = test;
  const signedIn = useAuth((s) => s.state.status === 'signedIn');
  const saveToDecide = useSaveVoiceProfile();

  const [mode, setMode] = useState<'test' | 'self'>('test');
  /** The last mic result: kept when cancel() (blur, background) resets the test. */
  const [kept, setKept] = useState<MicResult | null>(null);
  /** The profile being saved (a self-report pick, or the mic result once Save is tapped). */
  const [chosen, setChosen] = useState<LocalVoiceProfile | null>(null);
  const [saved, setSaved] = useState(false);
  const [awaitingSignIn, setAwaitingSignIn] = useState(false);

  if (test.result && test.result !== kept) {
    setKept(test.result);
    setChosen(null);
    setSaved(false);
  }
  // Back from the sign-in sheet signed in: the Save that opened it is done (the store already has it, pending).
  if (awaitingSignIn && signedIn) {
    setAwaitingSignIn(false);
    setSaved(true);
  }

  // The mic is released when the screen loses focus (back, the sign-in sheet, a tab switch) or the app goes to the
  // background while it is listening. Not on "inactive" (the iOS permission prompt, Control Centre), and not
  // during the permission request: Android pauses the activity for its dialog and RN reports that as
  // "background", so cancelling there would drop the pending begin() and land back on the intro.
  const stepRef = useRef(test.step);
  useEffect(() => {
    stepRef.current = test.step;
  }, [test.step]);
  useFocusEffect(useCallback(() => () => cancel(), [cancel]));
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'background' && LISTENING_STEPS.has(stepRef.current)) cancel();
    });
    return () => sub.remove();
  }, [cancel]);

  const save = (p: LocalVoiceProfile) => {
    setChosen(p);
    if (signedIn) {
      // Stored pending first; the PUT (and any retry) happens in the hook, so a failure never loses the result.
      void saveToDecide(p);
      setSaved(true);
    } else {
      useVoiceStore.getState().save(p); // signed out: kept on the phone, sent once signed in
      setAwaitingSignIn(true);
      openSignIn('/discover/voice');
    }
  };

  const toSelfReport = () => {
    cancel();
    setMode('self');
  };

  const close = () => (router.canGoBack() ? router.back() : router.replace('/discover'));

  const shown = chosen ?? (kept ? profileFromResult(kept.range, kept.voice, '') : null);
  if (shown) {
    return (
      <VoiceResult
        profile={shown}
        saved={saved}
        signedIn={signedIn}
        onSave={() => save(chosen ?? profileFromResult(kept!.range, kept!.voice, new Date().toISOString()))}
        onTryAgain={() => {
          const self = shown.method === 'self';
          setChosen(null);
          setKept(null);
          setSaved(false);
          setAwaitingSignIn(false);
          if (self) setMode('self');
          else {
            cancel();
            void begin();
          }
        }}
        onClose={close}
      />
    );
  }

  if (mode === 'self') {
    return (
      <SelfReportStep
        onSave={(choice: VoiceType | Register) => save(profileFromSelfReport(choice, new Date().toISOString()))}
        onTakeTest={() => setMode('test')}
      />
    );
  }

  return <TestStep test={test} onSkip={toSelfReport} />;
}

/** Whole seconds since `active` became true (0 while inactive). */
function useElapsedSeconds(active: boolean): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t0 = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 250);
    return () => {
      clearInterval(id);
      setElapsed(0);
    };
  }, [active]);
  return active ? elapsed : 0;
}

/** The sing step's countdown: a bar plus "N seconds left". */
function SingProgress({ elapsed }: { elapsed: number }) {
  const t = useTranslations('voice');
  const done = Math.min(SING_S, elapsed);
  return (
    <View className="gap-1">
      <View
        testID="voice-sing-progress"
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={t('singProgressLabel')}
        accessibilityValue={{ min: 0, max: SING_S, now: done }}
        className="h-2 overflow-hidden rounded-full bg-card"
      >
        <View className="h-2 rounded-full bg-primary" style={{ width: `${(done / SING_S) * 100}%` }} />
      </View>
      <Text variant="muted">{t('singLeft', { seconds: Math.max(1, SING_S - done) })}</Text>
    </View>
  );
}

function TestStep({ test, onSkip }: { test: ReturnType<typeof useVoiceTest>; onSkip: () => void }) {
  const t = useTranslations('voice');
  const { step } = test;
  const singElapsed = useElapsedSeconds(step === 'sing');

  if (step === 'intro') {
    return (
      <StepLayout
        testID="voice-intro"
        footer={
          <>
            <Button testID="voice-start" label={t('start')} onPress={() => void test.begin()} />
            <Button testID="voice-skip" variant="secondary" label={t('skip')} onPress={onSkip} />
          </>
        }
      >
        <View className="items-center pt-6">
          <View className="h-24 w-24 items-center justify-center rounded-full bg-card">
            <Ionicons name="mic" size={44} color={colors.primary} />
          </View>
        </View>
        <Text className="text-2xl font-bold">{t('introTitle')}</Text>
        <Text>{t('intro')}</Text>
        <Text variant="muted">{t('introPrivacy')}</Text>
      </StepLayout>
    );
  }

  if (step === 'permission-denied' || step === 'permission-blocked') {
    const blocked = step === 'permission-blocked';
    return (
      <StepLayout
        testID={`voice-${step}`}
        footer={
          <>
            {blocked ? (
              <Button testID="voice-open-settings" label={t('openSettings')} onPress={() => void Linking.openSettings()} />
            ) : (
              <Button testID="voice-retry" label={t('retry')} onPress={() => void test.retry()} />
            )}
            <Button testID="voice-skip" variant="secondary" label={t('skip')} onPress={onSkip} />
          </>
        }
      >
        <Ionicons name="mic-off" size={40} color={colors.muted} />
        <Text className="text-2xl font-bold">{t('micOffTitle')}</Text>
        <Text>{blocked ? t('micBlockedBody') : t('micDeniedBody')}</Text>
      </StepLayout>
    );
  }

  if (step === 'no-notes') {
    return (
      <StepLayout
        testID="voice-no-notes"
        footer={
          <>
            <Button testID="voice-retry" label={t('retry')} onPress={() => void test.retry()} />
            <Button testID="voice-skip" variant="secondary" label={t('skip')} onPress={onSkip} />
          </>
        }
      >
        <Ionicons name="ear-outline" size={40} color={colors.muted} />
        <Text className="text-2xl font-bold">{t('noNotesTitle')}</Text>
        <Text>{t('noNotesBody')}</Text>
      </StepLayout>
    );
  }

  if (step === 'result') return null; // VoiceTestScreen shows the kept result

  const index = step === 'low' ? 1 : step === 'high' ? 2 : 3;
  const prompt = step === 'low' ? t('lowPrompt') : step === 'high' ? t('highPrompt') : t('singPrompt');
  const listening = test.phase === 'listening';
  const status = !listening
    ? t('quiet')
    : step === 'sing'
      ? t('singing')
      : test.canDone
        ? step === 'low'
          ? t('lowGot')
          : t('highGot')
        : t('holdHint');

  return (
    <StepLayout
      testID={`voice-${step}`}
      footer={
        step === 'sing' ? (
          <Button testID="voice-sing-skip" variant="secondary" label={t('singFinish')} onPress={test.skipSing} />
        ) : (
          <Button testID={`voice-${step}-done`} label={t('done')} disabled={!test.canDone} onPress={test.done} />
        )
      }
    >
      <Text testID="voice-step" variant="muted">
        {t('stepOf', { step: index, total: CAPTURE_STEPS })}
      </Text>
      <Text className="text-2xl font-bold">{prompt}</Text>
      {step === 'sing' ? (
        <>
          <Text variant="muted">{t('singHint')}</Text>
          <SingProgress elapsed={singElapsed} />
        </>
      ) : null}
      <View className="items-center py-4">
        <StartText testID="voice-live-note" className="h-14 text-5xl font-bold text-primary">
          {listening && test.livePitch !== null ? isolate(midiToName(test.livePitch)) : ''}
        </StartText>
      </View>
      {step === 'sing' && test.held.length > 0 ? <Text variant="muted">{t('heldCaption')}</Text> : null}
      <PianoStrip
        testID="voice-keys"
        lowMidi={STRIP_LOW}
        highMidi={STRIP_HIGH}
        height={84}
        marks={test.held.map((h) => ({ midi: h.note, color: colors.primary }))}
        live={listening ? test.livePitch : null}
        accessibilityLabel={t('keyboardLabel')}
      />
      <StartText testID="voice-status" className={`text-base ${listening ? 'text-text' : 'text-gold'}`}>
        {status}
      </StartText>
    </StepLayout>
  );
}
