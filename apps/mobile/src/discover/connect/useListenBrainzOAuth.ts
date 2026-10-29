import { getServicesSummary, startListenBrainzOAuth } from '@nomad/api-decide';
import { useQueryClient } from '@tanstack/react-query';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking } from 'react-native';

import { importErrorKey } from './importErrors';
import { LB_RETURN, LB_RETURN_URL, lbReturnFromUrl, type LbReturn } from './lbReturn';
import { currentUserKey } from '../../me/account';
import { SERVICES_SUMMARY_KEY, servicesSummaryKeyFor } from './queries';

export { LB_RETURN_URL } from './lbReturn';

/** The reasons decide's callback can give; anything else reads as the generic error. */
const REASONS = ['denied', 'missing_params', 'invalid_state', 'exchange_failed', 'validate_failed'] as const;
type Reason = (typeof REASONS)[number];

/** How long a dismissed session still waits for a late return on Linking (Android's dismiss/redirect race). */
export const oauthConfig = { dismissGraceMs: 1000 };

export type OAuthPhase = 'idle' | 'opening' | 'connected' | 'error';
/** A full message key (use with a root `useTranslations()`). */
export type OAuthErrorKey = `connect.lb.oauthError.${Reason | 'generic'}` | 'connect.lb.oauthUnavailable' | `connect.errors.${string}`;

const statusOf = (e: unknown) => (e as { status?: unknown } | null)?.status;

/**
 * "Sign in with ListenBrainz": MetaBrainz OAuth in an auth session. decide stores the connection in its callback,
 * then returns to `nomadkaraoke://services/listenbrainz`. On Android the return also reaches Expo Router
 * (+native-intent keeps this screen) and the session can report a dismiss before the redirect: a return seen on
 * `Linking` while the session was open, or up to `dismissGraceMs` after it closed, still counts. A cold-start
 * return comes in via `applyResult`.
 *
 * A return is just a URL anyone can open, so "connected" is never taken on its word: the summary is fetched and
 * only a connected ListenBrainz source there refreshes the screen and hands over to `onConnected` (the sync).
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
    async (result: LbReturn | null) => {
      if (result?.status === 'error') {
        const known = REASONS.includes(result.reason as Reason) ? (result.reason as Reason) : 'generic';
        setErrorKey(`connect.lb.oauthError.${known}`);
        setPhase('error');
        return;
      }
      if (result?.status === 'connected') {
        let linked = false;
        try {
          const summary = await queryClient.fetchQuery({
            queryKey: servicesSummaryKeyFor(currentUserKey()),
            queryFn: getServicesSummary,
            staleTime: 0,
          });
          linked = summary.sources.some((s) => s.source === 'listenbrainz' && s.connected);
        } catch {
          // can't confirm: treat as not connected (the screen stays as it was)
        }
        if (!alive.current) return;
        if (linked) {
          setErrorKey(null);
          setPhase('connected');
          onConnected();
          return;
        }
      }
      setPhase('idle');
    },
    [onConnected, queryClient],
  );

  const start = useCallback(async () => {
    setPhase('opening');
    setErrorKey(null);
    let seen: string | null = null;
    let lateReturn: (() => void) | null = null;
    const sub = Linking.addEventListener('url', ({ url }) => {
      if (!LB_RETURN.test(url)) return;
      seen = url;
      lateReturn?.();
    });
    try {
      const { auth_url } = await startListenBrainzOAuth();
      const result = await WebBrowser.openAuthSessionAsync(auth_url, LB_RETURN_URL);
      if (result.type !== 'success' && !seen) {
        await new Promise<void>((resolve) => {
          lateReturn = resolve;
          setTimeout(resolve, oauthConfig.dismissGraceMs);
        });
      }
      const url: string | null = result.type === 'success' ? result.url : seen;
      if (!alive.current) return;
      if (url) await applyResult(lbReturnFromUrl(url) ?? { status: 'error' });
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
