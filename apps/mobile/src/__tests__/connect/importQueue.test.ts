// The offline upload queue for on-phone parsed exports (Phase 3b Task 17).
import * as decide from '@nomad/api-decide';
import type { ExportUploadChunk } from '@nomad/core';
import { act, renderHook } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

import { useAuth } from '../../auth/store';
import {
  importQueueIdle,
  retryDelayMs,
  setImportQueueOnline,
  useImportQueue,
  useImportQueueRunner,
} from '../../discover/connect/importQueue';
import { SERVICES_SUMMARY_KEY } from '../../discover/connect/queries';
import { RECS_KEY } from '../../discover/useRecommendations';
import { appStorage } from '../../storage';
import { fsState } from '../../test-utils/memoryFs';

jest.mock('expo-file-system', () => require('../../test-utils/memoryFs'));
jest.mock('@nomad/api-decide', () => ({
  ...jest.requireActual('@nomad/api-decide'),
  uploadExportChunk: jest.fn(),
}));
let mockOffline = false;
jest.mock('../../net/useOffline', () => ({ useOffline: () => mockOffline }));

const api = decide as jest.Mocked<typeof decide>;
const { ApiError } = jest.requireActual<typeof decide>('@nomad/api-decide');

const OK = {
  source: 'spotify_export',
  artists_added: 2,
  songs_added: 3,
  songs_updated: 0,
  tracks_matched: 3,
  duplicate: false,
  chunks_done: 1,
  chunk_count: 1,
};
const chunk = (i: number, count = 2): ExportUploadChunk => ({
  endpoint: 'spotify-export',
  body: { kind: 'extended', generated_at: '2024-05-01', chunk_index: i, chunk_count: count, tracks: [], liked: [], playlists: [] },
});
const signIn = (email: string) =>
  useAuth.setState({ state: { status: 'signedIn', session: { token: 't', email, createdAt: 0 } } });
const signOut = () => useAuth.setState({ state: { status: 'signedOut' } });
const sentIndexes = () => api.uploadExportChunk.mock.calls.map(([c]) => c.body.chunk_index);
const payloadFiles = () => [...fsState.files.keys()].filter((k) => k.startsWith('file:///document/imports/'));

beforeEach(async () => {
  jest.useRealTimers();
  jest.clearAllMocks();
  await importQueueIdle();
  fsState.reset();
  appStorage.clearAll();
  setImportQueueOnline(false);
  useImportQueue.getState().rehydrate();
  signIn('a@example.com');
  api.uploadExportChunk.mockResolvedValue(OK);
});

afterEach(async () => {
  setImportQueueOnline(false);
  await importQueueIdle();
});

it('retry schedule is 5/15/30/60 s, then stays at 60 s, and a Retry-After wins', () => {
  expect([1, 2, 3, 4, 5, 9].map((a) => retryDelayMs(a, null))).toEqual([5_000, 15_000, 30_000, 60_000, 60_000, 60_000]);
  expect(retryDelayMs(1, 42)).toBe(42_000);
});

it('offline keeps pending', async () => {
  const batch = useImportQueue.getState().enqueue([chunk(0), chunk(1)], 'spotify');
  await importQueueIdle();

  expect(batch).toEqual(expect.any(String));
  expect(api.uploadExportChunk).not.toHaveBeenCalled();
  const { pending, batches } = useImportQueue.getState();
  expect(pending).toHaveLength(2);
  expect(pending.every((p) => p.label === 'spotify' && p.attempts === 0 && p.batch === batch)).toBe(true);
  expect(batches[batch!]).toMatchObject({ label: 'spotify', chunks: 2, sent: 0, failed: 0 });
  // Bodies live in files, never in MMKV.
  expect(payloadFiles()).toHaveLength(2);
  expect(appStorage.getString('connect.importQueue')).not.toContain('generated_at');
});

it('online flushes in order', async () => {
  const batch = useImportQueue.getState().enqueue([chunk(0, 3), chunk(1, 3), chunk(2, 3)], 'spotify')!;
  setImportQueueOnline(true);
  await importQueueIdle();

  expect(sentIndexes()).toEqual([0, 1, 2]);
  expect(api.uploadExportChunk.mock.calls[0]?.[0]).toEqual(chunk(0, 3));
  const s = useImportQueue.getState();
  expect(s.pending).toEqual([]);
  expect(s.batches[batch]).toMatchObject({ chunks: 3, sent: 3, failed: 0, artistsAdded: 6, songsAdded: 9 });
  expect(payloadFiles()).toEqual([]);
});

it('signed out keeps pending; signing back in sends', async () => {
  useImportQueue.getState().enqueue([chunk(0, 1)], 'apple');
  signOut();
  setImportQueueOnline(true);
  await importQueueIdle();
  expect(api.uploadExportChunk).not.toHaveBeenCalled();

  signIn('a@example.com');
  await importQueueIdle();
  expect(sentIndexes()).toEqual([0]);
});

it("never sends one account's import as another account", async () => {
  useImportQueue.getState().enqueue([chunk(0, 1)], 'spotify');
  signIn('b@example.com');
  setImportQueueOnline(true);
  await importQueueIdle();
  expect(api.uploadExportChunk).not.toHaveBeenCalled();
  expect(useImportQueue.getState().pending).toHaveLength(1);
});

it('enqueue while signed out does nothing', () => {
  signOut();
  expect(useImportQueue.getState().enqueue([chunk(0)], 'spotify')).toBeNull();
  expect(useImportQueue.getState().pending).toEqual([]);
});

it('503 retries with backoff', async () => {
  jest.useFakeTimers({ now: 1_000_000 });
  api.uploadExportChunk
    .mockRejectedValueOnce(new ApiError(503, 'busy'))
    .mockRejectedValueOnce(new ApiError(0, 'network'))
    .mockResolvedValue(OK);
  useImportQueue.getState().enqueue([chunk(0, 1)], 'spotify');
  setImportQueueOnline(true);
  await importQueueIdle();

  expect(api.uploadExportChunk).toHaveBeenCalledTimes(1);
  expect(useImportQueue.getState().pending[0]).toMatchObject({ attempts: 1, nextAt: 1_005_000 });

  await act(async () => {
    jest.advanceTimersByTime(4_999);
  });
  expect(api.uploadExportChunk).toHaveBeenCalledTimes(1);
  await act(async () => {
    jest.advanceTimersByTime(1);
  });
  await importQueueIdle();
  expect(api.uploadExportChunk).toHaveBeenCalledTimes(2);
  expect(useImportQueue.getState().pending[0]).toMatchObject({ attempts: 2, nextAt: 1_005_000 + 15_000 });

  await act(async () => {
    jest.advanceTimersByTime(15_000);
  });
  await importQueueIdle();
  expect(api.uploadExportChunk).toHaveBeenCalledTimes(3);
  expect(useImportQueue.getState().pending).toEqual([]);
  expect(useImportQueue.getState().lastError).toBeNull();
});

it('429 honours Retry-After', async () => {
  jest.useFakeTimers({ now: 2_000_000 });
  api.uploadExportChunk.mockRejectedValueOnce(new ApiError(429, 'slow down', 90)).mockResolvedValue(OK);
  useImportQueue.getState().enqueue([chunk(0, 1)], 'spotify');
  setImportQueueOnline(true);
  await importQueueIdle();
  expect(useImportQueue.getState().pending[0]?.nextAt).toBe(2_090_000);

  await act(async () => {
    jest.advanceTimersByTime(60_000);
  });
  expect(api.uploadExportChunk).toHaveBeenCalledTimes(1);
  await act(async () => {
    jest.advanceTimersByTime(30_000);
  });
  await importQueueIdle();
  expect(api.uploadExportChunk).toHaveBeenCalledTimes(2);
});

it('400 drops and sets lastError', async () => {
  api.uploadExportChunk.mockRejectedValueOnce(new ApiError(400, 'bad_chunk')).mockResolvedValue(OK);
  const batch = useImportQueue.getState().enqueue([chunk(0), chunk(1)], 'spotify')!;
  setImportQueueOnline(true);
  await importQueueIdle();

  // The bad chunk is dropped; the next one still goes.
  expect(sentIndexes()).toEqual([0, 1]);
  const s = useImportQueue.getState();
  expect(s.pending).toEqual([]);
  expect(s.lastError).toMatchObject({ batch, label: 'spotify', status: 400, detail: 'bad_chunk' });
  expect(s.batches[batch]).toMatchObject({ sent: 1, failed: 1 });
  expect(payloadFiles()).toEqual([]);

  s.clearError();
  expect(useImportQueue.getState().lastError).toBeNull();
});

it('a missing payload file is dropped, not retried forever', async () => {
  useImportQueue.getState().enqueue([chunk(0, 1)], 'spotify');
  fsState.files.clear();
  setImportQueueOnline(true);
  await importQueueIdle();
  expect(api.uploadExportChunk).not.toHaveBeenCalled();
  expect(useImportQueue.getState().pending).toEqual([]);
  expect(useImportQueue.getState().lastError).toMatchObject({ status: null });
});

it('survives restart (MMKV)', async () => {
  const batch = useImportQueue.getState().enqueue([chunk(0), chunk(1)], 'spotify')!;
  // A "restart": the in-memory store is gone, MMKV and the payload files are not.
  useImportQueue.setState({ pending: [], batches: {}, lastError: null });
  useImportQueue.getState().rehydrate();

  expect(useImportQueue.getState().pending.map((p) => p.batch)).toEqual([batch, batch]);
  setImportQueueOnline(true);
  await importQueueIdle();
  expect(sentIndexes()).toEqual([0, 1]);
});

it('remove drops the item and its payload file', () => {
  useImportQueue.getState().enqueue([chunk(0), chunk(1)], 'spotify');
  const [first] = useImportQueue.getState().pending;
  useImportQueue.getState().remove(first!.id);
  expect(useImportQueue.getState().pending).toHaveLength(1);
  expect(payloadFiles()).toHaveLength(1);
});

it('payload files nobody references are swept on the first flush', async () => {
  fsState.dirs.add('file:///document/imports');
  fsState.files.set('file:///document/imports/orphan.json', new TextEncoder().encode('{}'));
  useImportQueue.getState().enqueue([chunk(0, 1)], 'spotify');
  api.uploadExportChunk.mockImplementation(async () => {
    expect(payloadFiles()).not.toContain('file:///document/imports/orphan.json');
    return OK;
  });
  setImportQueueOnline(true);
  await importQueueIdle();
  expect(api.uploadExportChunk).toHaveBeenCalledTimes(1);
});

describe('useImportQueueRunner', () => {
  const wrapper = (client: QueryClient) =>
    function Wrapper({ children }: { children: ReactNode }) {
      return createElement(QueryClientProvider, { client }, children);
    };

  it('flushes when the connection comes back and refreshes the summary and picks when an import lands', async () => {
    const client = new QueryClient();
    const invalidate = jest.spyOn(client, 'invalidateQueries');
    mockOffline = true;
    useImportQueue.getState().enqueue([chunk(0, 1)], 'spotify');
    const { rerender, unmount } = renderHook(() => useImportQueueRunner(), { wrapper: wrapper(client) });
    await act(async () => {
      await importQueueIdle();
    });
    expect(api.uploadExportChunk).not.toHaveBeenCalled();

    mockOffline = false;
    rerender({});
    await act(async () => {
      await importQueueIdle();
    });
    expect(sentIndexes()).toEqual([0]);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: SERVICES_SUMMARY_KEY });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: RECS_KEY });
    unmount();
    mockOffline = false;
  });
});
