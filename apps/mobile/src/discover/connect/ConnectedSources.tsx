import { removeSourceData, type SourceSummary } from '@nomad/api-decide';
import { isolate, useTranslations } from '@nomad/i18n';
import { Button, Text } from '@nomad/ui';
import { useQueryClient } from '@tanstack/react-query';
import { router, type Href } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, View } from 'react-native';

import { useOffline } from '../../net/useOffline';
import { SERVICES_KEY } from '../profile/useAppleMusic';
import { useInvalidateAfterImport, useServicesSummary } from './queries';

/** decide's source ids to their message keys under `connect.source`. */
const SOURCE_NAME = {
  spotify: 'spotify',
  lastfm: 'lastfm',
  listenbrainz: 'listenbrainz',
  apple_music: 'appleMusic',
  youtube_music: 'youtubeMusic',
  screenshot: 'screenshot',
  spotify_playlist: 'spotifyPlaylist',
  spotify_export: 'spotifyExport',
  apple_export: 'appleExport',
} as const;

const STATUS: Record<string, 'ok' | 'needsReconnect' | 'importing' | 'stale' | 'error'> = {
  ok: 'ok',
  needs_reconnect: 'needsReconnect',
  importing: 'importing',
  stale: 'stale',
  error: 'error',
};

/** Where ListenBrainz connects to Spotify, so new listens keep arriving (the stale nudge). */
export const LB_MUSIC_SERVICES_URL = 'https://listenbrainz.org/settings/music-services/details/';
const DAY_MS = 24 * 60 * 60 * 1000;

/** A source's display name ("Last.fm", "Spotify history"); an unknown id shows as-is. */
export function useSourceName(): (source: string) => string {
  const t = useTranslations('connect.source');
  return (source) => (source in SOURCE_NAME ? t(SOURCE_NAME[source as keyof typeof SOURCE_NAME]) : isolate(source));
}

/** A reconnect goes to that service's own Connect screen; the rest (Spotify, Apple Music) start from the hub. */
function reconnectHref(source: string): Href {
  if (source === 'listenbrainz') return '/discover/connect/listenbrainz' as Href;
  if (source === 'lastfm') return '/discover/connect/lastfm' as Href;
  return '/discover/connect' as Href;
}

const daysSince = (iso: string) => Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / DAY_MS));

/**
 * Every connected or imported source (decide's services summary) with its status, counts and last import, and
 * Remove (confirm first) / Reconnect / the ListenBrainz stale nudge. On Me -> Your music profile, under "Connected".
 * Apple Music reconnects in place through `onReconnectApple` (the screen's `useAppleMusic().connect`).
 */
export function ConnectedSources({ onReconnectApple }: { onReconnectApple?: () => void }) {
  const t = useTranslations('connect');
  const summary = useServicesSummary();
  const offline = useOffline();
  const sourceName = useSourceName();
  const invalidate = useInvalidateAfterImport();
  const queryClient = useQueryClient();
  const [removing, setRemoving] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const remove = async (source: string) => {
    setRemoving(source);
    setFailed(false);
    try {
      await removeSourceData(source);
      invalidate();
      // Apple Music's own section on the profile reads decide's services list.
      void queryClient.invalidateQueries({ queryKey: SERVICES_KEY });
    } catch {
      setFailed(true);
    } finally {
      setRemoving(null);
    }
  };

  const confirmRemove = (source: string) => {
    const name = sourceName(source);
    Alert.alert(t('sources.removeTitle', { name }), t('sources.removeBody', { name }), [
      { text: t('sources.cancel'), style: 'cancel' },
      { text: t('sources.remove'), style: 'destructive', onPress: () => void remove(source) },
    ]);
  };

  const reconnect = (source: string) => {
    if (source === 'apple_music' && onReconnectApple) onReconnectApple();
    else router.push(reconnectHref(source));
  };

  if (summary.isPending) {
    // Offline with nothing cached, the request waits for a connection: say so instead of spinning.
    return offline ? (
      <Text testID="connected-offline" variant="muted">
        {t('offline')}
      </Text>
    ) : (
      <ActivityIndicator testID="connected-loading" />
    );
  }
  if (summary.isError && !summary.data) {
    return (
      <Text testID="connected-load-error" variant="error">
        {t('sources.loadFailed')}
      </Text>
    );
  }
  const sources = summary.data?.sources ?? [];

  return (
    <View testID="connected-sources" className="gap-3">
      {offline ? (
        <Text testID="connected-offline" variant="muted">
          {t('offline')}
        </Text>
      ) : null}
      {failed ? (
        <Text testID="connected-error" variant="error">
          {t('sources.removeFailed')}
        </Text>
      ) : null}
      {sources.length === 0 ? (
        <Text testID="connected-empty" variant="muted">
          {t('sources.empty')}
        </Text>
      ) : null}
      {sources.map((s) => (
        <SourceRow
          key={s.source}
          source={s}
          name={sourceName(s.source)}
          offline={offline}
          removing={removing === s.source}
          onRemove={() => confirmRemove(s.source)}
          onReconnect={() => reconnect(s.source)}
        />
      ))}
    </View>
  );
}

function SourceRow({
  source: s,
  name,
  offline,
  removing,
  onRemove,
  onReconnect,
}: {
  source: SourceSummary;
  name: string;
  offline: boolean;
  removing: boolean;
  onRemove: () => void;
  onReconnect: () => void;
}) {
  const t = useTranslations('connect.sources');
  const status = s.status ?? 'ok';
  // A status this build doesn't know yet reads as the neutral one.
  const statusKey = STATUS[status] ?? 'ok';
  return (
    <View testID={`connected-row-${s.source}`} className="gap-1 border-b border-border pb-3">
      <View className="flex-row items-center gap-2">
        <Text className="flex-1 font-semibold">{name}</Text>
        <View
          testID={`connected-status-${s.source}`}
          className={`rounded-full border px-2 py-0.5 ${statusKey === 'ok' ? 'border-border' : 'border-primary'}`}
        >
          <Text className={`text-xs ${statusKey === 'ok' ? 'text-muted' : 'text-primary'}`}>{t(`status.${statusKey}`)}</Text>
        </View>
      </View>
      <Text testID={`connected-counts-${s.source}`} variant="muted">
        {t('counts', { artists: s.artists ?? 0, songs: s.songs ?? 0 })}
      </Text>
      {s.last_import_at ? <Text variant="muted">{t('lastImport', { days: daysSince(s.last_import_at) })}</Text> : null}
      {status === 'stale' ? (
        <Pressable
          testID={`connected-stale-${s.source}`}
          accessibilityRole="link"
          onPress={() => void WebBrowser.openBrowserAsync(LB_MUSIC_SERVICES_URL)}
          className="min-h-11 justify-center"
        >
          <Text className="text-primary">{t('stale')}</Text>
        </Pressable>
      ) : null}
      <View className="flex-row gap-2">
        {status === 'needs_reconnect' ? (
          <View className="flex-1">
            <Button
              testID={`connected-reconnect-${s.source}`}
              label={t('reconnect')}
              disabled={offline}
              onPress={onReconnect}
            />
          </View>
        ) : null}
        <View className="flex-1">
          <Button
            testID={`connected-remove-${s.source}`}
            label={t('remove')}
            variant="secondary"
            disabled={offline}
            loading={removing}
            onPress={onRemove}
          />
        </View>
      </View>
    </View>
  );
}
