import { ApiError } from '@nomad/api-gen';
import { act, renderHook } from '@testing-library/react-native';

import { useReviewLoader } from '../../review/useReviewLoader';

const mockStart = jest.fn();
const mockGet = jest.fn();
const mockReport = jest.fn();
jest.mock('@nomad/api-gen', () => {
  const actual = jest.requireActual('@nomad/api-gen');
  return {
    ...actual,
    startReview: (...a: unknown[]) => mockStart(...a),
    getCorrectionData: (...a: unknown[]) => mockGet(...a),
    reportClientEvent: (...a: unknown[]) => mockReport(...a),
  };
});

let testNo = 0;
const DATA = { corrected_segments: [] };
const flush = async (ms = 0) => {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
};

beforeEach(() => {
  jest.useFakeTimers();
  // The report throttle is module-level: give each test its own hour so tests don't throttle each other.
  jest.setSystemTime(Date.parse('2026-10-20T00:00:00Z') + (testNo += 1) * 3_600_000);
  mockStart.mockReset().mockResolvedValue(undefined);
  mockGet.mockReset();
  mockReport.mockReset();
});
afterEach(() => jest.useRealTimers());

describe('useReviewLoader', () => {
  it('loads on the first try', async () => {
    mockGet.mockResolvedValue(DATA);
    const { result } = renderHook(() => useReviewLoader('j1'));
    expect(result.current.status).toBe('loading');
    await flush();
    expect(result.current).toMatchObject({ status: 'ready', data: DATA });
    expect(mockStart).toHaveBeenCalledWith('j1');
  });

  it('retries a 503 after 5 s then succeeds', async () => {
    mockGet.mockRejectedValueOnce(new ApiError(503, 'down')).mockResolvedValue(DATA);
    const { result } = renderHook(() => useReviewLoader('j2'));
    await flush();
    expect(result.current.status).toBe('loading');
    await flush(4999);
    expect(mockGet).toHaveBeenCalledTimes(1);
    await flush(1);
    expect(mockGet).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe('ready');
  });

  it('treats a 404 as final with no retry', async () => {
    mockGet.mockRejectedValue(new ApiError(404, 'nope'));
    const { result } = renderHook(() => useReviewLoader('j3'));
    await flush();
    expect(result.current).toMatchObject({ status: 'error', error: 'not_found' });
    await flush(120_000);
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it('treats a 401 as final', async () => {
    mockGet.mockRejectedValue(new ApiError(401, 'x'));
    const { result } = renderHook(() => useReviewLoader('j3b'));
    await flush();
    expect(result.current.status).toBe('error');
    await flush(120_000);
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it('honours Retry-After on a 429', async () => {
    mockGet.mockRejectedValueOnce(new ApiError(429, 'slow', 2)).mockResolvedValue(DATA);
    const { result } = renderHook(() => useReviewLoader('j4'));
    await flush();
    await flush(1999);
    expect(mockGet).toHaveBeenCalledTimes(1);
    await flush(1);
    expect(mockGet).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe('ready');
  });

  it('walks the 5/15/30/60 s schedule then errors, and retry() starts over', async () => {
    mockGet.mockRejectedValue(new ApiError(500, 'boom'));
    const { result } = renderHook(() => useReviewLoader('j5'));
    await flush();
    for (const s of [5, 15, 30, 60]) {
      expect(result.current.status).toBe('loading');
      await flush(s * 1000);
    }
    expect(mockGet).toHaveBeenCalledTimes(5);
    expect(result.current).toMatchObject({ status: 'error', error: 'server' });
    await flush(300_000);
    expect(mockGet).toHaveBeenCalledTimes(5);

    mockGet.mockResolvedValue(DATA);
    act(() => result.current.retry());
    await flush();
    expect(result.current.status).toBe('ready');
  });

  it('maps a network failure (status 0) to error "network"', async () => {
    mockGet.mockRejectedValue(new ApiError(0, 'offline'));
    const { result } = renderHook(() => useReviewLoader('j6'));
    await flush();
    for (const s of [5, 15, 30, 60]) await flush(s * 1000);
    expect(result.current).toMatchObject({ status: 'error', error: 'network' });
  });

  it('an unparseable body (invalid_response) is a final server error, not retried as network', async () => {
    mockGet.mockRejectedValue(new ApiError(0, 'invalid_response'));
    const { result } = renderHook(() => useReviewLoader('j6b'));
    await flush();
    expect(result.current).toMatchObject({ status: 'error', error: 'server' });
    expect(mockGet).toHaveBeenCalledTimes(1);
    await flush(60_000);
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it('reports lyrics_load_failed at most once per 60 s', async () => {
    mockGet.mockRejectedValue(new ApiError(500, 'boom'));
    renderHook(() => useReviewLoader('j7'));
    await flush();
    await flush(5000);
    await flush(15000);
    expect(mockReport).toHaveBeenCalledTimes(1);
    expect(mockReport.mock.calls[0]![0]).toBe('lyrics_load_failed');
    await flush(30_000); // t=50 s: failures at 0, 5, 20, 50 s, still one report
    expect(mockReport).toHaveBeenCalledTimes(1);
    await flush(60_000); // t=110 s: the 5th failure is past the window
    expect(mockReport).toHaveBeenCalledTimes(2);
  });

  it('stops retrying after unmount', async () => {
    mockGet.mockRejectedValue(new ApiError(500, 'boom'));
    const { unmount } = renderHook(() => useReviewLoader('j8'));
    await flush();
    unmount();
    await flush(120_000);
    expect(mockGet).toHaveBeenCalledTimes(1);
  });
});
