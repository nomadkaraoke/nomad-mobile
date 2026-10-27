// One sung song in Me's "Your sessions" list: title and artist, whether it counts toward the voice result, and its
// controls (▶ when decide has its recording, Don't count / Count it again, Delete). testIDs use the session's index
// and the attempt number (`vs-rec-<i>-<n>`), never decide's ids (they contain `:`).
import type { HistoryAttemptOut } from '@nomad/api-decide';
import { isolate, useTranslations } from '@nomad/i18n';
import { Button, Text } from '@nomad/ui';
import { View } from 'react-native';

import type { PlaybackState } from './recording/useRecordingPlayback';

export type RecordingRowProps = {
  /** `vs-rec-<i>-<n>`. */
  testID: string;
  attempt: HistoryAttemptOut;
  /** The take is still in the phone's upload queue. */
  uploading: boolean;
  playback: PlaybackState;
  /** The key `playback` reports for this row's recording. */
  playKey: string;
  /** An exclude or delete is running for this row. */
  busy: boolean;
  onPlay: () => void;
  onToggleCounted: () => void;
  onDelete: () => void;
};

export function RecordingRow({ testID, attempt: a, uploading, playback, playKey, busy, onPlay, onToggleCounted, onDelete }: RecordingRowProps) {
  const t = useTranslations('voiceSession.recordings');
  const mine = playback.key === playKey;
  const playing = mine && playback.status === 'playing';
  const hasRecording = a.recording !== null;
  return (
    <View testID={testID} className="gap-2 border-t border-border pt-2">
      <View className="gap-0.5">
        <Text className="font-semibold">{t('song', { title: isolate(a.title), artist: isolate(a.artist) })}</Text>
        <Text testID={`${testID}-state`} variant="muted">
          {a.excluded ? t('notCounted') : t('counted')}
        </Text>
        {uploading && !hasRecording ? (
          <Text testID={`${testID}-pending`} variant="muted">
            {t('uploading')}
          </Text>
        ) : null}
      </View>
      <View className="flex-row flex-wrap gap-2">
        {hasRecording ? (
          <Button
            testID={`${testID}-play`}
            label={playing ? t('stop') : t('play')}
            variant="secondary"
            loading={mine && playback.status === 'loading'}
            onPress={onPlay}
          />
        ) : null}
        <Button
          testID={`${testID}-exclude`}
          label={a.excluded ? t('include') : t('exclude')}
          variant="secondary"
          disabled={busy}
          onPress={onToggleCounted}
        />
        {hasRecording || uploading ? (
          <Button testID={`${testID}-delete`} label={t('deleteOne')} variant="secondary" disabled={busy} onPress={onDelete} />
        ) : null}
      </View>
    </View>
  );
}
