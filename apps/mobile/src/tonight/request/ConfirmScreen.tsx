import { changeRequest, KjboxError, submitRequest } from '@nomad/api-kjbox';
import { useTranslations } from '@nomad/i18n';
import { Button, Screen, Text } from '@nomad/ui';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useRef, useState } from 'react';

import { useNightStore } from '../nightStore';
import { nightKey } from '../nomad/queries';
import { ConfirmCard } from './ConfirmCard';
import { errorCopy } from './errorCopy';
import { sourceFor, useRequestFlowScope, useRequestStore } from './requestStore';

/** Where a sent request (or a night that ended under it) goes back to: the night screen. */
export const NIGHT_ROUTE = '/tonight';

/**
 * The confirm step (A.19) and the submit (A.24–A.27): one request per confirm, idempotent on the pending pick's
 * client_request_id so a retry after a timeout never makes a second request (Review Focus 3). A change keeps the queue
 * slot (POST /requests/{id}/change, A.39). On success the night queries are invalidated (never patched with the partial
 * response, A.85) and the singer goes back to the night screen, where the song appears through /me (ruling E5-R6).
 */
export function ConfirmScreen() {
  const t = useTranslations('tonight.request.confirm');
  const tAll = useTranslations();
  useRequestFlowScope();
  const pending = useRequestStore((s) => s.pending);
  const night = useNightStore((s) => s.active);
  const userKey = useNightStore((s) => s.userKey);
  const queryClient = useQueryClient();
  const [sending, setSending] = useState(false);
  const inFlight = useRef(false); // a ref: two taps in one frame both see stale `sending` state
  const [error, setError] = useState<string | null>(null);

  if (night?.kind !== 'nomad') {
    // The night ended (night_changed, or ended elsewhere) while confirm was open.
    return (
      <Screen testID="tonight-confirm-screen">
        <Text testID="tonight-confirm-night-ended">{t('nightEnded')}</Text>
        <Button
          testID="tonight-confirm-night-ended-back"
          variant="secondary"
          label={t('backToTonight')}
          onPress={() => router.dismissTo(NIGHT_ROUTE)}
        />
      </Screen>
    );
  }
  if (!pending) {
    return (
      <Screen testID="tonight-confirm-screen">
        <Text testID="tonight-confirm-missing">{t('missing')}</Text>
        <Button testID="tonight-confirm-missing-back" variant="secondary" label={t('back')} onPress={() => router.back()} />
      </Screen>
    );
  }

  const send = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSending(true);
    setError(null);
    const p = pending; // the same pick (and client_request_id) for every retry from this confirm
    const src = sourceFor(p.song, p.version);
    try {
      if (p.mode === 'change' && p.replaces) {
        await changeRequest(night.code, p.replaces.id, { ...src, night_id: night.nightId });
      } else {
        await submitRequest(night.code, {
          ...src,
          night_id: night.nightId,
          client_request_id: p.clientRequestId,
          ...(p.mode === 'friend' && p.friendName ? { for_friend: true, friend_name: p.friendName } : {}),
        });
      }
      useRequestStore.getState().noteSend(p, 'settled');
      void queryClient.invalidateQueries({ queryKey: nightKey(night, userKey) });
      // Leaving search + confirm clears the pick (useRequestFlowScope); clearing here would flash "Pick a song first".
      router.dismissTo(NIGHT_ROUTE);
    } catch (e) {
      inFlight.current = false;
      setSending(false);
      // Unknown outcome (it may have landed): re-picking the same song keeps this client_request_id.
      const ambiguous = !(e instanceof KjboxError) || e.unreachable || e.code === 'busy_retry' || e.code === 'internal';
      useRequestStore.getState().noteSend(p, ambiguous ? 'ambiguous' : 'settled');
      if (e instanceof KjboxError && e.code === 'night_changed') {
        // The host started a new night (A.89): this request can't land in it.
        useNightStore.getState().end();
        router.dismissTo(NIGHT_ROUTE);
        return;
      }
      const c = errorCopy(e);
      setError(tAll(c.key, c.values));
    }
  };

  return (
    <Screen testID="tonight-confirm-screen" scroll>
      <ConfirmCard
        title={pending.song.title}
        artist={pending.song.artist}
        source={pending.version}
        searched={pending.searched}
        replacing={pending.mode === 'change' ? pending.replaces?.title : undefined}
        friendName={pending.mode === 'friend' ? pending.friendName : undefined}
        sending={sending}
        error={error}
        onSend={() => void send()}
        onBack={() => router.back()}
      />
    </Screen>
  );
}
