import { KjboxError, setSongConsent, updateMe, type Song } from '@nomad/api-kjbox';
import { useTranslations } from '@nomad/i18n';
import { Text } from '@nomad/ui';
import { useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';

import { songKey } from '../nomad/model';
import { errorCopy } from '../request/errorCopy';
import { manageTiming, useInvalidateNight, useManage, type ManageContextValue } from './SongActions';

type Consent = 'yes' | 'no';

/** A per-song choice resolved against the night-wide one; unknown means no (A.91, A.94). */
export const effectiveConsent = (song: string | null | undefined, night: string | null | undefined): Consent =>
  (song ?? night) === 'yes' ? 'yes' : 'no';

/** The toggle shows on the singer's own songs only: never a friend's, a host- or partner-added one (A.94). */
export const showsConsent = (song: Song): boolean =>
  song.owner === 'me' &&
  song.request.id != null &&
  !song.removed &&
  song.request.status !== 'rejected' &&
  song.request.status !== 'cancelled';

/**
 * 📷 "OK to post / Don't post" on one of the singer's own songs (spec §4.1 consent, ruling E6-R4): only when the host
 * asks (`features.ask_photo_consent`), never on friend songs. Taps settle for 600 ms and send one PUT, and only when
 * the value differs from what the box already has (A.95: one singer's 11 taps in 10 s hit 429s). Turning yes into no
 * on a sung song asks "Just this song" / "Nothing from tonight".
 */
export function ConsentToggle({ song }: { song: Song }) {
  const m = useManage();
  if (!m || !m.askConsent || m.readOnly || !showsConsent(song)) return null;
  return <ConsentButton song={song} m={m} />;
}

function ConsentButton({ song, m }: { song: Song; m: ManageContextValue }) {
  const t = useTranslations('tonight.manage.consent');
  const tAll = useTranslations();
  const key = songKey(song);
  const id = song.request.id!;
  const nightConsent = m.profile?.photo_consent ?? null;
  const server = effectiveConsent(song.request.media_consent, nightConsent);
  const invalidate = useInvalidateNight(m.night, m.userKey);

  const [shown, setShown] = useState<Consent>(server);
  const desired = useRef<Consent>(server);
  const confirmed = useRef<Consent>(server);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);
  const [asking, setAsking] = useState(false);

  // A fresher /me read is the truth, unless the singer is mid-change.
  useEffect(() => {
    if (timer.current || inFlight.current) return;
    confirmed.current = server;
    desired.current = server;
    setShown(server);
  }, [server]);

  const fail = (e: unknown) => {
    desired.current = confirmed.current;
    setShown(confirmed.current);
    const c = errorCopy(e);
    m.notify(e instanceof KjboxError && !e.unreachable && e.code === 'rate_limited' ? tAll(c.key, c.values) : t('failed'), 'error');
  };

  // flush can run from a timer or the unmount cleanup, after later renders: it reads the latest values, never the
  // closure of the render that scheduled it.
  const latest = useRef({ m, nightConsent, invalidate, fail });
  useEffect(() => {
    latest.current = { m, nightConsent, invalidate, fail };
  });

  const flush = async () => {
    timer.current = null;
    const value = desired.current;
    if (value === confirmed.current || inFlight.current) return; // unchanged: no request (A.95)
    const L = latest.current;
    inFlight.current = true;
    try {
      // Matching the night-wide choice clears the per-song override instead of pinning it (as the web does).
      await setSongConsent(L.m.night.code, id, value === L.nightConsent ? null : value, L.m.night.nightId);
      confirmed.current = value;
      L.invalidate();
    } catch (e) {
      latest.current.fail(e);
    } finally {
      inFlight.current = false;
      // A tap that landed while this one was in flight.
      if (desired.current !== confirmed.current && !timer.current) timer.current = setTimeout(() => void flush(), manageTiming.consentDebounceMs);
    }
  };

  const schedule = (value: Consent) => {
    desired.current = value;
    setShown(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), manageTiming.consentDebounceMs);
  };

  // Leaving the screen mid-debounce still saves the last tap.
  useEffect(
    () => () => {
      if (!timer.current) return;
      clearTimeout(timer.current);
      void flush();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- unmount only; flush reads refs
    [],
  );

  const tap = () => {
    const next: Consent = shown === 'yes' ? 'no' : 'yes';
    if (next === 'no' && song.performed) {
      setAsking(true);
      return;
    }
    schedule(next);
  };

  /** "Nothing from tonight": the night-wide choice becomes no and every own per-song yes is cleared. */
  const nothingTonight = async () => {
    setAsking(false);
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    desired.current = 'no';
    setShown('no');
    inFlight.current = true;
    try {
      await updateMe(m.night.code, { photo_consent: 'no', night_id: m.night.nightId });
      const yeses = m.allSongs.filter((s) => showsConsent(s) && s.request.media_consent === 'yes');
      for (const s of yeses) await setSongConsent(m.night.code, s.request.id!, null, m.night.nightId);
      confirmed.current = 'no';
    } catch (e) {
      fail(e);
    } finally {
      inFlight.current = false;
      invalidate();
    }
  };

  const ok = shown === 'yes';
  return (
    <View className="gap-2">
      <Pressable
        testID={`tonight-song-consent-${key}`}
        accessibilityRole="switch"
        accessibilityState={{ checked: ok }}
        accessibilityLabel={ok ? t('yesLabel') : t('noLabel')}
        onPress={tap}
        className={`min-h-11 justify-center self-start rounded-md border px-3 ${ok ? 'border-success' : 'border-border'}`}
      >
        <Text className={ok ? 'font-semibold text-success' : 'font-semibold'}>{ok ? t('yes') : t('no')}</Text>
      </Pressable>
      {asking ? (
        <View testID={`tonight-consent-scope-${key}`} className="gap-2 rounded-lg border border-border p-3">
          <Text>{t('scopeQuestion')}</Text>
          <View className="flex-row flex-wrap gap-2">
            <Pressable
              testID={`tonight-consent-scope-one-${key}`}
              accessibilityRole="button"
              onPress={() => {
                setAsking(false);
                schedule('no');
              }}
              className="min-h-11 justify-center rounded-md border border-border px-3"
            >
              <Text className="font-semibold">{t('scopeOne')}</Text>
            </Pressable>
            <Pressable
              testID={`tonight-consent-scope-all-${key}`}
              accessibilityRole="button"
              onPress={() => void nothingTonight()}
              className="min-h-11 justify-center rounded-md border border-border px-3"
            >
              <Text className="font-semibold">{t('scopeAll')}</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}
