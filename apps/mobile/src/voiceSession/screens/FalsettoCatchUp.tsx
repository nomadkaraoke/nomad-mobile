import { midiToName, type FalsettoCandidate, type LabelledNote, type NoteLabel } from '@nomad/core';
import { isolate, useTranslations } from '@nomad/i18n';
import { Button, Text } from '@nomad/ui';
import { File } from 'expo-file-system';
import { useMemo } from 'react';
import { View } from 'react-native';

import { useRecordingPlayback } from '../recording/useRecordingPlayback';
import type { SongRecording } from '../recording/useSongRecorder';
import { ChoiceGroup } from './ChoiceGroup';

/** Each replayed moment starts this long before the note and stops this long after it. */
export const REPLAY_PAD_S = 0.5;

type Answer = 'yes' | 'no' | 'unsure';
const ANSWERS: readonly Answer[] = ['yes', 'no', 'unsure'];
const TO_LABEL: Record<Answer, NoteLabel> = { yes: 'falsetto', no: 'full', unsure: 'unsure' };
const FROM_LABEL: Record<NoteLabel, Answer> = { falsetto: 'yes', full: 'no', unsure: 'unsure' };

/** m:ss of a time in the song. */
const clock = (s: number) => {
  const total = Math.max(0, Math.floor(s));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

const noUrl = () => '';

export type FalsettoCatchUpProps = {
  /** The notes to ask about, highest first (at most 3; useVoiceSession's `catchUp`). */
  candidates: FalsettoCandidate[];
  /** Answers already given here (source `quiz`), to show as selected. */
  labels: LabelledNote[];
  /** The song's take still on the phone (only with recording consent), else null: no replay. */
  take: SongRecording | null;
  /** Stream time when the take started (a note at stream time t is at t − offset in the take). */
  takeOffsetS: number;
  onAnswer: (c: FalsettoCandidate, label: NoteLabel) => void;
};

/**
 * The quiz's "missed high notes" block (Phase 3d batch 1, M8): the falsetto candidates nobody answered while singing,
 * each with its note and time, a ▶ that replays that moment of the local take (consent only), and Yes / No / Not sure.
 * Optional: it never blocks Next.
 */
export function FalsettoCatchUp({ candidates, labels, take, takeOffsetS, onAnswer }: FalsettoCatchUpProps) {
  const t = useTranslations('voiceSession.falsetto');
  const { state, play, stop } = useRecordingPlayback(noUrl, { dirName: 'voice-catchup' });
  const canReplay = useMemo(() => {
    if (!take) return false;
    try {
      return new File(take.uri).exists;
    } catch {
      return false;
    }
  }, [take]);
  return (
    <View testID="vs-falsetto-catchup" className="gap-3 rounded-2xl border border-border bg-card p-3">
      <View className="gap-1">
        <Text className="font-semibold">{t('catchUpTitle')}</Text>
        <Text variant="muted">{t('catchUpBody')}</Text>
      </View>
      {candidates.map((c, k) => {
        const id = `vs-falsetto-q-${k}`;
        const note = isolate(midiToName(c.midi));
        const time = isolate(clock(c.tStart));
        const playing = state.key === id && state.status === 'playing';
        const answer = labels.find((l) => l.tStart === c.tStart && l.tEnd === c.tEnd && l.midi === c.midi);
        return (
          <View key={id} testID={id} className="gap-2">
            <View className="flex-row items-center justify-between gap-2">
              <Text testID={`${id}-note`} className="flex-1">
                {t('note', { note, time })}
              </Text>
              {canReplay && take ? (
                <Button
                  testID={`${id}-play`}
                  variant="secondary"
                  label={playing ? t('stop') : t('play')}
                  loading={state.key === id && state.status === 'loading'}
                  onPress={() =>
                    playing
                      ? stop()
                      : void play(take.uri, {
                          key: id,
                          localUri: take.uri,
                          fromS: c.tStart - takeOffsetS - REPLAY_PAD_S,
                          toS: c.tEnd - takeOffsetS + REPLAY_PAD_S,
                        })
                  }
                />
              ) : null}
            </View>
            <ChoiceGroup
              values={ANSWERS}
              selected={answer ? FROM_LABEL[answer.label] : null}
              label={(v) => (v === 'unsure' ? t('unsure') : t(v))}
              onPick={(v) => onAnswer(c, TO_LABEL[v])}
              idPrefix={id}
            />
          </View>
        );
      })}
    </View>
  );
}
