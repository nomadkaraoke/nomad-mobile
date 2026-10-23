import { useTranslations } from '@nomad/i18n';
import { Button, Text } from '@nomad/ui';
import { useEffect, useRef, useState } from 'react';
import { AppState, View } from 'react-native';

import { openYouTube } from '../../media/youtube';
import type { PlayerEvent } from './KaraokePlayer';
import { cancelBackNotification, ensureLocalPermission, scheduleBackNotification } from './notifications';

export type LinkOutPlayerProps = {
  videoId: string;
  /** The song's length, for the reminder (null: unknown, the reminder uses its default). */
  durationS: number | null;
  onEvent: (e: PlayerEvent) => void;
};

/**
 * The video plays in the YouTube app (or browser). "Open in YouTube" asks for notification permission (only here, on
 * the user's tap), schedules the "Done singing?" reminder for the song's length + 10 s, then opens the video and
 * reports `playing`. Coming back to the app afterwards (or "I'm back") reports `ended` and cancels the reminder.
 * The reminder is scheduled before leaving: once the app is in the background its JS may not run until it returns.
 */
export function LinkOutPlayer({ videoId, durationS, onEvent }: LinkOutPlayerProps) {
  const t = useTranslations('voiceSession');
  const emit = useRef(onEvent);
  useEffect(() => {
    emit.current = onEvent;
  });
  const reminder = useRef<string | null>(null);
  /** Set just before opening YouTube: only a return after that ends the song (not the permission prompt's). */
  const armed = useRef(false);
  const left = useRef(false);
  const ended = useRef(false);
  const played = useRef(false);
  const [busy, setBusy] = useState(false);
  const [opened, setOpened] = useState(false);
  const [failed, setFailed] = useState(false);

  const dropReminder = () => {
    const id = reminder.current;
    reminder.current = null;
    void cancelBackNotification(id);
  };

  const finish = () => {
    if (ended.current) return;
    ended.current = true;
    dropReminder();
    emit.current({ kind: 'ended' });
  };
  const finishRef = useRef(finish);
  useEffect(() => {
    finishRef.current = finish;
  });

  useEffect(() => {
    emit.current({ kind: 'ready' });
    const sub = AppState.addEventListener('change', (state) => {
      if (!armed.current || ended.current) return;
      if (state !== 'active') left.current = true;
      else if (left.current) finishRef.current();
    });
    return () => {
      sub.remove();
      dropReminder();
    };
  }, []);

  const open = async () => {
    if (busy || ended.current) return;
    setBusy(true);
    setFailed(false);
    dropReminder();
    const allowed = await ensureLocalPermission(t('notify.channel'));
    if (allowed) {
      reminder.current = await scheduleBackNotification(durationS, { title: t('notify.title'), body: t('notify.body'), channelName: t('notify.channel') });
    }
    armed.current = true;
    left.current = false;
    try {
      await openYouTube(videoId);
    } catch {
      armed.current = false;
      dropReminder();
      setFailed(true);
      setBusy(false);
      return;
    }
    setOpened(true);
    setBusy(false);
    if (!played.current) {
      played.current = true;
      emit.current({ kind: 'playing' });
    }
  };

  return (
    <View testID="vs-linkout" className="gap-3 rounded-xl border border-border bg-card p-4">
      <Text className="text-lg font-bold">{t('player.linkoutTitle')}</Text>
      <Text variant="muted">{t('player.linkoutBody')}</Text>
      <Button testID="vs-linkout-open" label={t('player.open')} onPress={() => void open()} loading={busy} />
      {failed ? (
        <Text testID="vs-linkout-failed" variant="error">
          {t('player.openFailed')}
        </Text>
      ) : null}
      {opened ? <Button testID="vs-linkout-back" variant="secondary" label={t('player.back')} onPress={finish} /> : null}
    </View>
  );
}
