import { Ionicons } from '@expo/vector-icons';
import type { SessionSetup } from '@nomad/api-decide';
import { useTranslations } from '@nomad/i18n';
import { Button, colors, Text } from '@nomad/ui';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { openSignIn } from '../auth/signInUi';
import { useAuth } from '../auth/store';
import type { MicPermission } from '../voice/pitchSource';
import { StepLayout } from '../voice/StepLayout';
import { VOICE_KEY } from '../voice/useVoiceProfile';
import { ContextChip } from './ContextChip';
import { PickCard } from './screens/PickCard';
import { PlayScreen } from './screens/PlayScreen';
import { QuizScreen } from './screens/QuizScreen';
import { ResultScreen } from './screens/ResultScreen';
import { SessionIntro } from './screens/SessionIntro';
import { EMPTY_DRAFT, SetupScreen, type SetupDraft } from './screens/SetupScreen';
import { WarmUp } from './screens/WarmUp';
import { useVoiceSession, type VsErrorKind } from './useVoiceSession';

const ROUTE = '/discover/voice-session';

const draftFrom = (s: SessionSetup | null): SetupDraft =>
  s ? { posture: s.posture, warmth: s.warmth, record: s.record, headphones: s.headphones } : EMPTY_DRAFT;

function Waiting({ testID, label }: { testID: string; label?: string }) {
  return (
    <View testID={testID} className="flex-1 items-center justify-center gap-3 bg-bg p-4">
      <ActivityIndicator color={colors.primary} />
      {label ? <Text variant="muted">{label}</Text> : null}
    </View>
  );
}

function ErrorStep({ kind, busy, onRetry, onRestart, onClose }: { kind: VsErrorKind; busy: boolean; onRetry: () => void; onRestart: () => void; onClose: () => void }) {
  const t = useTranslations('voiceSession');
  const lost = kind === 'session_lost';
  return (
    <StepLayout
      testID="vs-error"
      footer={
        <>
          {lost ? (
            <Button testID="vs-restart" label={t('error.restart')} onPress={onRestart} />
          ) : (
            <Button testID="vs-retry" label={t('error.retry')} disabled={busy} onPress={onRetry} />
          )}
          <Button testID="vs-error-close" variant="secondary" label={t('close')} onPress={onClose} />
        </>
      }
    >
      <Ionicons name={kind === 'network' ? 'cloud-offline-outline' : 'alert-circle-outline'} size={40} color={colors.muted} />
      <Text testID="vs-error-text">{t(`error.${kind}`)}</Text>
    </StepLayout>
  );
}

/**
 * `/discover/voice-session` (Phase 3d spec §4): mounts useVoiceSession once (it owns the recorder and the orphan
 * sweep) and shows the screen for its step. The setup answers live here so they survive the warm-up.
 */
export function VoiceSessionFlow() {
  const vs = useVoiceSession();
  const t = useTranslations('voiceSession');
  const signedIn = useAuth((s) => s.state.status === 'signedIn');
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<SetupDraft>(() => draftFrom(vs.setup));
  const [floor, setFloor] = useState<number | null>(null);
  const [afterWarmup, setAfterWarmup] = useState(false);
  /** Mic permission as last asked on the setup screen (null: not asked in this visit, e.g. a resumed session). */
  const [mic, setMic] = useState<MicPermission | null>(null);

  // A resumed session reaches a song without the setup screen: read the mic permission (checkPermission never
  // prompts) so the recording dot tells the truth. Anything but granted keeps the dot off.
  const recordOn = vs.setup?.record === true;
  useEffect(() => {
    if (mic !== null || vs.step !== 'play' || !recordOn) return;
    let live = true;
    vs.pitchSource
      .checkPermission()
      .then((p) => live && setMic(p))
      .catch(() => live && setMic('denied'));
    return () => {
      live = false;
    };
  }, [mic, vs.step, recordOn, vs.pitchSource]);

  // A result that saved the session profile: Me's voice profile reads it again.
  const savedFor = useRef<object | null>(null);
  useEffect(() => {
    if (vs.result?.profile_saved && savedFor.current !== vs.result) {
      savedFor.current = vs.result;
      void queryClient.invalidateQueries({ queryKey: VOICE_KEY });
    }
  }, [vs.result, queryClient]);

  const close = () => (router.canGoBack() ? router.back() : router.replace('/discover'));

  if (vs.restoring) return <Waiting testID="vs-restoring" />;

  if (vs.error || vs.step === 'error') {
    return (
      <ErrorStep
        kind={vs.error ?? 'session_lost'}
        busy={vs.busy}
        onRetry={() => void vs.retry()}
        onRestart={vs.reset}
        onClose={close}
      />
    );
  }

  const context = vs.setup ? <ContextChip setup={vs.setup} onPatch={(p) => void vs.patchContext(p)} /> : null;

  switch (vs.step) {
    case 'intro':
      return (
        <SessionIntro
          onStart={() => (signedIn ? vs.openSetup() : openSignIn(ROUTE))}
          onClose={close}
        />
      );
    case 'setup':
      return (
        <SetupScreen
          draft={draft}
          onDraft={(patch) => setDraft((d) => ({ ...d, ...patch }))}
          source={vs.pitchSource}
          floor={floor}
          onFloor={setFloor}
          mic={mic}
          onMic={setMic}
          afterWarmup={afterWarmup}
          busy={vs.busy}
          onBegin={(setup, f) => {
            setAfterWarmup(false);
            void vs.begin(setup, f);
          }}
          onWarmup={(f) => void vs.startWarmup(f)}
        />
      );
    case 'warmup':
      return (
        <WarmUp
          livePitch={vs.livePitch}
          onDone={() => {
            // Back on the setup, the warmth question is asked again.
            setAfterWarmup(true);
            setDraft((d) => ({ ...d, warmth: null }));
            void vs.endWarmup();
          }}
        />
      );
    case 'pick':
      return vs.song ? (
        <PickCard
          song={vs.song}
          attemptN={vs.attemptN}
          busy={vs.busy}
          onKnow={() => void vs.pickKnow()}
          onSkip={(reason) => void vs.pickSkip(reason)}
          onFinish={() => void vs.finish()}
          context={context}
        />
      ) : (
        <Waiting testID="vs-loading" label={t('loading')} />
      );
    case 'play':
      return vs.song && vs.setup ? (
        <PlayScreen
          song={vs.song}
          setup={vs.setup}
          playerMode={vs.playerMode}
          playerRef={vs.playerRef}
          onPlayer={(e) => void vs.onPlayer(e)}
          livePitch={vs.livePitch}
          micGranted={mic === 'granted'}
          onStopEarly={() => void vs.stopEarly()}
          onPatch={(p) => void vs.patchContext(p)}
        />
      ) : (
        <Waiting testID="vs-loading" label={t('loading')} />
      );
    case 'quiz':
      return vs.song ? (
        <QuizScreen
          song={vs.song}
          quiz={vs.quiz}
          prefill={vs.prefill}
          busy={vs.busy}
          setAnswer={vs.setAnswer}
          onNext={() => void vs.submitQuiz()}
        />
      ) : (
        <Waiting testID="vs-loading" label={t('loading')} />
      );
    case 'result':
      return vs.result ? (
        <ResultScreen
          result={vs.result}
          busy={vs.busy}
          onDone={() => {
            vs.reset();
            close();
          }}
          onMore={() => {
            setDraft(draftFrom(vs.setup));
            vs.openSetup();
          }}
        />
      ) : (
        <Waiting testID="vs-loading" label={t('loading')} />
      );
    case 'disabled':
      return (
        <StepLayout testID="vs-disabled" footer={<Button testID="vs-disabled-close" label={t('close')} onPress={close} />}>
          <Text className="text-2xl font-bold">{t('disabled.title')}</Text>
        </StepLayout>
      );
    case 'loading':
    default:
      return <Waiting testID="vs-loading" label={t('loading')} />;
  }
}
