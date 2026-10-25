import { GENRE_IDS } from '@nomad/core';
import { isolate, useTranslations } from '@nomad/i18n';
import { Button, Screen, Text } from '@nomad/ui';
import { router, type Href } from 'expo-router';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { useAuth } from '../../auth/store';
import { ConnectedSources } from '../../discover/connect/ConnectedSources';
import { ArtistsYouLove } from '../../discover/profile/ArtistsYouLove';
import { ProfileSection } from '../../discover/profile/ProfileSection';
import { useAppleMusic } from '../../discover/profile/useAppleMusic';
import { useMusicProfile } from '../../discover/profile/useMusicProfile';
import { VoiceProfileSection } from '../../voice/VoiceProfileSection';
import { RecordingsSection } from '../../voiceSession/RecordingsSection';
import { useVoiceFlags } from '../../voiceSession/debug/useVoiceDebug';

/** decide's genre ids to their message keys (`classic-rock` is `classicRock`). */
const genreKey = (id: string) => id.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());
const KNOWN_GENRES: readonly string[] = GENRE_IDS;

function RemoveRow({ testID, label, onPress, text }: { testID: string; label: string; onPress: () => void; text: string }) {
  return (
    <View className="flex-row items-center justify-between gap-2">
      <Text className="flex-1">{text}</Text>
      <Button testID={testID} label={label} variant="secondary" onPress={onPress} />
    </View>
  );
}

/** Me -> "Your music profile" (spec §8.3): what decide knows about you, with each part editable or removable. */
export default function MusicProfileScreen() {
  const t = useTranslations('account');
  const tg = useTranslations('discover.filter.genre');
  const td = useTranslations('discover.filter.decade');
  const tq = useTranslations('quiz.energy');
  const tc = useTranslations('connect');
  const signedIn = useAuth((s) => s.state.status === 'signedIn');
  const p = useMusicProfile();
  const apple = useAppleMusic();
  const tvd = useTranslations('voiceSession.debug');
  const tvs = useTranslations('voiceSession');
  const voiceFlags = useVoiceFlags().data;
  const isAdmin = voiceFlags?.is_admin === true;

  if (!signedIn) {
    return (
      <Screen testID="profile-screen" scroll>
        <Text variant="muted">{t('musicProfileSignedOut')}</Text>
      </Screen>
    );
  }

  const prefs = p.prefs.data;
  const genres = prefs?.genres ?? [];
  const decades = prefs?.decades ?? [];
  const energy = prefs?.energy_preference ?? null;
  const loading = p.prefs.isPending || p.artists.isPending || p.loved.isPending || p.hidden.isPending;

  return (
    <Screen testID="profile-screen" scroll>
      <Text variant="muted">{t('musicProfileIntro')}</Text>
      {loading ? <ActivityIndicator testID="profile-loading" /> : null}
      {p.failed ? (
        <Text testID="profile-error" variant="error">
          {t('musicProfileEditFailed')}
        </Text>
      ) : null}

      {/* Phase 3c: the voice profile. */}
      <VoiceProfileSection />

      {voiceFlags?.session_enabled ? (
        <Button testID="vs-entry-me" label={tvs('entry')} onPress={() => router.push('/discover/voice-session' as Href)} />
      ) : null}

      {/* Deleting recordings stays available to every signed-in person, whatever the session flag says. */}
      <RecordingsSection />

      {/* Phase 3b: every connected or imported source, with a way to add more. */}
      <ProfileSection
        testID="profile-connected"
        title={tc('sources.title')}
        isEmpty={false}
        empty=""
        action={
          <Pressable
            testID="connect-add-more"
            accessibilityRole="button"
            onPress={() => router.push('/discover/connect' as Href)}
            className="min-h-11 justify-center"
          >
            <Text className="text-primary">{tc('sources.addMore')}</Text>
          </Pressable>
        }
      >
        <ConnectedSources onReconnectApple={() => void apple.connect()} />
      </ProfileSection>
      <ProfileSection testID="profile-services" title={t('musicServices')} isEmpty={false} empty="">
        <View className="gap-2">
          <Text className="font-semibold">{t('appleMusic')}</Text>
          {apple.loading ? <ActivityIndicator testID="profile-apple-loading" /> : null}
          {!apple.loading && apple.status === 'notConnected' ? (
            <>
              <Text variant="muted">{t('appleMusicPitch')}</Text>
              <Button
                testID="profile-apple-connect"
                label={t('appleMusicConnect')}
                onPress={() => void apple.connect()}
                loading={apple.busy}
              />
            </>
          ) : null}
          {apple.status === 'reading' ? (
            <View className="flex-row items-center gap-2">
              <ActivityIndicator />
              <Text testID="profile-apple-reading" className="flex-1">
                {t('appleMusicReading')}
              </Text>
            </View>
          ) : null}
          {apple.status === 'connected' ? (
            <Text testID="profile-apple-connected">{t('appleMusicConnected', { count: apple.songs })}</Text>
          ) : null}
          {apple.status === 'expired' ? (
            <>
              <Text testID="profile-apple-expired" variant="error">
                {t('appleMusicExpired')}
              </Text>
              <Button
                testID="profile-apple-reconnect"
                label={t('appleMusicReconnect')}
                onPress={() => void apple.connect()}
                loading={apple.busy}
              />
            </>
          ) : null}
          {apple.status === 'connected' || apple.status === 'reading' ? (
            <Button
              testID="profile-apple-disconnect"
              label={t('appleMusicDisconnect')}
              variant="secondary"
              onPress={() => void apple.disconnect()}
              loading={apple.busy}
            />
          ) : null}
          {apple.problem ? (
            <Text testID={`profile-apple-${apple.problem}`} variant="error">
              {t(
                apple.problem === 'denied'
                  ? 'appleMusicDenied'
                  : apple.problem === 'noSubscription'
                    ? 'appleMusicNoSubscription'
                    : 'appleMusicFailed',
              )}
            </Text>
          ) : null}
        </View>
      </ProfileSection>

      <ProfileSection
        testID="profile-artists"
        title={t('musicProfileArtists')}
        isEmpty={(p.artists.data?.artists.length ?? 0) === 0}
        empty={t('musicProfileArtistsEmpty')}
      >
        <ArtistsYouLove artists={p.artists.data?.artists ?? []} onRemove={p.removeArtist} />
      </ProfileSection>

      <ProfileSection
        testID="profile-loved"
        title={t('musicProfileLoved')}
        isEmpty={(p.loved.data?.length ?? 0) === 0}
        empty={t('musicProfileLovedEmpty')}
      >
        {p.loved.data?.map((s, i) => (
          <RemoveRow
            key={s.song_key}
            testID={`profile-loved-remove-${i}`}
            text={t('musicProfileSong', { artist: isolate(s.artist), title: isolate(s.title) })}
            label={t('musicProfileRemove')}
            onPress={() => p.unlove(s.song_key)}
          />
        ))}
      </ProfileSection>

      <ProfileSection
        testID="profile-quiz"
        title={t('musicProfileQuiz')}
        isEmpty={false}
        empty=""
      >
        <View className="gap-1">
          <Text variant="muted">{t('musicProfileGenres')}</Text>
          <Text testID="profile-genres">
            {genres.length
              ? genres.map((g) => (KNOWN_GENRES.includes(g) ? tg(genreKey(g)) : g)).join(', ')
              : t('musicProfileNone')}
          </Text>
          <Button
            testID="profile-edit-genres"
            label={t('musicProfileEditGenres')}
            variant="secondary"
            onPress={() => router.push('/discover/quiz?step=1&from=profile')}
          />
        </View>
        <View className="gap-1">
          <Text variant="muted">{t('musicProfileDecades')}</Text>
          <Text testID="profile-decades">
            {decades.length ? decades.map((d) => td(`d${d}`)).join(', ') : t('musicProfileNone')}
          </Text>
          <Text testID="profile-energy">
            {energy ? t('musicProfileEnergy', { energy: tq(energy) }) : t('musicProfileNoEnergy')}
          </Text>
          <Button
            testID="profile-edit-decades"
            label={t('musicProfileEditDecades')}
            variant="secondary"
            onPress={() => router.push('/discover/quiz?step=2&from=profile')}
          />
        </View>
      </ProfileSection>

      <ProfileSection
        testID="profile-hidden"
        title={t('musicProfileHidden')}
        isEmpty={(p.hidden.data?.length ?? 0) === 0}
        empty={t('musicProfileHiddenEmpty')}
      >
        {p.hidden.data?.map((s, i) => (
          <RemoveRow
            key={s.song_key}
            testID={`profile-hidden-unhide-${i}`}
            text={t('musicProfileSong', { artist: isolate(s.artist), title: isolate(s.title) })}
            label={t('musicProfileUnhide')}
            onPress={() => p.unhide(s.song_key)}
          />
        ))}
      </ProfileSection>

      {isAdmin ? (
        <Button
          testID="vs-debug-open"
          label={tvd('open')}
          variant="secondary"
          onPress={() => router.push('/me/voice-debug' as Href)}
        />
      ) : null}
    </Screen>
  );
}
