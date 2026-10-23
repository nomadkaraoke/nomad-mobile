import { connectListenBrainz } from '@nomad/api-decide';
import { isolate, useTranslations } from '@nomad/i18n';
import { Button, Screen, Text } from '@nomad/ui';
import { useQueryClient } from '@tanstack/react-query';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useRef } from 'react';
import { Pressable, View } from 'react-native';

import { useOffline } from '../../net/useOffline';
import { SERVICES_SUMMARY_KEY, useCapabilities, useServicesSummary } from './queries';
import type { LbReturn } from './lbReturn';
import { useListenBrainzOAuth } from './useListenBrainzOAuth';
import { useSyncWait } from './useSyncWait';
import { SyncStatus, UsernameConnect } from './UsernameConnect';

const LB_SIGNUP = 'https://listenbrainz.org/login/';
const LB_SPOTIFY = 'https://listenbrainz.org/settings/music-services/details/';
const CHECKLIST = ['step1', 'step2', 'step3'] as const;

/**
 * ListenBrainz (spec §5.5): one-tap "Sign in with ListenBrainz" (MetaBrainz OAuth, while decide can), or a
 * username. Either way a sync starts and the screen waits for what it added. The linked account's name is shown
 * prominently, so a connection to someone else's account (a forged callback) is obvious. `oauthReturn` is the
 * (already sanitised) result of an OAuth return that cold-started the app (+native-intent passes it in the route);
 * a `connected` one only counts once the summary confirms it.
 */
export function ListenBrainzConnect({ oauthReturn }: { oauthReturn?: LbReturn | null }) {
  const t = useTranslations('connect');
  const tAll = useTranslations();
  const offline = useOffline();
  const queryClient = useQueryClient();
  const capabilities = useCapabilities();
  const summary = useServicesSummary();
  const sync = useSyncWait('listenbrainz');
  const oauth = useListenBrainzOAuth({ onConnected: () => void sync.start() });

  const applied = useRef(false);
  const { applyResult } = oauth;
  useEffect(() => {
    if (applied.current || !oauthReturn) return;
    applied.current = true;
    void applyResult(oauthReturn);
  }, [oauthReturn, applyResult]);

  const onUsernameConnected = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: SERVICES_SUMMARY_KEY });
    void sync.start();
  }, [queryClient, sync]);

  const account = summary.data?.sources.find((s) => s.source === 'listenbrainz' && s.connected && s.username);
  const oauthOn = capabilities.data?.listenbrainz_oauth === true;
  const working = sync.phase === 'syncing' || oauth.phase === 'opening';

  return (
    <Screen testID="connect-listenbrainz" scroll underHeader>
      <Text variant="muted">{t('lb.intro')}</Text>
      {offline ? (
        <Text testID="connect-offline" variant="error" accessibilityLiveRegion="polite">
          {t('offline')}
        </Text>
      ) : null}
      {account?.username ? (
        <View testID="connect-lb-account" className="gap-1 rounded-xl border border-border bg-card p-4">
          <Text className="text-lg font-semibold">{t('lb.account', { username: isolate(account.username) })}</Text>
          <Text variant="muted">{t('lb.accountHint')}</Text>
        </View>
      ) : null}
      <SyncStatus phase={sync.phase} counts={sync.counts} />
      {oauthOn ? (
        <Button
          testID="connect-lb-oauth"
          label={t('lb.oauth')}
          onPress={() => void oauth.start()}
          disabled={offline || working}
          loading={oauth.phase === 'opening'}
        />
      ) : null}
      {oauth.errorKey ? (
        <Text testID="connect-lb-oauth-error" variant="error" accessibilityLiveRegion="polite">
          {tAll(oauth.errorKey)}
        </Text>
      ) : null}
      {oauthOn ? <Text variant="muted">{t('lb.or')}</Text> : null}
      <UsernameConnect
        service="listenbrainz"
        label={t('lb.username')}
        submitLabel={t('lb.submit')}
        connect={connectListenBrainz}
        onConnected={onUsernameConnected}
        disabled={offline || working}
      />
      <Pressable
        testID="connect-lb-signup"
        accessibilityRole="link"
        onPress={() => void WebBrowser.openBrowserAsync(LB_SIGNUP)}
        className="min-h-11 justify-center"
      >
        <Text className="font-semibold text-primary">{t('lb.signup')}</Text>
      </Pressable>
      <View className="gap-1">
        {CHECKLIST.map((s, i) => (
          <Text key={s} variant="muted">
            {`${i + 1}. ${t(`lb.checklist.${s}`)}`}
          </Text>
        ))}
      </View>
      <Pressable
        testID="connect-lb-spotify-guide"
        accessibilityRole="link"
        onPress={() => void WebBrowser.openBrowserAsync(LB_SPOTIFY)}
        className="min-h-11 justify-center"
      >
        <Text className="font-semibold text-primary">{t('lb.spotifyGuide')}</Text>
        <Text variant="muted">{t('lb.spotifyGuideBody')}</Text>
      </Pressable>
    </Screen>
  );
}
