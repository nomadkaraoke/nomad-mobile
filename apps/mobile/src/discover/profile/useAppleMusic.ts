import {
  APPLE_MUSIC,
  disconnectMusicService,
  listMusicServices,
  startAppleMusicLink,
  type ConnectedServiceResponse,
} from '@nomad/api-decide';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useAuth } from '../../auth/store';
import { RECS_KEY } from '../useRecommendations';
import { PROFILE_KEY } from './useMusicProfile';

export const SERVICES_KEY = [...PROFILE_KEY, 'services'] as const;
/** decide web's connect page sends the browser here when it's done (the auth session closes on it). */
export const APPLE_MUSIC_RETURN_URL = 'nomadkaraoke://music-connected';
const POLL_MS = 4000;

export type AppleMusicStatus = 'notConnected' | 'reading' | 'connected' | 'expired';

/** Where an Apple Music connection is: decide reads the library right after connecting (no last sync yet). */
export function appleMusicStatus(service: ConnectedServiceResponse | undefined): AppleMusicStatus {
  if (!service) return 'notConnected';
  if (service.sync_status === 'error') return 'expired';
  if (service.sync_status === 'syncing' || !service.last_sync_at) return 'reading';
  return 'connected';
}

/**
 * Apple Music on Me's music profile. Connecting opens decide web's MusicKit page in an auth session with a
 * one-time link (the browser isn't signed in to decide); decide then reads the library in the background,
 * so the services list is polled while it does, and the picks refresh when it's done.
 */
export function useAppleMusic() {
  const signedIn = useAuth((s) => s.state.status === 'signedIn');
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

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

  const connect = useCallback(async () => {
    setBusy(true);
    setFailed(false);
    try {
      const link = await startAppleMusicLink();
      await WebBrowser.openAuthSessionAsync(link.connect_url, APPLE_MUSIC_RETURN_URL);
      // Success or the browser closed early: decide's services list says whether it connected.
      await queryClient.invalidateQueries({ queryKey: SERVICES_KEY });
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }, [queryClient]);

  const disconnect = useCallback(async () => {
    setBusy(true);
    setFailed(false);
    try {
      await disconnectMusicService(APPLE_MUSIC);
      await queryClient.invalidateQueries({ queryKey: SERVICES_KEY });
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }, [queryClient]);

  return { status, songs: service?.songs_synced ?? 0, loading: services.isPending && signedIn, busy, failed, connect, disconnect };
}
