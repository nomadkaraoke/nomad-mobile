import { startListenBrainzOAuth } from '@nomad/api-decide';
import { useQueryClient } from '@tanstack/react-query';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking } from 'react-native';

import { importErrorKey } from './importErrors';
import { SERVICES_SUMMARY_KEY } from './queries';

/** Where decide's OAuth callback sends the app back to (`?status=connected` or `?status=error&reason=<code>`). */
export const LB_RETURN_URL = 'nomadkaraoke://services/listenbrainz';

/** The reasons decide's callback can give; anything else reads as the generic error. */
const REASONS = ['denied', 'missing_params', 'invalid_state', 'exchange_failed', 'validate_failed'] as const;
type Reason = (typeof REASONS)[number];

export type OAuthPhase = 'idle' | 'opening' | 'connected' | 'error';
/** A full message key (use with a root `useTranslations()`). */
export type OAuthErrorKey = `connect.lb.oauthError.${Reason | 'generic'}` | 'connect.lb.oauthUnavailable' | `connect.errors.${string}`;

const param = (url: string, name: string) => url.match(new RegExp(`[?&]${name}=([^&#]*)`))?.[1];
const isReturn = (url: string) => url.toLowerCase().startsWith(LB_RETURN_URL);
const statusOf = (e: unknown) => (e as { status?: unknown } | null)?.status;

/**
 * "Sign in with ListenBrainz": MetaBrainz OAuth in an auth session. decide stores the connection in its callback,
 * then returns to `nomadkaraoke://services/listenbrainz`. Connected: refresh the summary (it now shows the linked
 * account) and hand over to `onConnected` (start the sync). On Android the return also reaches Expo Router
 * (+native-intent keeps this screen) and, rarely, the session reports a dismiss before the redirect: a return
 * seen on `Linking` while the session was open still counts. A cold-start return comes in via `applyResult`.
 */
export function useListenBrainzOAuth({ onConnected }: { onConnected: () => void }) {
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<OAuthPhase>('idle');
  const [errorKey, setErrorKey] = useState<OAuthErrorKey | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const applyResult = useCallback(
    async (status: string | undefined, reason: string | undefined) => {
      if (status === 'connected') {
        setErrorKey(null);
        setPhase('connected');
        await queryClient.invalidateQueries({ queryKey: SERVICES_SUMMARY_KEY });
        if (alive.current) onConnected();
        return;
      }
      if (status === 'error') {
        const known = REASONS.includes(reason as Reason) ? (reason as Reason) : 'generic';
        setErrorKey(`connect.lb.oauthError.${known}`);
        setPhase('error');
        return;
      }
      setPhase('idle');
    },
    [onConnected, queryClient],
  );

  const start = useCallback(async () => {
    setPhase('opening');
    setErrorKey(null);
    let seen: string | null = null;
    const sub = Linking.addEventListener('url', ({ url }) => {
      if (isReturn(url)) seen = url;
    });
    try {
      const { auth_url } = await startListenBrainzOAuth();
      const result = await WebBrowser.openAuthSessionAsync(auth_url, LB_RETURN_URL);
      const url = result.type === 'success' ? result.url : seen;
      if (!alive.current) return;
      if (url) await applyResult(param(url, 'status') ?? 'error', param(url, 'reason'));
      else {
        // Closed without finishing. Re-read the summary anyway in case decide connected it.
        setPhase('idle');
        void queryClient.invalidateQueries({ queryKey: SERVICES_SUMMARY_KEY });
      }
    } catch (e) {
      if (!alive.current) return;
      // 404 oauth_disabled: decide switched it off since the capability was read.
      setErrorKey(statusOf(e) === 404 ? 'connect.lb.oauthUnavailable' : importErrorKey(e, 'listenbrainz'));
      setPhase('error');
    } finally {
      sub.remove();
    }
  }, [applyResult, queryClient]);

  return { phase, errorKey, start, applyResult };
}
