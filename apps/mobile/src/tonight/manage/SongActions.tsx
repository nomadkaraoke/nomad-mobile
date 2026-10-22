import { cancelRequest, KjboxError, type MeProfile, type Song } from '@nomad/api-kjbox';
import { isolate, useTranslations } from '@nomad/i18n';
import { Text } from '@nomad/ui';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import { useNightStore, type NomadNight } from '../nightStore';
import { isOnStage, songKey, songParts } from '../nomad/model';
import { nightKey } from '../nomad/queries';
import { errorCopy } from '../request/errorCopy';

/** Timings for managing songs (mutable so tests can shrink them). */
export const manageTiming = {
  /** Time-boxed notices ("Cancelled: X", "✓ New order saved"): a repaint would wipe an untimed one (A.45, A.53). */
  noticeMs: 15_000,
  /** Per-song consent taps settle this long before one PUT (A.95). */
  consentDebounceMs: 600,
};

export type ManageNotice = { text: string; tone: 'ok' | 'error' };

/** One notice line at a time, cleared after `manageTiming.noticeMs`. */
export function useNotice() {
  const [notice, setNotice] = useState<ManageNotice | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const show = useCallback((text: string, tone: ManageNotice['tone'] = 'ok') => {
    if (timer.current) clearTimeout(timer.current);
    setNotice({ text, tone });
    timer.current = setTimeout(() => setNotice(null), manageTiming.noticeMs);
  }, []);
  return { notice, show };
}

export function NoticeLine({ notice }: { notice: ManageNotice | null }) {
  if (!notice) return null;
  return (
    <View testID="tonight-notice" accessibilityLiveRegion="polite" className="rounded-lg border border-border bg-card p-3">
      <Text variant={notice.tone === 'error' ? 'error' : 'body'} className={notice.tone === 'ok' ? 'font-semibold text-success' : ''}>
        {notice.text}
      </Text>
    </View>
  );
}

/** What the song-management pieces inside the night screen share. */
export type ManageContextValue = {
  night: NomadNight;
  userKey: string | null;
  /** The box is unreachable or requests are paused: no changes. */
  readOnly: boolean;
  /** GET /night features.ask_photo_consent (A.92): the per-song toggle shows only then. */
  askConsent: boolean;
  /** The night-wide choice from /me (unknown = no, A.91). */
  profile: MeProfile | null;
  /** Every Your-songs and sung-tonight row (the consent "Nothing from tonight" scope clears own per-song yeses). */
  allSongs: Song[];
  notify: (text: string, tone?: ManageNotice['tone']) => void;
};

const ManageContext = createContext<ManageContextValue | null>(null);
export const ManageProvider = ManageContext.Provider;
/** Null outside a night screen (e.g. a row rendered on its own): no consent toggle then. */
export const useManage = () => useContext(ManageContext);

/** Invalidates (never patches) every query of this night: the next /me read is the truth (A.85). */
export function useInvalidateNight(night: NomadNight, userKey: string | null) {
  const queryClient = useQueryClient();
  return useCallback(() => void queryClient.invalidateQueries({ queryKey: nightKey(night, userKey) }), [queryClient, night, userKey]);
}

/**
 * Cancel (spec §4.1, A.53, A.56, ruling E6-R2): instant. The row hides at once and a 15 s "Cancelled: X" notice
 * shows; a failure brings the row back with the error's copy. 409 already_sung refreshes (the song moved to sung);
 * night_changed ends the night. Never offered on stage (SongRow hides it), and the box refuses it too (on_stage).
 */
export function useCancelSong(night: NomadNight, userKey: string | null, notify: ManageContextValue['notify']) {
  const t = useTranslations('tonight.manage');
  const tAll = useTranslations();
  const invalidate = useInvalidateNight(night, userKey);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const busy = useRef(new Set<number>());

  const cancel = useCallback(
    async (song: Song) => {
      const id = song.request.id;
      if (id == null || isOnStage(song) || busy.current.has(id)) return;
      busy.current.add(id);
      const key = songKey(song);
      setHidden((h) => new Set(h).add(key));
      try {
        await cancelRequest(night.code, id, night.nightId);
        notify(t('cancelled', { title: isolate(songParts(song.request).title) }));
      } catch (e) {
        setHidden((h) => {
          const next = new Set(h);
          next.delete(key);
          return next;
        });
        if (e instanceof KjboxError && e.code === 'night_changed') {
          useNightStore.getState().end();
          return;
        }
        const c = errorCopy(e);
        notify(tAll(c.key, c.values), 'error');
      } finally {
        busy.current.delete(id);
        invalidate();
      }
    },
    [night, notify, t, tAll, invalidate],
  );
  return { hidden, cancel };
}
