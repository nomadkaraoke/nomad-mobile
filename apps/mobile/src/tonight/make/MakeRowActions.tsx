import { KjboxError, useQuick as postUseQuick, type Song } from '@nomad/api-kjbox';
import { isolate, useTranslations } from '@nomad/i18n';
import { Button, Text } from '@nomad/ui';
import { router } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { View } from 'react-native';

import type { ManageContextValue } from '../manage/SongActions';
import { useInvalidateNight } from '../manage/SongActions';
import { useNightStore, type NomadNight } from '../nightStore';
import { isOnStage, isOwnRequest, songParts } from '../nomad/model';
import { errorCopy } from '../request/errorCopy';
import { TonightSheet } from '../TonightSheet';

/**
 * A make-it row's own actions (spec §4.1 Make-its, A.70, A.75):
 * - "Review it now" opens the app's native review (`/review/[jobId]`): the job is in the singer's own gen account
 *   (`gen_job_id`, owner me or friend). Before gen has the job there is nothing to open, so it says so.
 * - "⚡ Sing it now" asks first, then POST /make/use-quick. Only on the account's own (or friend's) request and never
 *   on stage (SongRow hides it then; the box refuses with on_stage/not_owner too, and that copy shows).
 */
export function useMakeRowActions(night: NomadNight, userKey: string | null, notify: ManageContextValue['notify']) {
  const t = useTranslations('tonight.manage.quick');
  const tAll = useTranslations();
  const invalidate = useInvalidateNight(night, userKey);
  const [asking, setAsking] = useState<Song | null>(null);
  const busy = useRef(false);

  const onReview = useCallback(
    (song: Song) => {
      const jobId = song.gen_job_id;
      if (!jobId) {
        notify(t('reviewNotReady', { title: isolate(songParts(song.request).title) }));
        return;
      }
      router.push({ pathname: '/review/[id]', params: { id: jobId } });
    },
    [notify, t],
  );

  const onSingQuick = useCallback((song: Song) => {
    if (!isOwnRequest(song) || isOnStage(song)) return;
    setAsking(song);
  }, []);

  const confirm = async () => {
    const song = asking;
    setAsking(null);
    const id = song?.request.id;
    if (!song || id == null || busy.current) return;
    busy.current = true;
    try {
      await postUseQuick(night.code, id, night.nightId);
      notify(t('chosen', { title: isolate(songParts(song.request).title) }));
    } catch (e) {
      if (e instanceof KjboxError && e.code === 'night_changed') {
        useNightStore.getState().end();
        return;
      }
      const c = errorCopy(e);
      notify(tAll(c.key, c.values), 'error');
    } finally {
      busy.current = false;
      invalidate();
    }
  };

  const sheet = (
    <TonightSheet
      visible={asking !== null}
      onClose={() => setAsking(null)}
      testID="tonight-quick-confirm"
      title={t('confirmTitle')}
      closeLabel={tAll('tonight.manage.close')}
    >
      <View className="gap-3 pt-2">
        <Text>{t('confirmBody')}</Text>
        <Button testID="tonight-quick-confirm-yes" label={t('yes')} onPress={() => void confirm()} />
        <Button testID="tonight-quick-confirm-no" variant="secondary" label={t('no')} onPress={() => setAsking(null)} />
      </View>
    </TonightSheet>
  );

  return { onReview, onSingQuick, sheet };
}
