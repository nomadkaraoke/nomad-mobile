import { renderHook } from '@testing-library/react-native';

import { useOffline } from '../useOffline';

let mockConnected: boolean | null = true;
jest.mock('@react-native-community/netinfo', () => ({ useNetInfo: () => ({ isConnected: mockConnected }) }));

let mockForce = false;
jest.mock('../../config', () => ({ searchForceOffline: () => mockForce }));


beforeEach(() => {
  mockConnected = true;
  mockForce = false;
});

it('follows the connection: offline only when NetInfo says not connected (unknown counts as online)', () => {
  expect(renderHook(() => useOffline()).result.current).toBe(false);
  mockConnected = null;
  expect(renderHook(() => useOffline()).result.current).toBe(false);
  mockConnected = false;
  expect(renderHook(() => useOffline()).result.current).toBe(true);
});

it('the E2E force-offline switch makes it offline while connected', () => {
  mockForce = true;
  expect(renderHook(() => useOffline()).result.current).toBe(true);
});
