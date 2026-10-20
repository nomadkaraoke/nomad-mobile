import { useNetInfo } from '@react-native-community/netinfo';

import { searchForceOffline } from '../config';

/** True when the device has no connection (or the E2E-only EXPO_PUBLIC_SEARCH_FORCE_OFFLINE says to act so). */
export function useOffline(): boolean {
  const connected = useNetInfo().isConnected;
  return connected === false || searchForceOffline();
}
