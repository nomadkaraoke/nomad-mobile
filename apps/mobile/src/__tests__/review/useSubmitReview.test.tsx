import { ApiError } from '@nomad/api-gen';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react-native';
import { router } from 'expo-router';
import type { ReactNode } from 'react';

import { useSubmitReview, type SubmitSelection } from '../../review/finish/useSubmitReview';
import { draftKeyOf, loadDraft } from '../../review/drafts';
import { createReviewStore, ReviewStoreContext } from '../../review/store';
import { cleanFixture } from '../../test-utils/reviewFixtures';

jest.mock('expo-router', () => ({ router: { dismissTo: jest.fn() } }));
jest.mock('@nomad/api-gen', () => ({
  ...jest.requireActual('@nomad/api-gen'),
  saveCorrections: jest.fn(),
  getCorrectionData: jest.fn(),
  completeReview: jest.fn(),
  getJob: jest.fn(),
}));
const gen = jest.requireMock('@nomad/api-gen') as Record<string, jest.Mock>;

function setup(selection: SubmitSelection = 'auto') {
  const store = createReviewStore('j1', cleanFixture());
  return { store, ...setupWith(store, selection) };
}

function setupWith(store: ReturnType<typeof createReviewStore>, selection: SubmitSelection) {
  const queryClient = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <ReviewStoreContext.Provider value={store}>{children}</ReviewStoreContext.Provider>
    </QueryClientProvider>
  );
  return renderHook(() => useSubmitReview('j1', selection), { wrapper });
}

beforeEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
  (jest.requireMock('react-native-mmkv') as { __resetMMKV(): void }).__resetMMKV();
  gen.saveCorrections!.mockResolvedValue(undefined);
  gen.getCorrectionData!.mockResolvedValue(cleanFixture());
  gen.completeReview!.mockResolvedValue({ status: 'success' });
});

describe('useSubmitReview', () => {
  it('ignores a second submit while the first is in flight (no double submit)', async () => {
    let release!: () => void;
    gen.saveCorrections!.mockReturnValue(new Promise<void>((r) => (release = r)));
    const { result } = setup();
    let first!: Promise<void>;
    act(() => {
      first = result.current.submit();
      void result.current.submit();
    });
    expect(result.current.state).toBe('saving');
    await act(async () => {
      release();
      await first;
    });
    expect(gen.saveCorrections).toHaveBeenCalledTimes(1);
    expect(gen.completeReview).toHaveBeenCalledTimes(1);
    expect(result.current.state).toBe('done');
    // Done is final: a late press submits nothing more.
    await act(async () => result.current.submit());
    expect(gen.saveCorrections).toHaveBeenCalledTimes(1);
  });

  it('a drop between the calls can be retried from the start (gen calls are idempotent)', async () => {
    gen.getCorrectionData!.mockRejectedValueOnce(new ApiError(502, 'bad gateway'));
    const { result } = setup('clean');
    await act(async () => result.current.submit());
    expect(result.current).toMatchObject({ state: 'error', error: 'server' });
    expect(gen.completeReview).not.toHaveBeenCalled();
    await act(async () => result.current.submit());
    expect(gen.saveCorrections).toHaveBeenCalledTimes(2);
    expect(gen.completeReview).toHaveBeenCalledWith('j1', expect.anything(), 'clean', false);
    expect(result.current.state).toBe('done');
  });

  it('leaves for the Make tab (job progress) once the success state has shown', async () => {
    jest.useFakeTimers();
    const { result } = setup();
    await act(async () => result.current.submit());
    expect(router.dismissTo).not.toHaveBeenCalled();
    act(() => jest.runOnlyPendingTimers());
    expect(router.dismissTo).toHaveBeenCalledWith('/make');
    jest.useRealTimers();
  });

  it('does not navigate if the screen unmounts during the success hold', async () => {
    jest.useFakeTimers();
    const { result, unmount } = setup();
    await act(async () => result.current.submit());
    unmount();
    act(() => jest.runOnlyPendingTimers());
    expect(router.dismissTo).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  it('unmounting during an in-flight submit: it still finishes on gen, but nothing navigates or sets state', async () => {
    jest.useFakeTimers();
    let release!: () => void;
    gen.completeReview!.mockReturnValue(new Promise((r) => (release = () => r({ status: 'success' }))));
    const { result, unmount, store } = setup();
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.submit();
    });
    unmount();
    await act(async () => {
      release();
      await pending;
    });
    expect(store.getState().finished).toBe(true); // gen took it: the draft is gone
    act(() => jest.runOnlyPendingTimers());
    expect(router.dismissTo).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  it('after success the store is finished: edits are ignored and no stale draft is written', async () => {
    jest.useFakeTimers();
    const { result, store } = setup();
    await act(async () => result.current.submit());
    act(() => store.getState().apply((d) => ({ ...d, segments: [] })));
    act(() => store.getState().setSelection('clean'));
    act(() => jest.advanceTimersByTime(5_000));
    store.getState().flushDraft();
    expect(store.getState().doc.segments).toHaveLength(2);
    expect(store.getState().selection).toBeNull();
    expect(loadDraft('j1', draftKeyOf(cleanFixture()))).toBeNull();
    jest.useRealTimers();
  });

  it('finish() cancels a draft write that was already scheduled', () => {
    jest.useFakeTimers();
    const store = createReviewStore('j1', cleanFixture());
    store.getState().apply((d) => ({ ...d, segments: d.segments.slice(1) }));
    store.getState().finish();
    jest.advanceTimersByTime(5_000);
    expect(loadDraft('j1', draftKeyOf(cleanFixture()))).toBeNull();
    jest.useRealTimers();
  });
});
