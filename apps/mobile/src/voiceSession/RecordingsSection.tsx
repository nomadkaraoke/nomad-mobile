// Me -> Your music profile -> "Your recordings" (Phase 3d spec §6, §10c): the singer's sessions and songs from
// decide's history, each song with ▶ (their own recording), Don't count / Count it again and Delete; how many take
// recordings decide keeps, "Delete all my recordings" (upload queue first, then decide), and the default for the
// setup's consent question. Shown to every signed-in singer, so recordings can be deleted with the session flag off.
import {
  deleteVoiceRecording,
  getVoiceHistory,
  getVoiceProfiles,
  patchVoiceAttempt,
  voiceRecordingAudioUrl,
  voiceRecordingCount,
  type AttemptPatchOut,
  type HistoryAttemptOut,
  type HistorySessionOut,
} from '@nomad/api-decide';
import { useFormatter, useTranslations } from '@nomad/i18n';
import { Button, Text } from '@nomad/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Switch, View } from 'react-native';

import { useAuth } from '../auth/store';
import { ProfileSection } from '../discover/profile/ProfileSection';
import { RECS_KEY } from '../discover/useRecommendations';
import { followNextServerRead, followServerVoice, VOICE_KEY } from '../voice/useVoiceProfile';
import { useVoiceLabels } from '../voice/voiceLabels';
import { readRecordDefault, writeRecordDefault } from './recordDefault';
import { RecordingRow } from './RecordingRow';
import { deleteMyRecordings, onRecordingsUploaded, useRecordingQueue, waitForRecordingFlush } from './recording/recordingQueue';
import { useRecordingPlayback } from './recording/useRecordingPlayback';
import { RECORDING_COUNT_KEY, useVoiceHistory, VOICE_HISTORY_KEY } from './useVoiceHistory';

export { RECORDING_COUNT_KEY } from './useVoiceHistory';

const CONFIDENCE_KEY = { high: 'confidenceHigh', medium: 'confidenceMedium', low: 'confidenceLow' } as const;

/** One session's header: its date and its result (type and confidence) or "No result yet". */
function SessionHeader({ testID, session }: { testID: string; session: HistorySessionOut }) {
  const t = useTranslations('voiceSession.recordings');
  const tr = useTranslations('voiceSession.result');
  const labels = useVoiceLabels();
  const format = useFormatter();
  const r = session.result;
  return (
    <View className="gap-0.5 pt-2">
      {session.created_at ? (
        <Text testID={`${testID}-date`} className="font-semibold">
          {format.dateTime(new Date(session.created_at), { dateStyle: 'medium' })}
        </Text>
      ) : null}
      <Text testID={`${testID}-result`} variant="muted">
        {r ? t('resultChip', { type: labels.session(r), confidence: tr(CONFIDENCE_KEY[r.confidence_label]) }) : t('noResult')}
      </Text>
    </View>
  );
}

export function RecordingsSection() {
  const t = useTranslations('voiceSession.recordings');
  const tc = useTranslations('common');
  const queryClient = useQueryClient();
  const email = useAuth((s) => (s.state.status === 'signedIn' ? s.state.session.email : null));
  const key = [...RECORDING_COUNT_KEY, email] as const;
  const count = useQuery({ queryKey: key, enabled: !!email, queryFn: voiceRecordingCount, retry: false });
  const refetch = count.refetch;
  // Me stays mounted under the session modal: read the count again on coming back, and after any upload.
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false; // the query's own mount fetch covers this one
        return;
      }
      if (email) void refetch();
    }, [email, refetch]),
  );
  useEffect(() => onRecordingsUploaded(() => void queryClient.invalidateQueries({ queryKey: RECORDING_COUNT_KEY })), [queryClient]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [recordDefault, setRecordDefault] = useState(() => readRecordDefault() ?? false);

  const history = useVoiceHistory();
  const historyKey = [...VOICE_HISTORY_KEY, email] as const;
  const queued = useRecordingQueue((s) => s.items);
  const { state: playback, play, stop } = useRecordingPlayback(voiceRecordingAudioUrl);
  /** The row (`<i>-<n>`) whose exclude or delete is running. */
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [rowFailed, setRowFailed] = useState(false);
  const [outcome, setOutcome] = useState<AttemptPatchOut['profile'] | null>(null);

  const refreshAfterChange = () => {
    void queryClient.invalidateQueries({ queryKey: VOICE_HISTORY_KEY });
    void queryClient.invalidateQueries({ queryKey: RECORDING_COUNT_KEY });
  };

  const togglePlay = (key: string, recordingId: string) =>
    playback.key === key && playback.status !== 'failed' ? stop() : void play(recordingId, { key });

  const setCounted = async (key: string, a: HistoryAttemptOut) => {
    setRowBusy(key);
    setRowFailed(false);
    setOutcome(null);
    try {
      const out = await patchVoiceAttempt(a.attempt_id, { excluded: !a.excluded });
      setOutcome(out.profile);
      // decide re-derived (or reverted, or removed) the saved profile: the phone follows it now, not on the next
      // reconcile (which would keep a newer local session profile over decide's older mic result).
      if (out.profile !== 'unchanged') {
        try {
          const voice = await getVoiceProfiles();
          followServerVoice(voice.profile);
          queryClient.setQueryData([...VOICE_KEY, email], voice);
        } catch {
          // The app-wide reconcile catches up later; a revert or removal must be followed even though decide's
          // profile is then older than (or missing beside) the phone's copy.
          if (out.profile === 'reverted_to_mic' || out.profile === 'removed') followNextServerRead();
        }
      }
      void queryClient.invalidateQueries({ queryKey: VOICE_KEY });
      void queryClient.invalidateQueries({ queryKey: RECS_KEY });
    } catch {
      setRowFailed(true);
    } finally {
      setRowBusy(null);
      refreshAfterChange();
    }
  };

  const confirmCounted = (key: string, a: HistoryAttemptOut) =>
    Alert.alert(a.excluded ? t('includeTitle') : t('excludeTitle'), a.excluded ? t('includeBody') : t('excludeBody'), [
      { text: tc('cancel'), style: 'cancel' },
      {
        text: a.excluded ? t('includeConfirm') : t('excludeConfirm'),
        style: a.excluded ? 'default' : 'destructive',
        onPress: () => void setCounted(key, a),
      },
    ]);

  const deleteOne = async (key: string, sessionId: string, a: HistoryAttemptOut) => {
    setRowBusy(key);
    setRowFailed(false);
    setOutcome(null);
    if (playback.key === key) stop();
    try {
      // The queued take first, so it can't upload after the delete (decide would refuse it with 409 anyway).
      useRecordingQueue.getState().dropAttempt(sessionId, a.n);
      let id = a.recording?.recording_id ?? null;
      if (!id) {
        // An upload in flight when the take was dropped may have landed: wait for it, then look on decide.
        await waitForRecordingFlush();
        const fresh = await getVoiceHistory();
        queryClient.setQueryData(historyKey, fresh);
        id = fresh.sessions.find((s) => s.session_id === sessionId)?.attempts.find((x) => x.n === a.n)?.recording?.recording_id ?? null;
      }
      if (id) await deleteVoiceRecording(id);
    } catch {
      setRowFailed(true);
    } finally {
      setRowBusy(null);
      refreshAfterChange();
    }
  };

  const confirmDeleteOne = (key: string, sessionId: string, a: HistoryAttemptOut) =>
    Alert.alert(t('deleteOneTitle'), t('deleteOneBody'), [
      { text: tc('cancel'), style: 'cancel' },
      { text: t('deleteOneConfirm'), style: 'destructive', onPress: () => void deleteOne(key, sessionId, a) },
    ]);

  // No sheet is open on this screen, so the Alert can be raised straight away (see the iOS Modal gotcha).
  const confirmDelete = () =>
    Alert.alert(t('confirmTitle'), t('confirmBody'), [
      { text: tc('cancel'), style: 'cancel' },
      { text: t('confirmButton'), style: 'destructive', onPress: () => void onDelete() },
    ]);

  const onDelete = async () => {
    setBusy(true);
    setFailed(false);
    try {
      stop();
      await deleteMyRecordings();
      queryClient.setQueryData(key, 0);
      void queryClient.invalidateQueries({ queryKey: VOICE_HISTORY_KEY });
      // Consent is withdrawn: the setup question stops being pre-filled "yes".
      writeRecordDefault(false);
      setRecordDefault(false);
    } catch {
      setFailed(true);
      void refetch();
    } finally {
      setBusy(false);
    }
  };

  const onToggle = (on: boolean) => {
    writeRecordDefault(on);
    setRecordDefault(on);
  };

  return (
    <ProfileSection testID="vs-recordings" title={t('title')} isEmpty={false} empty="">
      {count.data !== undefined ? (
        <Text testID="vs-recordings-count">{t('count', { count: count.data })}</Text>
      ) : null}
      {failed ? (
        <Text testID="vs-recordings-error" variant="error">
          {t('failed')}
        </Text>
      ) : null}
      {history.data?.sessions.length ? (
        <View testID="vs-rec-sessions" className="gap-1">
          <Text className="font-semibold">{t('sessionsTitle')}</Text>
          <Text variant="muted">{t('sessionsBody')}</Text>
          {outcome ? (
            <Text testID="vs-rec-outcome" className="text-gold">
              {t(`outcome.${outcome}`)}
            </Text>
          ) : null}
          {rowFailed ? (
            <Text testID="vs-rec-error" variant="error">
              {t('rowFailed')}
            </Text>
          ) : null}
          {playback.status === 'failed' ? (
            <Text testID="vs-rec-play-error" variant="error">
              {t('playFailed')}
            </Text>
          ) : null}
          {history.data.sessions.map((session, i) => (
            <View key={session.session_id} testID={`vs-rec-session-${i}`} className="gap-2">
              <SessionHeader testID={`vs-rec-session-${i}`} session={session} />
              {session.attempts.map((a) => {
                const rowKey = `${i}-${a.n}`;
                return (
                  <RecordingRow
                    key={a.attempt_id}
                    testID={`vs-rec-${rowKey}`}
                    attempt={a}
                    uploading={queued.some((q) => q.sessionId === session.session_id && q.attemptN === a.n)}
                    playback={playback}
                    playKey={rowKey}
                    busy={rowBusy === rowKey}
                    onPlay={() => a.recording && togglePlay(rowKey, a.recording.recording_id)}
                    onToggleCounted={() => confirmCounted(rowKey, a)}
                    onDelete={() => confirmDeleteOne(rowKey, session.session_id, a)}
                  />
                );
              })}
            </View>
          ))}
        </View>
      ) : null}
      <Button
        testID="vs-recordings-delete"
        label={t('delete')}
        variant="secondary"
        onPress={confirmDelete}
        loading={busy}
      />
      <View className="flex-row items-center justify-between gap-3">
        <View className="flex-1 gap-1">
          <Text className="font-semibold">{t('recordDefault')}</Text>
          <Text variant="muted">{t('recordDefaultBody')}</Text>
        </View>
        <Switch
          testID="vs-record-default"
          accessibilityLabel={t('recordDefault')}
          value={recordDefault}
          onValueChange={onToggle}
        />
      </View>
    </ProfileSection>
  );
}
