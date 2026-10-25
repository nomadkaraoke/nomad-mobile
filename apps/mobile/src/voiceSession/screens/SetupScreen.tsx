import { Ionicons } from '@expo/vector-icons';
import type { SessionSetup } from '@nomad/api-decide';
import { useTranslations } from '@nomad/i18n';
import { Button, colors, Text } from '@nomad/ui';
import * as Device from 'expo-device';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Linking, View } from 'react-native';

import type { MicPermission, PitchSource } from '../../voice/pitchSource';
import { StepLayout } from '../../voice/StepLayout';
import { measureQuietSecond } from '../quietSecond';
import { POSTURES, WARMTHS, type Posture, type Warmth } from '../setupOptions';
import { ChoiceGroup } from './ChoiceGroup';

const YES_NO = ['yes', 'no'] as const;
type YesNo = (typeof YES_NO)[number];

/** The setup answers so far (null = not answered). Lives in the route, so it survives the warm-up. */
export type SetupDraft = { posture: Posture | null; warmth: Warmth | null; record: boolean | null; headphones: boolean | null };
export const EMPTY_DRAFT: SetupDraft = { posture: null, warmth: null, record: null, headphones: null };

const yn = (b: boolean | null): YesNo | null => (b === null ? null : b ? 'yes' : 'no');

export type SetupScreenProps = {
  draft: SetupDraft;
  onDraft: (patch: Partial<SetupDraft>) => void;
  source: PitchSource;
  /** The quiet second's floor once measured (after a warm-up it isn't measured again). */
  floor: number | null;
  onFloor: (floor: number) => void;
  /** Mic permission as last asked (null = not yet); kept by the route, which also needs it on the play screen. */
  mic: MicPermission | null;
  onMic: (mic: MicPermission) => void;
  /** Back from the warm-up: the warmth question is asked again and no warm-up is offered. */
  afterWarmup: boolean;
  busy: boolean;
  onBegin: (setup: SessionSetup, floor?: number) => void;
  onWarmup: (floor?: number) => void;
};

/**
 * Setup (spec §4.2): posture, warmth, recording consent, headphones; then mic permission (3c's states), the quiet
 * second for the noise floor, and for a cold voice the warm-up offer. Without the mic, recording is forced off and the
 * session goes on (the songs and the quiz still count).
 */
export function SetupScreen({ draft, onDraft, source, floor, onFloor, mic, onMic, afterWarmup, busy, onBegin, onWarmup }: SetupScreenProps) {
  const t = useTranslations('voiceSession.setup');
  const [phase, setPhase] = useState<'form' | 'quiet' | 'cold'>('form');
  /** Go is running (permission, quiet second): a second tap must not start another run on the shared source. */
  const starting = useRef(false);
  const live = useRef(true);
  /** The quiet second is running (leaving the screen then releases the mic). */
  const measuring = useRef(false);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      if (measuring.current) source.stop();
    };
  }, [source]);

  const askMic = async (): Promise<MicPermission> => {
    try {
      return await source.requestPermission();
    } catch {
      return 'denied';
    }
  };

  // Blocked: back from Settings (the app active again), ask once more; the system doesn't prompt for a blocked mic,
  // it only reports whether it's on now.
  useEffect(() => {
    if (mic !== 'blocked') return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      void askMic().then((p) => {
        if (live.current && p === 'granted') onMic('granted');
      });
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mic, source]);

  const micOff = mic === 'denied' || mic === 'blocked';
  const record = micOff ? false : draft.record;
  const ready = draft.posture !== null && draft.warmth !== null && record !== null && draft.headphones !== null;

  const setup = (): SessionSetup => ({
    posture: draft.posture!,
    warmth: draft.warmth!,
    record: record!,
    headphones: draft.headphones!,
    device: Device.modelName ?? null,
  });

  const go = async () => {
    if (!ready || phase !== 'form' || starting.current) return;
    starting.current = true;
    try {
      let f = floor;
      if (f === null && !micOff) {
        const perm = await askMic();
        if (!live.current) return;
        onMic(perm);
        // The notice shows; recording is now off and the next Go carries on without the mic.
        if (perm !== 'granted') return;
        setPhase('quiet');
        measuring.current = true;
        f = await measureQuietSecond(source);
        measuring.current = false;
        if (!live.current) return;
        onFloor(f);
      }
      if (draft.warmth === 'cold' && !afterWarmup && !micOff) {
        setPhase('cold');
        return;
      }
      setPhase('form');
      onBegin(setup(), f ?? undefined);
    } finally {
      starting.current = false;
    }
  };

  const retryMic = async () => {
    const p = await askMic();
    if (live.current) onMic(p);
  };

  if (phase === 'quiet') {
    return (
      <StepLayout testID="vs-setup-quiet" footer={null}>
        <View className="items-center gap-4 pt-10">
          <ActivityIndicator color={colors.primary} />
          <Text testID="vs-setup-quiet-text" className="text-xl font-bold">
            {t('quiet')}
          </Text>
        </View>
      </StepLayout>
    );
  }

  if (phase === 'cold') {
    return (
      <StepLayout
        testID="vs-setup-cold"
        footer={
          <>
            <Button testID="vs-warmup-start" label={t('warmupStart')} onPress={() => onWarmup(floor ?? undefined)} />
            <Button
              testID="vs-warmup-skip"
              variant="secondary"
              label={t('warmupSkip')}
              disabled={busy}
              onPress={() => onBegin(setup(), floor ?? undefined)}
            />
          </>
        }
      >
        <Text className="text-2xl font-bold">{t('coldTitle')}</Text>
        <Text>{t('coldBody')}</Text>
      </StepLayout>
    );
  }

  return (
    <StepLayout
      testID="vs-setup"
      footer={<Button testID="vs-setup-go" label={t('go')} disabled={!ready || busy} onPress={() => void go()} />}
    >
      <ChoiceGroup
        title={t('posture')}
        values={POSTURES}
        selected={draft.posture}
        label={(v) => t(v)}
        onPick={(posture) => onDraft({ posture })}
        idPrefix="vs-posture"
      />
      <ChoiceGroup
        title={afterWarmup ? t('warmthAgain') : t('warmth')}
        values={WARMTHS}
        selected={draft.warmth}
        label={(v) => t(v)}
        onPick={(warmth) => onDraft({ warmth })}
        idPrefix="vs-warmth"
      />
      {micOff ? (
        <View testID="vs-mic-off" className="gap-2 rounded-xl border border-border bg-card p-3">
          <View className="flex-row items-center gap-2">
            <Ionicons name="mic-off" size={20} color={colors.muted} />
            <Text className="font-semibold">{t('micOffTitle')}</Text>
          </View>
          <Text variant="muted">{mic === 'blocked' ? t('micBlockedBody') : t('micDeniedBody')}</Text>
          {mic === 'blocked' ? (
            <Button testID="vs-open-settings" variant="secondary" label={t('openSettings')} onPress={() => void Linking.openSettings()} />
          ) : (
            <Button testID="vs-mic-retry" variant="secondary" label={t('micRetry')} onPress={() => void retryMic()} />
          )}
        </View>
      ) : (
        <View className="gap-2">
          <ChoiceGroup
            title={t('record')}
            values={YES_NO}
            selected={yn(draft.record)}
            label={(v) => t(v)}
            onPick={(v) => onDraft({ record: v === 'yes' })}
            idPrefix="vs-record"
          />
          <Text variant="muted">{t('recordBody')}</Text>
        </View>
      )}
      <View className="gap-2">
        <ChoiceGroup
          title={t('headphones')}
          values={YES_NO}
          selected={yn(draft.headphones)}
          label={(v) => t(v)}
          onPick={(v) => onDraft({ headphones: v === 'yes' })}
          idPrefix="vs-headphones"
        />
        {draft.headphones === false ? (
          <Text testID="vs-headphones-warning" className="text-gold">
            {t('noHeadphones')}
          </Text>
        ) : null}
      </View>
    </StepLayout>
  );
}
