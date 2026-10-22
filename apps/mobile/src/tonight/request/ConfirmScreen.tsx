import { changeRequest, KjboxError, submitRequest, type MeResult } from '@nomad/api-kjbox';
import { isolate, useTranslations } from '@nomad/i18n';
import { Button, Screen, Text } from '@nomad/ui';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { View } from 'react-native';

import { DuetPicker } from '../manage/DuetPicker';
import { consentFields, loadNightConsent, NightConsentQuestion, saveNightConsent, useAskPhotoConsent, type NightConsent } from '../manage/NightConsent';
import { storedPhone } from '../manage/PhoneSheet';
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
  // Duet partners (spec §4.1, ruling E6-R7): up to 3, picked from tonight's singers, kept on the pending pick (they
  // are part of its signature). Not offered on a change (the change body has no singers; the song keeps its own).
  const partners = pending?.partners ?? [];
  const [picking, setPicking] = useState(false);
  // The once-per-night photo consent (ruling E6-R8): asked here only until answered for this account and night.
  const nomad = night?.kind === 'nomad' ? night : null;
  const askConsent = useAskPhotoConsent(nomad, userKey);
  // Read per account + night: another account or a new night never inherits the answer (state adjusted during render).
  const consentKey = nomad ? `${userKey ?? 'anon'}:${nomad.nightId}` : null;
  const [loaded, setLoaded] = useState(() => {
    const c = nomad ? loadNightConsent(userKey, nomad.nightId) : {};
    return { key: consentKey, consent: c, answeredBefore: c.consent !== undefined };
  });
  if (loaded.key !== consentKey) {
    const c = nomad ? loadNightConsent(userKey, nomad.nightId) : {};
    setLoaded({ key: consentKey, consent: c, answeredBefore: c.consent !== undefined });
  }
  const consent = loaded.consent;
  const answeredBefore = loaded.answeredBefore;
  const setConsent = (c: NightConsent) => setLoaded((l) => ({ ...l, consent: c }));
  const tManage = useTranslations('tonight.manage.duet');
  const tSong = useTranslations('tonight.night.song');

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
        // Idempotent like submit (ruling E5-R9): a retry reuses the confirm's id. A replay answers with the superseding
        // request, whose id may differ from the path id; nothing here relies on it (the night queries refetch).
        await changeRequest(night.code, p.replaces.id, { ...src, night_id: night.nightId, client_request_id: p.clientRequestId });
      } else {
        const friend = p.mode === 'friend' && p.friendName;
        // The phone kept on this device (ruling E6-R5): kjbox stores a phone only on requests. Never on a friend's.
        const phone = friend ? null : storedPhone(userKey);
        // Own requests carry the night answer (only ever given when the host asked); unknown is never sent (A.91);
        // never on a friend's.
        const media = friend ? {} : consentFields(consent);
        await submitRequest(night.code, {
          ...src,
          night_id: night.nightId,
          client_request_id: p.clientRequestId,
          ...(friend ? { for_friend: true, friend_name: p.friendName } : {}),
          ...(phone ? { phone } : {}),
          ...media,
          ...(p.partners?.length ? { additional_singers: p.partners.map((name) => ({ name })) } : {}),
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

  const ownName = queryClient.getQueryData<MeResult>([...nightKey(night, userKey), 'me'])?.me.name;
  const [a = '', b = '', ...rest] = partners.map((n) => isolate(n));
  const withLine =
    partners.length === 0 ? null : partners.length === 1 ? tSong('with1', { a }) : partners.length === 2 ? tSong('with2', { a, b }) : tSong('with3', { a, b, c: rest.join(', ') });
  const partnersBlock = (
    <View className="gap-2">
      {withLine ? <Text testID="tonight-confirm-partners">{withLine}</Text> : null}
      <Button
        testID="tonight-confirm-duet"
        variant="secondary"
        label={partners.length ? tManage('edit') : tManage('add')}
        disabled={sending}
        onPress={() => setPicking(true)}
      />
      {askConsent && pending.mode === 'new' && !answeredBefore ? (
        <NightConsentQuestion
          value={consent}
          onChange={(v) => {
            setConsent(v);
            saveNightConsent(userKey, night.nightId, v);
          }}
        />
      ) : null}
    </View>
  );

  return (
    <Screen testID="tonight-confirm-screen" scroll>
      <ConfirmCard
        title={pending.song.title}
        artist={pending.song.artist}
        source={pending.version}
        searched={pending.searched}
        replacing={pending.mode === 'change' ? pending.replaces?.title : undefined}
        friendName={pending.mode === 'friend' ? pending.friendName : undefined}
        extra={pending.mode === 'change' ? null : partnersBlock}
        sending={sending}
        error={error}
        onSend={() => void send()}
        onBack={() => router.back()}
      />
      <DuetPicker
        visible={picking}
        night={night}
        userKey={userKey}
        selected={partners}
        onChange={(names) => useRequestStore.getState().setPartners(names)}
        onClose={() => setPicking(false)}
        exclude={ownName ? [ownName] : []}
      />
    </Screen>
  );
}
