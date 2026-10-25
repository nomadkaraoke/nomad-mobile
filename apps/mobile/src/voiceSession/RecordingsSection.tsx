// Me -> Your music profile -> "Your recordings" (Phase 3d spec §6): how many take recordings decide keeps for the
// singer, "Delete all my recordings" (upload queue first, then decide), and the default for the setup's consent
// question. The caller shows it only to a signed-in singer whose decide has the voice session enabled.
import { voiceRecordingCount } from '@nomad/api-decide';
import { useTranslations } from '@nomad/i18n';
import { Button, Text } from '@nomad/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Switch, View } from 'react-native';

import { useAuth } from '../auth/store';
import { ProfileSection } from '../discover/profile/ProfileSection';
import { readRecordDefault, writeRecordDefault } from './recordDefault';
import { deleteMyRecordings, onRecordingsUploaded } from './recording/recordingQueue';

/** The recordings count's query key (a session or an upload changes it). */
export const RECORDING_COUNT_KEY = ['voiceSession', 'recordingCount'] as const;

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
      await deleteMyRecordings();
      queryClient.setQueryData(key, 0);
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
