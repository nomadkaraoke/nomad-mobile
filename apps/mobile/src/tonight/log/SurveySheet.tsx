import { isolate, useTranslations } from '@nomad/i18n';
import { Button, Text, TextField } from '@nomad/ui';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { TonightSheet } from '../TonightSheet';
import { useLogStore, type LogSurvey } from './logStore';

/** decide caps survey notes at 2000 characters. */
export const SURVEY_NOTES_MAX = 2000;

export type SurveySheetProps = {
  /** The log record id (`kj_…` history_id or `app_…`). null: closed. */
  entryId: string | null;
  artist: string;
  title: string;
  /** Called after save or skip (the sheet is then done with this song). */
  onDone?: () => void;
  /** Previous answers to start from (reopened from "How did it go?"). */
  initial?: LogSurvey;
};

type Feel = NonNullable<LogSurvey['feel']>;
type Key = NonNullable<LogSurvey['key']>;
const FEELS: Feel[] = ['great', 'ok', 'bad'];
const KEYS: Key[] = ['too_low', 'right', 'too_high'];
type Vibe = NonNullable<LogSurvey['vibes']>[number];
type Reason = NonNullable<LogSurvey['reasons']>[number];
const VIBES: Vibe[] = ['party', 'ballad', 'warm_up', 'duet', 'emotional', 'rock_out', 'singalong'];
const REASONS: Reason[] = ['out_of_range', 'too_hard', 'crowd_quiet', 'awkward_music', 'too_long', 'didnt_know_it'];
const toggle = <T,>(list: T[], v: T): T[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
const CROWD = ['yes', 'no'] as const;

function Chip({ testID, label, selected, onPress }: { testID: string; label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      className={`min-h-11 justify-center rounded-full border px-4 ${selected ? 'border-primary bg-primary/15' : 'border-border bg-card'}`}
    >
      <Text className={selected ? 'font-semibold text-primary' : ''}>{label}</Text>
    </Pressable>
  );
}

/**
 * The post-song survey (spec §6.3): how it felt, the key, crowd-pleaser and notes. Every answer is optional; it never
 * blocks (closing it skips, ruling E8-R3). Saving goes through the log store and the outbox (`{survey}` only).
 */
export function SurveySheet({ entryId, artist, title, onDone, initial }: SurveySheetProps) {
  const t = useTranslations('tonight.survey');
  const skip = () => {
    if (entryId) useLogStore.getState().skipSurvey(entryId);
    onDone?.();
  };
  return (
    // holdsSurvey={false}: the survey must not hold itself back (the night screen already keeps the automatic one
    // closed while a manual "How did it go?" is open).
    <TonightSheet
      holdsSurvey={false}
      visible={entryId !== null}
      onClose={skip}
      title={t('title')}
      testID="survey"
      closeLabel={t('close')}
    >
      {/* Keyed by the song: a new song starts with blank answers. */}
      {entryId ? <SurveyForm key={entryId} entryId={entryId} artist={artist} title={title} initial={initial} onSkip={skip} onDone={onDone} /> : null}
    </TonightSheet>
  );
}

function SurveyForm({
  entryId,
  artist,
  title,
  onSkip,
  onDone,
  initial,
}: {
  initial?: LogSurvey;
  entryId: string;
  artist: string;
  title: string;
  onSkip: () => void;
  onDone?: () => void;
}) {
  const t = useTranslations('tonight.survey');
  const [feel, setFeel] = useState<Feel | null>(initial?.feel ?? null);
  const [key, setKey] = useState<Key | null>(initial?.key ?? null);
  const [crowd, setCrowd] = useState<boolean | null>(initial?.crowd_pleaser ?? null);
  const [vibes, setVibes] = useState<Vibe[]>(initial?.vibes ?? []);
  const [reasons, setReasons] = useState<Reason[]>(initial?.reasons ?? []);
  const [notes, setNotes] = useState(initial?.notes ?? '');

  const save = () => {
    const trimmed = notes.trim();
    // "What got in the way?" only applies to ok/bad: a reason picked before switching to great is dropped.
    const whyAsked = feel === 'ok' || feel === 'bad';
    const sendReasons = whyAsked && reasons.length > 0;
    const sendVibes = vibes.length > 0;
    // Edit mode: only a field that had values in `initial` and is now empty is cleared (reasons also when the feel is
    // now great, where "what got in the way?" no longer applies).
    const clear: ('vibes' | 'reasons' | 'notes')[] = [];
    if (!trimmed && initial?.notes?.trim()) clear.push('notes');
    if (!sendVibes && initial?.vibes?.length) clear.push('vibes');
    if (!sendReasons && initial?.reasons?.length) clear.push('reasons');
    useLogStore.getState().saveSurvey(
      entryId,
      {
        ...(feel ? { feel } : {}),
        ...(key ? { key } : {}),
        ...(crowd !== null ? { crowd_pleaser: crowd } : {}),
        ...(sendVibes ? { vibes } : {}),
        ...(sendReasons ? { reasons } : {}),
        ...(trimmed ? { notes: trimmed } : {}),
      },
      clear,
    );
    onDone?.();
  };

  return (
    <View className="gap-4 pb-2">
      <Text variant="muted">{t('song', { title: isolate(title), artist: isolate(artist) })}</Text>
      <View className="gap-2">
        <Text className="font-semibold">{t('feelQuestion')}</Text>
        <View className="flex-row flex-wrap gap-2">
          {FEELS.map((v) => (
            <Chip key={v} testID={`survey-feel-${v}`} label={t(`feel.${v}`)} selected={feel === v} onPress={() => setFeel(feel === v ? null : v)} />
          ))}
        </View>
      </View>
      <View className="gap-2">
        <Text className="font-semibold">{t('keyQuestion')}</Text>
        <View className="flex-row flex-wrap gap-2">
          {KEYS.map((v) => (
            <Chip key={v} testID={`survey-key-${v}`} label={t(`key.${v}`)} selected={key === v} onPress={() => setKey(key === v ? null : v)} />
          ))}
        </View>
      </View>
      <View className="gap-2">
        <Text className="font-semibold">{t('crowdQuestion')}</Text>
        <View className="flex-row flex-wrap gap-2">
          {CROWD.map((v) => {
            const value = v === 'yes';
            return (
              <Chip
                key={v}
                testID={`survey-crowd-${v}`}
                label={t(`crowd.${v}`)}
                selected={crowd === value}
                onPress={() => setCrowd(crowd === value ? null : value)}
              />
            );
          })}
        </View>
      </View>
      <View className="gap-2">
        <Text className="font-semibold">{t('vibesLabel')}</Text>
        <View className="flex-row flex-wrap gap-2">
          {VIBES.map((v) => (
            <Chip key={v} testID={`survey-vibe-${v}`} label={t(`vibe.${v}`)} selected={vibes.includes(v)} onPress={() => setVibes(toggle(vibes, v))} />
          ))}
        </View>
      </View>
      {feel === 'ok' || feel === 'bad' ? (
        <View className="gap-2">
          <Text className="font-semibold">{t('reasonsLabel')}</Text>
          <View className="flex-row flex-wrap gap-2">
            {REASONS.map((v) => (
              <Chip
                key={v}
                testID={`survey-reason-${v}`}
                label={t(`reason.${v}`)}
                selected={reasons.includes(v)}
                onPress={() => setReasons(toggle(reasons, v))}
              />
            ))}
          </View>
        </View>
      ) : null}
      <TextField
        testID="survey-notes"
        label={t('notesLabel')}
        placeholder={t('notesPlaceholder')}
        value={notes}
        onChangeText={(s) => setNotes(s.slice(0, SURVEY_NOTES_MAX))}
        autoCapitalize="sentences"
      />
      <Button testID="survey-save" label={t('save')} onPress={save} />
      <Button testID="survey-skip" variant="secondary" label={t('skip')} onPress={onSkip} />
    </View>
  );
}
