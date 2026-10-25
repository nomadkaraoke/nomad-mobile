import type { ResultOut } from '@nomad/api-decide';
import { midiToName, type VoiceType } from '@nomad/core';
import { isolate, useTranslations } from '@nomad/i18n';
import { Button, colors, PianoStrip, StartText, Text } from '@nomad/ui';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { StepLayout } from '../../voice/StepLayout';
import { noteRange, useVoiceLabels } from '../../voice/voiceLabels';
import { stripBounds } from '../../voice/VoiceResult';

const TYPES: readonly string[] = ['bass', 'baritone', 'tenor', 'alto', 'mezzo', 'soprano'] satisfies readonly VoiceType[];
const isType = (v: string | null): v is VoiceType => v !== null && TYPES.includes(v);

const CONFIDENCE_KEY = { high: 'confidenceHigh', medium: 'confidenceMedium', low: 'confidenceLow' } as const;

/**
 * A suited or loved song's page. The session is a modal route: pushed from inside it, the song page came up on iOS 26 as
 * a second sheet with no header or back button (only a swipe down left it). So the modal closes first and the page is
 * pushed on the root stack, with its normal header and back. The session keeps its result (Done is what resets it), so
 * Find your voice reopens on it.
 */
export function openSongFromResult(id: string): void {
  if (router.canDismiss()) router.dismiss();
  router.push({ pathname: '/song/[id]', params: { id } });
}

const openSong = openSongFromResult;

function SongRow({ testID, title, artist, onPress }: { testID: string; title: string; artist: string; onPress: () => void }) {
  return (
    <Pressable testID={testID} accessibilityRole="button" onPress={onPress} className="min-h-11 justify-center rounded-xl border border-border bg-card px-3 py-2">
      <Text className="font-semibold">{isolate(title)}</Text>
      <Text variant="muted">{isolate(artist)}</Text>
    </Pressable>
  );
}

export type ResultScreenProps = {
  result: ResultOut;
  busy: boolean;
  onDone: () => void;
  /** Another session with the same setup (offered when the singer finished early). */
  onMore: () => void;
  /** "Use this as my voice" for a result decide didn't save (true once saved). */
  onAdopt?: () => Promise<boolean>;
};

/**
 * The session's result (spec §4.4): the hedged voice type, the range and its comfortable middle on a keyboard,
 * confidence and what would raise it, then songs that suit the singer and the ones they loved.
 */
export function ResultScreen({ result: r, busy, onDone, onMore, onAdopt }: ResultScreenProps) {
  const t = useTranslations('voiceSession.result');
  const labels = useVoiceLabels();
  const [adopt, setAdopt] = useState<'idle' | 'running' | 'failed'>('idle');
  const runAdopt = async () => {
    if (!onAdopt || adopt === 'running') return;
    setAdopt('running');
    setAdopt((await onAdopt()) ? 'idle' : 'failed');
  };
  let typeLine: string;
  // A type this app version doesn't know (decide added one): a generic line, never decide's raw value.
  if (!isType(r.voice_type)) typeLine = t('typeUnknown');
  else if (r.confidence_label === 'low') typeLine = t('probably', { type: labels.typeName(r.voice_type) });
  else if (isType(r.between) && r.between !== r.voice_type) {
    typeLine = labels.likely({ voiceType: r.voice_type, voiceTypeBetween: r.between, register: null });
  } else typeLine = labels.likely({ voiceType: r.voice_type, voiceTypeBetween: null, register: null });

  const [lo, hi] = stripBounds(r.low, r.high);
  const marks = [];
  for (let m = r.low; m <= r.high; m++) marks.push({ midi: m, color: colors.primary });
  // The session is over by itself (confident, tired, out of songs): no "Keep going".
  const ended = r.done_reason !== null;

  return (
    <StepLayout
      testID="vs-result"
      footer={
        <>
          <Button testID="vs-result-done" label={t('done')} onPress={onDone} />
          {ended ? null : <Button testID="vs-result-more" variant="secondary" label={t('more')} disabled={busy} onPress={onMore} />}
        </>
      }
    >
      <Text testID="vs-result-type" className="text-3xl font-bold">
        {typeLine}
      </Text>
      <StartText testID="vs-result-range" className="text-xl font-bold text-primary">
        {t('range', { range: noteRange(r.low, r.high), comfort: noteRange(r.comfort_low, r.comfort_high) })}
      </StartText>
      <PianoStrip
        testID="vs-result-keys"
        lowMidi={lo}
        highMidi={hi}
        height={72}
        marks={marks}
        band={{ from: r.comfort_low, to: r.comfort_high, color: colors.gold }}
        accessibilityLabel={t('keys')}
      />
      <View className="gap-1">
        <Text testID="vs-result-comfort-source" variant="muted">
          {r.comfort_source === 'measured' ? t('comfortMeasured') : t('comfortEstimated')}
        </Text>
        {r.falsetto_high != null ? (
          <StartText testID="vs-result-falsetto">{t('falsetto', { note: isolate(midiToName(r.falsetto_high)) })}</StartText>
        ) : null}
      </View>
      <View className="gap-1">
        <Text testID="vs-result-confidence">{t(CONFIDENCE_KEY[r.confidence_label])}</Text>
        {r.partial ? <Text variant="muted">{t('partial')}</Text> : null}
        {r.improve_hint ? (
          <Text testID="vs-result-hint" className="text-gold">
            {t(`hint.${r.improve_hint}`)}
          </Text>
        ) : null}
        {r.profile_saved ? (
          <Text testID="vs-result-saved" variant="muted">
            {t('saved')}
          </Text>
        ) : null}
      </View>
      {!r.profile_saved && onAdopt && isType(r.voice_type) ? (
        <View className="gap-1">
          <Button
            testID="vs-result-adopt"
            variant="secondary"
            label={t('adopt')}
            loading={adopt === 'running'}
            disabled={adopt === 'running'}
            onPress={() => void runAdopt()}
          />
          {adopt === 'failed' ? (
            <Text testID="vs-result-adopt-failed" className="text-gold">
              {t('adoptFailed')}
            </Text>
          ) : null}
        </View>
      ) : null}
      {r.suited.length > 0 ? (
        <View className="gap-2">
          <Text className="text-lg font-bold">{t('suited')}</Text>
          {r.suited.map((s, i) => (
            <SongRow key={s.song_key} testID={`vs-result-song-${i}`} title={s.title} artist={s.artist} onPress={() => openSong(s.song_key)} />
          ))}
        </View>
      ) : null}
      {r.loved.length > 0 ? (
        <View className="gap-2">
          <Text className="text-lg font-bold">{t('loved')}</Text>
          {r.loved.map((s, i) => (
            <SongRow key={s.song_key} testID={`vs-result-loved-${i}`} title={s.title} artist={s.artist} onPress={() => openSong(s.song_key)} />
          ))}
        </View>
      ) : null}
    </StepLayout>
  );
}
