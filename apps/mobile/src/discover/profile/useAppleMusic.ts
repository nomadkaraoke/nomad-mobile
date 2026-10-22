import {
  APPLE_MUSIC,
  ApiError,
  connectAppleMusic,
  disconnectMusicService,
  getAppleMusicAppDeveloperToken,
  listMusicServices,
  startAppleMusicLink,
  type ConnectedServiceResponse,
} from '@nomad/api-decide';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, Platform } from 'react-native';

import { nativeAppleMusicAvailable, requestAppleMusicUserToken } from '../../../modules/apple-music-auth';

import { useAuth } from '../../auth/store';
import { RECS_KEY } from '../useRecommendations';
import { PROFILE_KEY } from './useMusicProfile';

export const SERVICES_KEY = [...PROFILE_KEY, 'services'] as const;
const POLL_MS = 4000;

export type AppleMusicStatus = 'notConnected' | 'reading' | 'connected' | 'expired';
/** Why a native (iOS) connect didn't happen: access denied in Settings, no subscription, or anything else. */
export type AppleMusicProblem = 'denied' | 'noSubscription' | 'failed';

/** Where an Apple Music connection is: decide reads the library right after connecting (no last sync yet). */
export function appleMusicStatus(service: ConnectedServiceResponse | undefined): AppleMusicStatus {
  if (!service) return 'notConnected';
  if (service.sync_status === 'error') return 'expired';
  if (service.sync_status === 'syncing' || !service.last_sync_at) return 'reading';
  return 'connected';
}

/**
 * Apple Music on Me's music profile. On iOS it's native: MusicKit asks for Apple Music access and turns decide's
 * app developer token into a Music User Token, which goes straight to decide (no browser). Elsewhere connecting
 * opens decide web's MusicKit page in the phone's browser with a
 * one-time link (the browser isn't signed in to decide); decide then reads the library in the background,
 * so the services list is polled while it does, and the picks refresh when it's done.
 *
 * Not an in-app browser tab: Apple's sign-in is a popup that hands the token back through `window.opener`, and
 * Android custom tabs (Firefox's, found on Andrew's Pixel) drop that, so authorize() never finished. The page
 * returns with nomadkaraoke://music-connected (+native-intent keeps this screen); coming back to the app by any
 * route re-reads the services list.
 */
export function useAppleMusic() {
  const signedIn = useAuth((s) => s.state.status === 'signedIn');
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<AppleMusicProblem | null>(null);

  const services = useQuery({
    queryKey: SERVICES_KEY,
    queryFn: listMusicServices,
    enabled: signedIn,
    refetchInterval: (q) =>
      appleMusicStatus(q.state.data?.find((s) => s.service_type === APPLE_MUSIC)) === 'reading' ? POLL_MS : false,
  });
  const service = services.data?.find((s) => s.service_type === APPLE_MUSIC);
  const status = appleMusicStatus(service);

  // A finished read changes the picks and the artists on this screen.
  const lastStatus = useRef(status);
  useEffect(() => {
    if (lastStatus.current === 'reading' && status === 'connected') {
      void queryClient.invalidateQueries({ queryKey: RECS_KEY });
      void queryClient.invalidateQueries({ queryKey: PROFILE_KEY });
    }
    lastStatus.current = status;
  }, [status, queryClient]);

  // Back from the browser (the page's hand-back or the app switcher): did it connect?
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void queryClient.invalidateQueries({ queryKey: SERVICES_KEY });
    });
    return () => sub.remove();
  }, [queryClient]);

  const connectNative = useCallback(async (): Promise<AppleMusicProblem | null> => {
    const result = await requestAppleMusicUserToken(await getAppleMusicAppDeveloperToken());
    if (result.status === 'denied' || result.status === 'restricted') return 'denied';
    if (result.status !== 'authorized') return 'failed';
    try {
      await connectAppleMusic(result.token);
    } catch (e) {
      // 422: Apple refused the token, which in practice means no Apple Music subscription.
      return e instanceof ApiError && e.status === 422 ? 'noSubscription' : 'failed';
    }
    await queryClient.invalidateQueries({ queryKey: SERVICES_KEY });
    return null;
  }, [queryClient]);

  const connect = useCallback(async () => {
    setBusy(true);
    setProblem(null);
    try {
      if (Platform.OS === 'ios' && nativeAppleMusicAvailable()) {
        setProblem(await connectNative());
        return;
      }
      const link = await startAppleMusicLink();
      await Linking.openURL(link.connect_url);
    } catch {
      setProblem('failed');
    } finally {
      setBusy(false);
    }
  }, [connectNative]);

  const disconnect = useCallback(async () => {
    setBusy(true);
    setProblem(null);
    try {
      await disconnectMusicService(APPLE_MUSIC);
      await queryClient.invalidateQueries({ queryKey: SERVICES_KEY });
    } catch {
      setProblem('failed');
    } finally {
      setBusy(false);
    }
  }, [queryClient]);

  return { status, songs: service?.songs_synced ?? 0, loading: services.isPending && signedIn, busy, problem, connect, disconnect };
}
