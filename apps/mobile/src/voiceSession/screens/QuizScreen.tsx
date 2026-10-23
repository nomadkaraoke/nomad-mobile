import type { NextSongOut } from '@nomad/api-decide';
import {
  canSubmitQuiz,
  midiToName,
  toggleWouldWorkIf,
  type PositionPrefill,
  type QuizAnswers,
  type QuizDifficulty,
  type QuizFeel,
  type QuizKnew,
  type QuizPosition,
  type QuizTag,
  type QuizVersionIssue,
  type QuizVersionQuality,
  type QuizVoiceNow,
  type QuizWouldSing,
  type QuizWouldWorkIf,
} from '@nomad/core';
import { isolate, useTranslations } from '@nomad/i18n';
import { Button, Text } from '@nomad/ui';
import { useEffect } from 'react';
import { View } from 'react-native';

import { StepLayout } from '../../voice/StepLayout';
import { ChoiceGroup } from './ChoiceGroup';

const FEEL: readonly QuizFeel[] = ['loved', 'fine', 'not_for_me'];
const POSITION: readonly QuizPosition[] = ['too_low', 'comfortable', 'too_high', 'both_ends'];
const DIFFICULTY: readonly QuizDifficulty[] = ['easy', 'stretch', 'couldnt'];
const KNEW: readonly QuizKnew[] = ['well', 'partly', 'barely'];
const SING: readonly QuizWouldSing[] = ['yes', 'yes_other_key', 'no'];
const WORK: readonly QuizWouldWorkIf[] = ['warmer', 'other_key', 'other_octave', 'practice', 'fine'];
const VOICE: readonly QuizVoiceNow[] = ['fresh', 'warm', 'tired'];
const VERSION: readonly QuizVersionQuality[] = ['good', 'not_great'];
const ISSUE: readonly QuizVersionIssue[] = ['no_intro', 'wrong_lyrics', 'bad_sync', 'low_quality'];
const TAG: readonly QuizTag[] = ['fast_lyrics', 'long_gaps', 'needed_warmup', 'crowd_song', 'mood_only'];

/** A single choice: tapping the chosen one again clears it (the optional questions can be un-answered). */
const pick = <V,>(current: V | null, v: V): V | null => (current === v ? null : v);
const toggle = <V,>(list: readonly V[], v: V): V[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

export type QuizScreenProps = {
  song: NextSongOut;
  quiz: QuizAnswers;
  prefill: PositionPrefill | null;
  busy: boolean;
  setAnswer: (patch: Partial<QuizAnswers>) => void;
  onNext: () => void;
};

/**
 * The after-song quiz (spec §4.3 step 3): one scrolling screen, Q1–Q2 required (Next stays off until both), the rest
 * optional. Q2 is pre-filled from the recording when the singer reached both ends of the song.
 */
export function QuizScreen({ song, quiz, prefill, busy, setAnswer, onNext }: QuizScreenProps) {
  const t = useTranslations('voiceSession.quiz');

  const suggested = prefill?.suggested ?? null;
  useEffect(() => {
    if (suggested && quiz.position === null) setAnswer({ position: suggested });
    // Once per song: only the suggestion matters, not later edits of the answer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [song.song_key, suggested]);

  return (
    <StepLayout
      testID="vs-quiz"
      footer={<Button testID="vs-quiz-next" label={t('next')} disabled={!canSubmitQuiz(quiz) || busy} onPress={onNext} />}
    >
      <View className="gap-1">
        <Text testID="vs-quiz-title" className="text-xl font-bold">
          {isolate(song.title)}
        </Text>
        <Text variant="muted">{t('required')}</Text>
      </View>
      <ChoiceGroup
        title={t('feel.q')}
        values={FEEL}
        selected={quiz.feel}
        label={(v) => t(`feel.${v}`)}
        onPick={(v) => setAnswer({ feel: v })}
        idPrefix="vs-q-feel"
      />
      <View className="gap-2">
        <ChoiceGroup
          title={t('position.q')}
          values={POSITION}
          selected={quiz.position}
          label={(v) => t(`position.${v}`)}
          onPick={(v) => setAnswer({ position: v })}
          idPrefix="vs-q-position"
        />
        {prefill ? (
          <Text testID="vs-prefill" className="text-gold">
            {t('prefill', { high: isolate(midiToName(prefill.highest)), low: isolate(midiToName(prefill.lowest)) })}
          </Text>
        ) : null}
      </View>
      <ChoiceGroup
        title={t('difficulty.q')}
        values={DIFFICULTY}
        selected={quiz.difficulty}
        label={(v) => t(`difficulty.${v}`)}
        onPick={(v) => setAnswer({ difficulty: pick(quiz.difficulty, v) })}
        idPrefix="vs-q-difficulty"
      />
      <ChoiceGroup
        title={t('knew.q')}
        values={KNEW}
        selected={quiz.knew}
        label={(v) => t(`knew.${v}`)}
        onPick={(v) => setAnswer({ knew: pick(quiz.knew, v) })}
        idPrefix="vs-q-knew"
      />
      <ChoiceGroup
        title={t('sing.q')}
        values={SING}
        selected={quiz.wouldSing}
        label={(v) => t(`sing.${v}`)}
        onPick={(v) => setAnswer({ wouldSing: pick(quiz.wouldSing, v) })}
        idPrefix="vs-q-sing"
      />
      <ChoiceGroup
        title={t('work.q')}
        values={WORK}
        selected={quiz.wouldWorkIf}
        label={(v) => t(`work.${v}`)}
        onPick={(v) => setAnswer({ wouldWorkIf: toggleWouldWorkIf(quiz, v).wouldWorkIf })}
        idPrefix="vs-q-work"
        multi
      />
      <ChoiceGroup
        title={t('voice.q')}
        values={VOICE}
        selected={quiz.voiceNow}
        label={(v) => t(`voice.${v}`)}
        onPick={(v) => setAnswer({ voiceNow: pick(quiz.voiceNow, v) })}
        idPrefix="vs-q-voice"
      />
      <View className="gap-2">
        <ChoiceGroup
          title={t('version.q')}
          values={VERSION}
          selected={quiz.versionQuality}
          label={(v) => t(`version.${v}`)}
          onPick={(v) => {
            const next = pick(quiz.versionQuality, v);
            setAnswer(next === 'not_great' ? { versionQuality: next } : { versionQuality: next, versionIssues: [] });
          }}
          idPrefix="vs-q-version"
        />
        {quiz.versionQuality === 'not_great' ? (
          <ChoiceGroup
            values={ISSUE}
            selected={quiz.versionIssues}
            label={(v) => t(`issue.${v}`)}
            onPick={(v) => setAnswer({ versionIssues: toggle(quiz.versionIssues, v) })}
            idPrefix="vs-q-issue"
            multi
          />
        ) : null}
      </View>
      <ChoiceGroup
        title={t('tag.q')}
        values={TAG}
        selected={quiz.tags}
        label={(v) => t(`tag.${v}`)}
        onPick={(v) => setAnswer({ tags: toggle(quiz.tags, v) })}
        idPrefix="vs-q-tag"
        multi
      />
    </StepLayout>
  );
}
