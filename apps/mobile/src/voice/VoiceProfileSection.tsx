// Me → Your music profile → "Your voice" (Phase 3c; tuning batch 1 §10c): the saved profile's range on a keyboard,
// the hedged voice type, how it was measured, Redo and Remove (DELETE on decide, then the phone's copy and the voice
// filters go too); below it the mic test result and the latest voice session result side by side, "Used for song
// fit" on the one behind the saved profile, and "Use this as my voice" for a session result that isn't it.
import { adoptVoiceSession, deleteVoiceProfile, type SessionResultSummaryOut, type VoiceProfiles } from '@nomad/api-decide';
import { useTranslations } from '@nomad/i18n';
import { Button, colors, PianoStrip, StartText, Text } from '@nomad/ui';
import { useQueryClient } from '@tanstack/react-query';
import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { Alert, View } from 'react-native';

import { ProfileSection } from '../discover/profile/ProfileSection';
import { RECS_KEY } from '../discover/useRecommendations';
import { useVoiceFlags } from '../voiceSession/debug/useVoiceDebug';
import { clearVoiceFilters, followServerVoice, fromServer, useVoiceProfile, VOICE_KEY, waitForVoiceSend } from './useVoiceProfile';
import { noteRange, useVoiceLabels } from './voiceLabels';
import { stripBounds } from './VoiceResult';
import { VoiceResultCard } from './VoiceResultCard';
import { useVoiceStore, type LocalVoiceProfile } from './voiceStore';

const CONFIDENCE_KEY = { high: 'confidenceHigh', medium: 'confidenceMedium', low: 'confidenceLow' } as const;

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
    clearVoiceFilters();
    // decide's DELETE clears the profile and the mic copy; sessions (and so the latest session result) stay.
    queryClient.setQueriesData<VoiceProfiles>({ queryKey: VOICE_KEY }, (v) => (v ? { ...v, profile: null, mic: null } : v));
    void queryClient.invalidateQueries({ queryKey: VOICE_KEY });
    void queryClient.invalidateQueries({ queryKey: RECS_KEY });
    return true;
  };
}

/** The mic test and latest session cards (none when decide has neither). */
function VoiceResults({ profile, mic, latest }: { profile: LocalVoiceProfile | null; mic: LocalVoiceProfile | null; latest: SessionResultSummaryOut | null }) {
  const t = useTranslations('fit');
  const tv = useTranslations('voice');
  const tr = useTranslations('voiceSession.result');
  const labels = useVoiceLabels();
  const queryClient = useQueryClient();
  // Adopting needs decide's voice session on (decide gates it like the session itself).
  const sessionEnabled = useVoiceFlags().data?.session_enabled === true;
  const [adopting, setAdopting] = useState(false);
  const [adoptFailed, setAdoptFailed] = useState(false);
  if (!mic && !latest) return null;

  const sessionActive =
    !!latest && profile?.method === 'session' && (profile.sessionId == null || profile.sessionId === latest.session_id);

  const onAdopt = async (sessionId: string) => {
    setAdopting(true);
    setAdoptFailed(false);
    try {
      // The phone follows at once (badges and the song page use its copy), then decide is read again.
      followServerVoice(await adoptVoiceSession(sessionId));
      void queryClient.invalidateQueries({ queryKey: VOICE_KEY });
      void queryClient.invalidateQueries({ queryKey: RECS_KEY });
    } catch {
      setAdoptFailed(true);
    } finally {
      setAdopting(false);
    }
  };

  return (
    <View className="gap-2">
      {mic ? (
        <VoiceResultCard
          testID="voice-card-mic"
          title={t('profileCardMic')}
          type={labels.likely(mic)}
          lines={[
            t('profileRange', { range: noteRange(mic.lowMidi, mic.highMidi) }),
            tv('comfort', { range: noteRange(mic.comfortLow, mic.comfortHigh) }),
          ]}
          at={mic.measuredAt}
          active={profile?.method === 'mic'}
        />
      ) : null}
      {latest ? (
        <VoiceResultCard
          testID="voice-card-session"
          title={t('profileCardSession')}
          type={labels.session(latest)}
          lines={[
            tr(CONFIDENCE_KEY[latest.confidence_label]),
            tv('comfort', { range: noteRange(latest.comfort_low, latest.comfort_high) }),
            t('profileCardSongs', { n: latest.evidence_attempts }),
          ]}
          at={latest.computed_at}
          active={sessionActive}
        >
          {!sessionActive ? (
            <View className="gap-2 pt-1">
              {!latest.profile_saved ? (
                <Text testID="voice-session-unsaved" className="text-gold">
                  {t('profileUnsaved')}
                </Text>
              ) : null}
              {adoptFailed ? (
                <Text testID="voice-session-adopt-error" variant="error">
                  {t('profileAdoptFailed')}
                </Text>
              ) : null}
              {sessionEnabled ? (
                <Button
                  testID="voice-session-adopt"
                  label={t('profileAdopt')}
                  variant="secondary"
                  loading={adopting}
                  onPress={() => void onAdopt(latest.session_id)}
                />
              ) : null}
            </View>
          ) : null}
        </VoiceResultCard>
      ) : null}
    </View>
  );
}

export function VoiceProfileSection() {
  const t = useTranslations('fit');
  const tv = useTranslations('voice');
  const tc = useTranslations('common');
  const labels = useVoiceLabels();
  // Reconciled with decide's copy (a profile saved on another phone shows here too).
  const { profile, mic: serverMic, latestSession } = useVoiceProfile();
  // decide keeps the last mic result beside the profile; an older decide (or a profile from before v0.31) has no
  // copy, so a saved mic profile is its own mic card.
  const mic = serverMic ? fromServer(serverMic) : profile?.method === 'mic' ? profile : null;
  const results = <VoiceResults profile={profile} mic={mic} latest={latestSession} />;
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
        {results}
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
            ? profile.evidenceCount != null
              ? t('profileMethodSession', { n: profile.evidenceCount })
              : t('profileMethodSessionPlain')
            : t('profileMethodSelf')}
      </Text>
      {results}
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
