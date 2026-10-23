// Phase 3c Task 18b: saving the voice profile to decide, offline retry, server/local reconciliation.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { setupApiClients } from '../api/setup';
import { useAuth } from '../auth/store';
import { useDiscoverStale } from '../discover/staleStore';
import { appStorage } from '../storage';
import { session } from '../test-utils/genAuthMock';
import { useFlushPendingVoice, useSaveVoiceProfile, useVoiceProfile } from '../voice/useVoiceProfile';
import { profileFromSelfReport, toVoiceProfileIn, useVoiceStore, VOICE_STORAGE_KEY } from '../voice/voiceStore';

const fetchMock = jest.fn();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const voiceCalls = (method?: string) =>
  fetchMock.mock.calls
    .map(([req]) => req as Request)
    .filter((r) => r.url.includes('/api/my/voice') && (!method || r.method === method));

const T1 = '2026-10-22T18:00:00.000Z';
const T0 = '2026-10-21T18:00:00.000Z';
const T2 = '2026-10-23T18:00:00.000Z';
const local = (t = T1) => profileFromSelfReport('tenor', t);
const serverOut = (t: string) => ({ ...toVoiceProfileIn(profileFromSelfReport('alto', t)), updated_at: t });

const listeners = () =>
  (AppState.addEventListener as jest.Mock).mock.calls
    .filter(([type]) => type === 'change')
    .map(([, fn]) => fn as (s: AppStateStatus) => void);

const wrapperFor = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return wrapper;
};

beforeEach(async () => {
  jest.useRealTimers();
  fetchMock.mockReset();
  (AppState.addEventListener as jest.Mock).mockClear();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  setupApiClients();
  appStorage.remove(VOICE_STORAGE_KEY);
  act(() => useVoiceStore.getState().clear());
  useDiscoverStale.getState().clear();
  await useAuth.getState().signInWithSession(session());
});

describe('useSaveVoiceProfile', () => {
  it('PUTs exactly the API keys; success clears pending', async () => {
    fetchMock.mockImplementation(async (req: Request) => json({ ...(await req.clone().json()), updated_at: T1 }));
    const { result } = renderHook(() => useSaveVoiceProfile(), { wrapper: wrapperFor() });
    await act(async () => void (await result.current(local())));
    const puts = voiceCalls('PUT');
    expect(puts).toHaveLength(1);
    expect(await puts[0]!.json()).toEqual(toVoiceProfileIn(local()));
    expect(useVoiceStore.getState()).toMatchObject({ pending: false, profile: local() });
  });

  it('a self-report PUTs method self, confidence low', async () => {
    fetchMock.mockImplementation(async (req: Request) => json({ ...(await req.clone().json()), updated_at: T1 }));
    const { result } = renderHook(() => useSaveVoiceProfile(), { wrapper: wrapperFor() });
    await act(async () => void (await result.current(profileFromSelfReport('lower', T1))));
    expect(await voiceCalls('PUT')[0]!.json()).toMatchObject({ method: 'self', confidence: 'low', register: 'lower' });
  });

  it('503 keeps the profile pending; a flush after recovery PUTs exactly once', async () => {
    fetchMock.mockResolvedValue(json({ detail: 'warming_up' }, 503));
    const wrapper = wrapperFor();
    const save = renderHook(() => useSaveVoiceProfile(), { wrapper });
    await act(async () => void (await save.result.current(local())));
    expect(useVoiceStore.getState()).toMatchObject({ pending: true, profile: local() });
    expect(voiceCalls('PUT')).toHaveLength(1);

    fetchMock.mockReset();
    fetchMock.mockImplementation(async (req: Request) => json({ ...(await req.clone().json()), updated_at: T1 }));
    const flush = renderHook(() => useFlushPendingVoice(), { wrapper });
    await waitFor(() => expect(useVoiceStore.getState().pending).toBe(false));
    expect(voiceCalls('PUT')).toHaveLength(1);
    flush.rerender({});
    expect(voiceCalls('PUT')).toHaveLength(1);
  });

  it('a network failure keeps it pending and local', async () => {
    fetchMock.mockRejectedValue(new TypeError('Network request failed'));
    const { result } = renderHook(() => useSaveVoiceProfile(), { wrapper: wrapperFor() });
    await act(async () => void (await result.current(local())));
    expect(useVoiceStore.getState()).toMatchObject({ pending: true, profile: local() });
  });

  it('signed out: stored pending, no request', async () => {
    await useAuth.getState().signOut();
    const { result } = renderHook(() => useSaveVoiceProfile(), { wrapper: wrapperFor() });
    await act(async () => void (await result.current(local())));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(useVoiceStore.getState()).toMatchObject({ pending: true, profile: local() });
  });

  it('a decide 401 marks Discover stale, keeps pending and never signs out', async () => {
    fetchMock.mockResolvedValue(json({ detail: 'unauthorized' }, 401));
    const { result } = renderHook(() => useSaveVoiceProfile(), { wrapper: wrapperFor() });
    await act(async () => void (await result.current(local())));
    expect(useDiscoverStale.getState().stale).toBe(true);
    expect(useAuth.getState().state.status).toBe('signedIn');
    expect(useVoiceStore.getState().pending).toBe(true);
  });
});

describe('useFlushPendingVoice', () => {
  it('sends a pending profile on mount and again on foreground only while pending', async () => {
    useVoiceStore.getState().save(local());
    fetchMock.mockImplementation(async (req: Request) => json({ ...(await req.clone().json()), updated_at: T1 }));
    renderHook(() => useFlushPendingVoice(), { wrapper: wrapperFor() });
    await waitFor(() => expect(useVoiceStore.getState().pending).toBe(false));
    act(() => listeners().forEach((fn) => fn('active')));
    expect(voiceCalls('PUT')).toHaveLength(1);
  });

  it('does nothing when signed out', async () => {
    await useAuth.getState().signOut();
    useVoiceStore.getState().save(local());
    renderHook(() => useFlushPendingVoice(), { wrapper: wrapperFor() });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(useVoiceStore.getState().pending).toBe(true);
  });

  it('retries on foreground after a failure', async () => {
    useVoiceStore.getState().save(local());
    fetchMock.mockResolvedValue(json({ detail: 'x' }, 500));
    renderHook(() => useFlushPendingVoice(), { wrapper: wrapperFor() });
    await waitFor(() => expect(voiceCalls('PUT')).toHaveLength(1));
    fetchMock.mockImplementation(async (req: Request) => json({ ...(await req.clone().json()), updated_at: T1 }));
    await act(async () => listeners().forEach((fn) => fn('active')));
    await waitFor(() => expect(useVoiceStore.getState().pending).toBe(false));
    expect(voiceCalls('PUT')).toHaveLength(2);
  });
});

describe('useVoiceProfile', () => {
  it('a newer server profile replaces the local one', async () => {
    useVoiceStore.getState().markSynced(T0);
    act(() => useVoiceStore.getState().save(local(T0)));
    act(() => useVoiceStore.getState().markSynced(T0));
    fetchMock.mockResolvedValue(json({ profile: serverOut(T1) }));
    renderHook(() => useVoiceProfile(), { wrapper: wrapperFor() });
    await waitFor(() => expect(useVoiceStore.getState().profile?.measuredAt).toBe(T1));
    expect(useVoiceStore.getState()).toMatchObject({ pending: false });
    expect(useVoiceStore.getState().profile?.voiceType).toBe('alto');
  });

  it('an older server profile does not replace a newer local one', async () => {
    act(() => useVoiceStore.getState().save(local(T2)));
    fetchMock.mockResolvedValue(json({ profile: serverOut(T1) }));
    const { result } = renderHook(() => useVoiceProfile(), { wrapper: wrapperFor() });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await act(async () => {});
    expect(useVoiceStore.getState().profile).toEqual(local(T2));
    expect(useVoiceStore.getState().pending).toBe(true);
    expect(result.current.profile).toEqual(local(T2));
  });

  it('the same measurement on the server marks it synced', async () => {
    act(() => useVoiceStore.getState().save(local(T1)));
    fetchMock.mockResolvedValue(json({ profile: { ...toVoiceProfileIn(local(T1)), updated_at: T1 } }));
    renderHook(() => useVoiceProfile(), { wrapper: wrapperFor() });
    await waitFor(() => expect(useVoiceStore.getState().pending).toBe(false));
    expect(useVoiceStore.getState().profile).toEqual(local(T1));
  });

  it('a server with no profile leaves a local one alone', async () => {
    act(() => useVoiceStore.getState().save(local(T1)));
    fetchMock.mockResolvedValue(json({ profile: null }));
    renderHook(() => useVoiceProfile(), { wrapper: wrapperFor() });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await act(async () => {});
    expect(useVoiceStore.getState()).toMatchObject({ profile: local(T1), pending: true });
  });
});
