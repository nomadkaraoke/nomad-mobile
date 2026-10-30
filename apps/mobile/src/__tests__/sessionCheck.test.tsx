// Spec §5: GET /api/users/me on launch and on foreground while signed in; gen's 401 then signs out
// through the API client's onUnauthorized (no extra handling in the hook).
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { setupApiClients } from '../api/setup';
import { useAuth } from '../auth/store';
import { useSessionCheck } from '../auth/useSessionCheck';
import { getPurchases } from '../credits/purchases';
import * as observability from '../observability';
import { session } from '../test-utils/genAuthMock';

jest.mock('../observability', () => ({ setObservabilityUser: jest.fn(), resetObservability: jest.fn(), track: jest.fn() }));
jest.mock('../credits/purchases', () => {
  const adapter = { configure: jest.fn(async () => {}), logOut: jest.fn(async () => {}) };
  return { getPurchases: jest.fn(() => adapter) };
});

const fetchMock = jest.fn();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const meCalls = () => fetchMock.mock.calls.filter(([req]) => String((req as Request).url ?? req).includes('/api/users/me'));

const listeners = () =>
  (AppState.addEventListener as jest.Mock).mock.calls
    .filter(([type]) => type === 'change')
    .map(([, fn]) => fn as (s: AppStateStatus) => void);
const emit = (s: AppStateStatus) => act(() => listeners().forEach((fn) => fn(s)));

const render = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { ...renderHook(() => useSessionCheck(), { wrapper }), client };
};

beforeEach(async () => {
  jest.useRealTimers();
  fetchMock.mockReset();
  (AppState.addEventListener as jest.Mock).mockClear();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  setupApiClients();
  fetchMock.mockImplementation(async () => json({ user: { email: 'me@example.com', credits: 2 } }));
  await useAuth.getState().signInWithSession(session());
});

it('checks the session on launch and caches the balance', async () => {
  const { client } = render();
  await waitFor(() => expect(meCalls()).toHaveLength(1));
  await waitFor(() => expect(client.getQueryData(['me', 'me@example.com'])).toMatchObject({ credits: 2 }));
});

it('checks again each time the app comes to the foreground, not when it goes to the background', async () => {
  render();
  await waitFor(() => expect(meCalls()).toHaveLength(1));
  await emit('background');
  expect(meCalls()).toHaveLength(1);
  await emit('active');
  await waitFor(() => expect(meCalls()).toHaveLength(2));
});

it('a 401 on launch signs out', async () => {
  fetchMock.mockImplementation(async () => json({ detail: 'Invalid session' }, 401));
  render();
  await waitFor(() => expect(useAuth.getState().state.status).toBe('signedOut'));
});

it('does nothing while signed out', async () => {
  await useAuth.getState().signOut();
  render();
  await emit('active');
  await new Promise((r) => setTimeout(r, 50));
  expect(meCalls()).toHaveLength(0);
});

it('tells observability gen\'s app_user_id (not the email) and clears it when signed out', async () => {
  const setUser = observability.setObservabilityUser as jest.Mock;
  setUser.mockClear();
  fetchMock.mockImplementation(async () => json({ user: { email: 'me@example.com', credits: 2 }, app_user_id: 'u-123' }));
  render();
  await waitFor(() => expect(setUser).toHaveBeenCalledWith('u-123'));
  expect(JSON.stringify(setUser.mock.calls)).not.toContain('me@example.com');
  setUser.mockClear();
  await act(() => useAuth.getState().signOut());
  await waitFor(() => expect(setUser).toHaveBeenCalledWith(null));
});

it('signed_in is tracked once a session is stored', async () => {
  const track = observability.track as jest.Mock;
  track.mockClear();
  await useAuth.getState().signInWithSession(session());
  expect(track).toHaveBeenCalledWith('signed_in');
});

it('identifies the store customer by gen\'s app_user_id after sign-in (RevenueCat logIn)', async () => {
  const adapter = (getPurchases as jest.Mock)() as { configure: jest.Mock };
  adapter.configure.mockClear();
  fetchMock.mockImplementation(async () => json({ user: { email: 'me@example.com', credits: 2 }, app_user_id: 'u-123' }));
  render();
  await waitFor(() => expect(adapter.configure).toHaveBeenCalledWith('u-123'));
});

it('a store that cannot be configured never breaks the session check', async () => {
  const adapter = (getPurchases as jest.Mock)() as { configure: jest.Mock };
  adapter.configure.mockRejectedValueOnce(new Error('store down'));
  fetchMock.mockImplementation(async () => json({ user: { email: 'me@example.com', credits: 2 }, app_user_id: 'u-123' }));
  const { client } = render();
  await waitFor(() => expect(client.getQueryData(['me', 'me@example.com'])).toMatchObject({ credits: 2 }));
  expect(useAuth.getState().state.status).toBe('signedIn');
});
