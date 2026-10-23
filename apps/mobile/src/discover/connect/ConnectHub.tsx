import type { SourceSummary } from '@nomad/api-decide';
import { useTranslations } from '@nomad/i18n';
import { Screen, Text } from '@nomad/ui';
import { router, type Href } from 'expo-router';
import { Pressable } from 'react-native';

import { useOffline } from '../../net/useOffline';
import { useAppleMusic } from '../profile/useAppleMusic';
import { ConnectCard } from './ConnectCard';
import { useCapabilities, useServicesSummary } from './queries';

export type ConnectCardId = 'screenshot' | 'playlist' | 'spotify-export' | 'listenbrainz' | 'lastfm' | 'apple';

/** Each routed card: its message key under `connect.cards`, its screen, and the decide sources it feeds. */
const ROUTED: readonly { id: Exclude<ConnectCardId, 'apple'>; key: string; href: string; sources: readonly string[] }[] = [
  { id: 'screenshot', key: 'screenshot', href: '/discover/connect/screenshot', sources: ['screenshot'] },
  { id: 'playlist', key: 'playlist', href: '/discover/connect/playlist', sources: ['spotify_playlist', 'youtube_music'] },
  { id: 'spotify-export', key: 'spotifyExport', href: '/discover/connect/spotify-export', sources: ['spotify_export'] },
  { id: 'listenbrainz', key: 'listenbrainz', href: '/discover/connect/listenbrainz', sources: ['listenbrainz'] },
  { id: 'lastfm', key: 'lastfm', href: '/discover/connect/lastfm', sources: ['lastfm'] },
];

/** A source counts as connected once decide has a connection for it or it has added something. */
const hasData = (s: SourceSummary) => s.connected || (s.artists ?? 0) > 0 || (s.songs ?? 0) > 0;

/**
 * "Connect your music" (spec §5.1): every way to feed decide your real taste, with honest "what you get · how
 * long" lines. Screenshot import hides itself while decide can't do it. Apple Music connects through MusicKit
 * right here; people without a subscription get a link to the privacy-export import. Offline, the cards stay
 * (their screens explain what needs a connection) and Apple Music's connect waits.
 */
export function ConnectHub() {
  const t = useTranslations('connect');
  const ta = useTranslations('account');
  const offline = useOffline();
  const capabilities = useCapabilities();
  const summary = useServicesSummary();
  const apple = useAppleMusic();

  const connectedSources = new Set((summary.data?.sources ?? []).filter(hasData).map((s) => s.source));
  // Hidden until decide says it can (also while asking), so the card never appears and then vanishes.
  const screenshotOn = capabilities.data?.screenshot_import === true;
  // decide can flag Apple Music for reconnecting (an expired token) before the services list says error.
  const appleNeedsReconnect = (summary.data?.sources ?? []).some(
    (s) => s.source === 'apple_music' && s.status === 'needs_reconnect',
  );
  const appleConnected = !appleNeedsReconnect && (apple.status === 'connected' || apple.status === 'reading');

  return (
    <Screen testID="connect-hub" scroll underHeader>
      <Text variant="muted">{t('intro')}</Text>
      {offline ? (
        <Text testID="connect-offline" variant="error" accessibilityLiveRegion="polite">
          {t('offline')}
        </Text>
      ) : null}
      {ROUTED.filter((c) => c.id !== 'screenshot' || screenshotOn).map((c) => (
        <ConnectCard
          key={c.id}
          testID={`connect-card-${c.id}`}
          title={t(`cards.${c.key}.title`)}
          detail={t(`cards.${c.key}.detail`)}
          connectedLabel={c.sources.some((s) => connectedSources.has(s)) ? t('connected') : null}
          onPress={() => router.push(c.href as Href)}
        />
      ))}
      <ConnectCard
        testID="connect-card-apple"
        title={t('cards.apple.title')}
        detail={t('cards.apple.detail')}
        connectedLabel={appleConnected ? t('connected') : null}
        busy={apple.busy}
        disabled={offline || appleConnected}
        onPress={() => void apple.connect()}
      >
        {apple.status === 'reading' ? (
          <Text testID="connect-apple-reading" variant="muted">
            {t('appleReading')}
          </Text>
        ) : null}
        {apple.problem ? (
          <Text testID={`connect-apple-${apple.problem}`} variant="error">
            {ta(
              apple.problem === 'denied'
                ? 'appleMusicDenied'
                : apple.problem === 'noSubscription'
                  ? 'appleMusicNoSubscription'
                  : 'appleMusicFailed',
            )}
          </Text>
        ) : null}
        <Pressable
          testID="connect-apple-export"
          accessibilityRole="link"
          onPress={() => router.push('/discover/connect/apple' as Href)}
          className="min-h-11 justify-center"
        >
          <Text className="text-primary">{t('appleExport')}</Text>
        </Pressable>
      </ConnectCard>
    </Screen>
  );
}
