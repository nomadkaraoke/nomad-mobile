// Me → Your music profile → "Your voice" (Phase 3c): the range on a keyboard, the hedged voice type, how it was
// measured, Redo and Remove (DELETE on decide, then the phone's copy and the voice filters go too).
import { deleteVoiceProfile } from '@nomad/api-decide';
import { useTranslations } from '@nomad/i18n';
import { Button, colors, PianoStrip, StartText, Text } from '@nomad/ui';
import { useQueryClient } from '@tanstack/react-query';
import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { Alert, View } from 'react-native';

import { ProfileSection } from '../discover/profile/ProfileSection';
import { useRecFilters } from '../discover/filtersStore';
import { RECS_KEY } from '../discover/useRecommendations';
import { useVoiceProfile, VOICE_KEY, waitForVoiceSend } from './useVoiceProfile';
import { noteRange, useVoiceLabels } from './voiceLabels';
import { stripBounds } from './VoiceResult';
import { useVoiceStore } from './voiceStore';

const openVoiceTest = () => router.push('/discover/voice' as Href);

/** Removes the profile from decide, then from the phone. Resolves false (and keeps everything) when decide refuses. */
export function useRemoveVoiceProfile() {
  const queryClient = useQueryClient();
  return async (): Promise<boolean> => {
    // A profile still waiting to upload (an earlier PUT failed) stops being pending first: a flush started while
    // the DELETE runs (foreground, reconnect, Discover mount) must not PUT it after the DELETE and bring it back.
    const { profile, pending } = useVoiceStore.getState();
    const unsent = pending && profile ? profile : null;
    if (unsent) useVoiceStore.getState().markSynced(unsent.measuredAt);
    try {
      // A PUT still in flight would otherwise land after the DELETE and bring the profile back.
      await waitForVoiceSend();
      await deleteVoiceProfile();
    } catch {
      // Kept on the phone: the unsent profile goes back to waiting for its upload.
      if (unsent && useVoiceStore.getState().profile?.measuredAt === unsent.measuredAt) useVoiceStore.getState().save(unsent);
      return false;
    }
    useVoiceStore.getState().clear();
    const { filters, set } = useRecFilters.getState();
    if (filters.singable || filters.sort === 'fit') set({ singable: false, ...(filters.sort === 'fit' ? { sort: 'best' } : {}) });
    queryClient.setQueriesData({ queryKey: VOICE_KEY }, null);
    void queryClient.invalidateQueries({ queryKey: RECS_KEY });
    return true;
  };
}

export function VoiceProfileSection() {
  const t = useTranslations('fit');
  const tv = useTranslations('voice');
  const tc = useTranslations('common');
  const labels = useVoiceLabels();
  // Reconciled with decide's copy (a profile saved on another phone shows here too).
  const { profile } = useVoiceProfile();
  const remove = useRemoveVoiceProfile();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  // No modal is open on this screen, so the Alert can be raised straight away (see the iOS Modal gotcha).
  const confirmRemove = () =>
    Alert.alert(t('profileRemoveTitle'), t('profileRemoveBody'), [
      { text: tc('cancel'), style: 'cancel' },
      { text: t('profileRemoveConfirm'), style: 'destructive', onPress: () => void onRemove() },
    ]);

  const onRemove = async () => {
    setBusy(true);
    setFailed(false);
    const ok = await remove();
    setBusy(false);
    setFailed(!ok);
  };

  if (!profile) {
    return (
      <ProfileSection testID="voice-section" title={t('profileTitle')} isEmpty={false} empty="">
        <Text variant="muted">{t('profileEmpty')}</Text>
        <Button testID="voice-test" label={t('profileTest')} onPress={openVoiceTest} />
      </ProfileSection>
    );
  }

  const [lo, hi] = stripBounds(profile.lowMidi, profile.highMidi);
  const marks = [];
  for (let m = profile.lowMidi; m <= profile.highMidi; m++) {
    marks.push({ midi: m, color: m >= profile.comfortLow && m <= profile.comfortHigh ? colors.gold : colors.primary });
  }
  return (
    <ProfileSection testID="voice-section" title={t('profileTitle')} isEmpty={false} empty="">
      <Text testID="voice-section-type" className="text-lg font-bold">
        {labels.likely(profile)}
      </Text>
      <StartText testID="voice-section-range" className="font-semibold text-primary">
        {t('profileRange', { range: noteRange(profile.lowMidi, profile.highMidi) })}
      </StartText>
      <PianoStrip
        testID="voice-section-keys"
        lowMidi={lo}
        highMidi={hi}
        height={48}
        marks={marks}
        accessibilityLabel={t('profileKeysLabel')}
      />
      <StartText className="text-gold">{tv('comfort', { range: noteRange(profile.comfortLow, profile.comfortHigh) })}</StartText>
      <Text testID="voice-section-method" variant="muted">
        {profile.method === 'mic'
          ? t('profileMethodMic')
          : profile.method === 'session'
            ? t('profileMethodSession')
            : t('profileMethodSelf')}
      </Text>
      {failed ? (
        <Text testID="voice-remove-error" variant="error">
          {t('profileRemoveFailed')}
        </Text>
      ) : null}
      <View className="gap-2">
        <Button testID="voice-redo" label={t('profileRedo')} variant="secondary" onPress={openVoiceTest} />
        <Button testID="voice-remove" label={t('profileRemove')} variant="secondary" onPress={confirmRemove} loading={busy} />
      </View>
    </ProfileSection>
  );
}
