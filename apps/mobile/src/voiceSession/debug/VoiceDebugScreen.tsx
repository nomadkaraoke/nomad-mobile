// Hidden admin voice debug screen (Phase 3d B3): per song the computed markers next to Andrew's sheet label, his
// session attempts (with a play button per recording) and the model's prediction.
import { adminRecordingUrl, type UserSongOut } from '@nomad/api-decide';
import { midiToName } from '@nomad/core';
import { isolate, useTranslations } from '@nomad/i18n';
import { Button, List, Screen, Text } from '@nomad/ui';
import { ActivityIndicator, View } from 'react-native';

import { type PlaybackState, useRecordingPlayback } from '../recording/useRecordingPlayback';
import { useVoiceDebugSongs, useVoiceFlags } from './useVoiceDebug';

type Translate = ReturnType<typeof useTranslations>;
type Attempt = UserSongOut['attempts'][number];

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const note = (v: unknown): string | null => {
  const n = num(v);
  return n === null ? null : midiToName(Math.round(n));
};
const pair = (a: unknown, b: unknown, t: Translate): string => {
  const x = note(a);
  const y = note(b);
  return x && y ? isolate(`${x}–${y}`) : t('unknown');
};
const val = (v: unknown, t: Translate): string => (typeof v === 'string' || typeof v === 'number' ? String(v) : t('unknown'));
const one = (v: unknown, t: Translate): string => {
  const n = num(v);
  return n === null ? t('unknown') : String(Math.round(n * 10) / 10);
};

/** The markers line: range, P10–P90, sustained highs, density, intro, then which register splits an octave. */
function markersText(markers: UserSongOut['markers'], t: Translate): string {
  if (!markers) return t('markersNone');
  const line = t('markers', {
    range: pair(markers.low, markers.high, t),
    core: pair(markers.p10, markers.p90, t),
    sustained: val(markers.sustained_high_count, t),
    density: one(markers.syllables_per_s, t),
    intro: one(markers.intro_s, t),
  });
  const men = markers.octave_split_male === true;
  const women = markers.octave_split_female === true;
  if (!men && !women) return line;
  const who = men && women ? t('octaveBoth') : men ? t('octaveMale') : t('octaveFemale');
  return `${line}. ${t('octaveSplit', { who })}`;
}

function attemptText(a: Attempt, n: number, t: Translate): string {
  const q = a.quiz ?? {};
  const base = t('attempt', { n, feel: val(q.feel, t), position: val(q.position, t), difficulty: val(q.difficulty, t) });
  const ctx = Object.values(a.context ?? {}).filter((v) => typeof v === 'string' || typeof v === 'number' || v === true);
  const pitch = a.pitch ? t('attemptPitch', { core: pair(a.pitch.p10, a.pitch.p90, t) }) : null;
  return [base, ...(pitch ? [pitch] : []), ...ctx.map(String)].join(' · ');
}

function SongRow({
  song,
  index,
  playback,
  onPlay,
  t,
}: {
  song: UserSongOut;
  index: number;
  playback: PlaybackState;
  onPlay: (key: string, recordingId: string) => void;
  t: Translate;
}) {
  const label = song.label;
  const pred = song.prediction;
  return (
    <View testID={`vs-debug-song-${index}`} className="gap-1 border-b border-border py-3">
      <Text className="font-semibold">{`${isolate(song.title ?? song.song_key)} · ${isolate(song.artist ?? '')}`}</Text>
      <Text testID={`vs-debug-label-${index}`} variant="muted">
        {label ? t('label', { good: val(label.good, t), tags: label.tags.join(', ') }) : t('labelNone')}
        {label?.notes ? ` · ${label.notes}` : ''}
      </Text>
      <Text testID={`vs-debug-markers-${index}`} variant="muted">
        {markersText(song.markers, t)}
      </Text>
      <Text testID={`vs-debug-prediction-${index}`}>
        {pred ? t('prediction', { verdict: pred.good ? t('verdictGood') : t('verdictNotGood'), p: pred.p.toFixed(2) }) : t('predictionNone')}
      </Text>
      {song.attempts.map((a, i) => {
        const n = i + 1;
        const key = `${index}-${n}`;
        const mine = playback.key === key;
        return (
          <View key={key} testID={`vs-debug-attempt-${index}-${n}`} className="gap-1 pt-1">
            <Text>{attemptText(a, n, t)}</Text>
            {a.recording_id ? (
              <Button
                testID={`vs-debug-play-${index}-${n}`}
                label={mine && playback.status === 'playing' ? t('stop') : t('play')}
                variant="secondary"
                loading={mine && playback.status === 'loading'}
                onPress={() => onPlay(key, a.recording_id as string)}
              />
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

export function VoiceDebugScreen() {
  const t = useTranslations('voiceSession.debug');
  const flags = useVoiceFlags();
  const songs = useVoiceDebugSongs();
  const isAdmin = flags.data?.is_admin === true;
  const { state, play, stop } = useRecordingPlayback(adminRecordingUrl, { dirName: 'voice-debug' });
  // A second tap on the take that is loading or playing stops it.
  const toggle = (key: string, recordingId: string) =>
    state.key === key && state.status !== 'failed' ? stop() : void play(recordingId, { key });

  return (
    <Screen testID="vs-debug" underHeader>
      {flags.isPending ? <ActivityIndicator testID="vs-debug-loading" accessibilityLabel={t('loading')} /> : null}
      {!flags.isPending && !isAdmin ? (
        <Text testID="vs-debug-unavailable" variant="muted">
          {t('notAvailable')}
        </Text>
      ) : null}
      {isAdmin && songs.isPending ? <ActivityIndicator testID="vs-debug-loading" accessibilityLabel={t('loading')} /> : null}
      {isAdmin && songs.isError ? (
        <Text testID="vs-debug-error" variant="error">
          {t('error')}
        </Text>
      ) : null}
      {state.status === 'failed' ? (
        <Text testID="vs-debug-play-error" variant="error">
          {t('playFailed')}
        </Text>
      ) : null}
      <List
        testID="vs-debug-list"
        data={isAdmin ? (songs.data ?? []) : []}
        keyExtractor={(s) => s.song_key}
        extraData={state}
        ListEmptyComponent={isAdmin && songs.isSuccess ? <Text variant="muted">{t('empty')}</Text> : undefined}
        renderItem={(song, index) => <SongRow song={song} index={index} playback={state} onPlay={toggle} t={t} />}
      />
    </Screen>
  );
}
