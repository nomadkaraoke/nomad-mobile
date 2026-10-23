import { useTranslations } from '@nomad/i18n';
import { Text } from '@nomad/ui';
import { router, type Href } from 'expo-router';
import { Pressable, View } from 'react-native';

import { useServicesSummary } from '../connect/queries';
import { useVoiceStore } from '../../voice/voiceStore';
import { useVoiceFlags } from '../../voiceSession/debug/useVoiceDebug';

/** Last on the picks list. 3b and 3c add their own rows here (connect services, vocal range). */
export function ImproveCard({ onAddArtists }: { onAddArtists: () => void }) {
  const t = useTranslations('discover');
  const tc = useTranslations('connect.improve');
  // 3b: ListenBrainz with no new listens for 30 days nudges toward connecting Spotify to it.
  const stale = useServicesSummary().data?.sources.some((s) => s.status === 'stale') ?? false;
  const tf = useTranslations('fit');
  const tvs = useTranslations('voiceSession');
  const hasVoice = useVoiceStore((s) => s.profile !== null);
  const sessionEnabled = useVoiceFlags().data?.session_enabled === true;
  return (
    <View testID="discover-improve-card" className="my-4 gap-2 rounded-xl border border-border bg-card p-3">
      <Text className="font-semibold">{t('improveTitle')}</Text>
      <Pressable
        testID="discover-improve-artists"
        accessibilityRole="button"
        onPress={onAddArtists}
        className="min-h-11 justify-center"
      >
        <Text className="text-primary">{t('improveArtists')}</Text>
      </Pressable>
      <Pressable
        testID="discover-improve-connect"
        accessibilityRole="button"
        onPress={() => router.push('/discover/connect' as Href)}
        className="min-h-11 justify-center"
      >
        <Text className="text-primary">{tc('connect')}</Text>
      </Pressable>
      {stale ? (
        <Pressable
          testID="discover-improve-stale"
          accessibilityRole="button"
          onPress={() => router.push('/discover/connect/listenbrainz' as Href)}
          className="min-h-11 justify-center"
        >
          <Text variant="muted">{tc('stale')}</Text>
        </Pressable>
      ) : null}
      {hasVoice ? null : (
        <Pressable
          testID="discover-improve-voice"
          accessibilityRole="button"
          onPress={() => router.push('/discover/voice' as Href)}
          className="min-h-11 justify-center"
        >
          <Text className="text-primary">{tf('improveVoice')}</Text>
        </Pressable>
      )}
      {sessionEnabled ? (
        <Pressable
          testID="vs-entry-discover"
          accessibilityRole="button"
          onPress={() => router.push('/discover/voice-session' as Href)}
          className="min-h-11 justify-center"
        >
          <Text className="text-primary">{tvs('entry')}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
