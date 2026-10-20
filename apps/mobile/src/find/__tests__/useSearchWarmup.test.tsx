import { pingSearch } from '@nomad/api-decide';
import { act, renderHook } from '@testing-library/react-native';
import { AppState } from 'react-native';

import { maybeRefreshOfflineIndex } from '../../offline/offlineIndex';
import { resetSearchWarmupForTests, useSearchWarmup, WARMUP_INTERVAL_MS } from '../useSearchWarmup';

jest.mock('@nomad/api-decide', () => ({ pingSearch: jest.fn(async () => true) }));
jest.mock('../../offline/offlineIndex', () => ({ maybeRefreshOfflineIndex: jest.fn(async () => {}) }));

const ping = pingSearch as jest.Mock;
const refresh = maybeRefreshOfflineIndex as jest.Mock;

let listeners: ((s: string) => void)[] = [];
let addSpy: jest.SpyInstance;
const appState = (s: string) => act(() => listeners.forEach((fn) => fn(s)));

beforeEach(() => {
  jest.useFakeTimers({ now: 1_000_000 });
  resetSearchWarmupForTests();
  ping.mockClear();
  refresh.mockClear();
  listeners = [];
  addSpy = jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, fn) => {
    const listener = fn as (s: string) => void;
    listeners.push(listener);
    return { remove: () => listeners.splice(listeners.indexOf(listener), 1) } as unknown as ReturnType<
      typeof AppState.addEventListener
    >;
  });
});
afterEach(() => {
  addSpy.mockRestore();
  jest.useRealTimers();
});

it('pings the search service and checks the offline list on mount', () => {
  renderHook(() => useSearchWarmup());
  expect(ping).toHaveBeenCalledTimes(1);
  expect(refresh).toHaveBeenCalledTimes(1);
});

it('pings again on each return to the foreground, at most once per 60 s', () => {
  renderHook(() => useSearchWarmup());
  jest.advanceTimersByTime(30_000);
  appState('active');
  expect(ping).toHaveBeenCalledTimes(1); // 30 s after the launch ping
  expect(refresh).toHaveBeenCalledTimes(2); // the refresh gates itself

  jest.advanceTimersByTime(WARMUP_INTERVAL_MS - 30_000);
  appState('background');
  expect(ping).toHaveBeenCalledTimes(1);
  appState('active');
  expect(ping).toHaveBeenCalledTimes(2);

  jest.advanceTimersByTime(WARMUP_INTERVAL_MS);
  appState('active');
  expect(ping).toHaveBeenCalledTimes(3);
});

it('stops listening on unmount', () => {
  const { unmount } = renderHook(() => useSearchWarmup());
  unmount();
  expect(listeners).toHaveLength(0);
});

it('a failing offline refresh never surfaces', async () => {
  refresh.mockRejectedValueOnce(new Error('boom'));
  renderHook(() => useSearchWarmup());
  await act(async () => {});
  expect(ping).toHaveBeenCalledTimes(1);
});
