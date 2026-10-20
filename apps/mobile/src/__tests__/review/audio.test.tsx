import { act, renderHook } from '@testing-library/react-native';

import { lockstepCheck } from '../../review/audio/lockstep';
import { useAbPlayers } from '../../review/audio/useAbPlayers';
import { useReviewPlayer } from '../../review/audio/useReviewPlayer';

type Listener = (status: Record<string, unknown>) => void;

class MockPlayer {
  muted = false;
  currentTime = 0;
  playing = false;
  rate = 1;
  removed = false;
  source: unknown;
  listeners: Listener[] = [];
  constructor(source: unknown) {
    this.source = source;
  }
  play = jest.fn(() => {
    this.playing = true;
  });
  pause = jest.fn(() => {
    this.playing = false;
  });
  seekTo = jest.fn(async (t: number) => {
    this.currentTime = t;
  });
  setPlaybackRate = jest.fn((r: number) => {
    this.rate = r;
  });
  replace = jest.fn((s: unknown) => {
    this.source = s;
  });
  remove = jest.fn(() => {
    this.removed = true;
  });
  addListener = jest.fn((_: string, l: Listener) => {
    this.listeners.push(l);
    return { remove: () => (this.listeners = this.listeners.filter((x) => x !== l)) };
  });
  emit(extra: Record<string, unknown> = {}) {
    const status = { currentTime: this.currentTime, duration: 100, playing: this.playing, isLoaded: true, error: null, ...extra };
    this.listeners.forEach((l) => l(status));
  }
}

const mockPlayers: MockPlayer[] = [];
jest.mock('expo-audio', () => ({
  createAudioPlayer: jest.fn((source: unknown) => {
    const p = new MockPlayer(source);
    mockPlayers.push(p);
    return p;
  }),
}));

const mockGetUrls = jest.fn();
jest.mock('@nomad/api-gen', () => ({ getInstrumentalUrls: (...a: unknown[]) => mockGetUrls(...a) }));
jest.mock('../../config', () => ({ GEN_API_URL: 'http://127.0.0.1:8010' }));
jest.mock('../../auth/store', () => ({ useAuth: { getState: () => ({ getToken: () => 'tok' }) } }));

const OPTIONS = [
  { id: 'clean', label: 'Clean', audio_url: '/api/review/j1/instrumental-audio/clean' },
  { id: 'with_backing', label: 'With backing', audio_url: '/instrumental-audio/with_backing' },
];
const uriOf = (p: MockPlayer) => (p.source as { uri: string }).uri;

beforeEach(() => {
  mockPlayers.length = 0;
  mockGetUrls.mockReset();
});

describe('lockstepCheck', () => {
  it('returns the active position only when drift exceeds 0.25 s', () => {
    expect(lockstepCheck(10, 10.2)).toBeNull();
    expect(lockstepCheck(10, 10.25)).toBeNull();
    expect(lockstepCheck(10, 9.6)).toBe(10);
  });
});

describe('audio: useReviewPlayer', () => {
  it('falls back to song while vocals are not ready, and uses vocals once ready', () => {
    const { result, rerender } = renderHook((p: { ready: boolean }) => useReviewPlayer('j1', { vocalsReady: p.ready }), {
      initialProps: { ready: false },
    });
    act(() => result.current.setSource('vocals'));
    expect(result.current.source).toBe('song');
    expect(uriOf(mockPlayers[0]!)).toBe('http://127.0.0.1:8010/api/review/j1/audio?token=tok');
    rerender({ ready: true });
    expect(result.current.source).toBe('vocals');
    expect(uriOf(mockPlayers[0]!)).toContain('/api/review/j1/audio/vocals?token=tok');
  });

  it('now() reads the player clock synchronously', () => {
    const { result } = renderHook(() => useReviewPlayer('j1', { vocalsReady: false }));
    mockPlayers[0]!.currentTime = 12.345;
    expect(result.current.now()).toBe(12.345);
  });

  it('creates the player with a 33 ms update interval and mirrors status into state', () => {
    const { result } = renderHook(() => useReviewPlayer('j1', { vocalsReady: false }));
    expect(jest.requireMock('expo-audio').createAudioPlayer).toHaveBeenCalledWith(expect.anything(), { updateInterval: 33 });
    act(() => mockPlayers[0]!.emit({ currentTime: 3.5, playing: true }));
    expect(result.current.position).toBe(3.5);
    expect(result.current.playing).toBe(true);
    expect(result.current.duration).toBe(100);
  });

  it('playRange seeks, plays, and pauses at the end of the range', async () => {
    const { result } = renderHook(() => useReviewPlayer('j1', { vocalsReady: false }));
    const p = mockPlayers[0]!;
    await act(async () => result.current.playRange(5, 8));
    expect(p.seekTo).toHaveBeenCalledWith(5);
    expect(p.play).toHaveBeenCalled();
    act(() => p.emit({ currentTime: 7.9 }));
    expect(p.pause).not.toHaveBeenCalled();
    act(() => p.emit({ currentTime: 8.02 }));
    expect(p.pause).toHaveBeenCalledTimes(1);
    act(() => p.emit({ currentTime: 8.5 }));
    expect(p.pause).toHaveBeenCalledTimes(1);
  });

  it('setRate applies to the player and survives a source switch', () => {
    const { result, rerender } = renderHook((p: { ready: boolean }) => useReviewPlayer('j1', { vocalsReady: p.ready }), {
      initialProps: { ready: false },
    });
    act(() => result.current.setRate(0.5));
    expect(result.current.rate).toBe(0.5);
    act(() => result.current.setSource('vocals'));
    rerender({ ready: true });
    expect(mockPlayers[0]!.rate).toBe(0.5);
  });

  it('removes the player on unmount', () => {
    const { unmount } = renderHook(() => useReviewPlayer('j1', { vocalsReady: false }));
    unmount();
    expect(mockPlayers[0]!.removed).toBe(true);
  });
});

describe('audio: useAbPlayers', () => {
  it('creates both players with the inactive one muted; setActive swaps mute without seeking', () => {
    const { result } = renderHook(() => useAbPlayers('j1', OPTIONS));
    const [a, b] = mockPlayers as [MockPlayer, MockPlayer];
    expect(uriOf(a)).toBe('http://127.0.0.1:8010/api/review/j1/instrumental-audio/clean?token=tok');
    expect(uriOf(b)).toBe('http://127.0.0.1:8010/api/review/j1/instrumental-audio/with_backing?token=tok');
    expect(result.current.active).toBe('clean');
    expect([a.muted, b.muted]).toEqual([false, true]);
    act(() => result.current.setActive('with_backing'));
    expect(result.current.active).toBe('with_backing');
    expect([a.muted, b.muted]).toEqual([true, false]);
    expect(a.seekTo).not.toHaveBeenCalled();
    expect(b.seekTo).not.toHaveBeenCalled();
  });

  it('plays, pauses and seeks both mockPlayers together', async () => {
    const { result } = renderHook(() => useAbPlayers('j1', OPTIONS));
    const [a, b] = mockPlayers as [MockPlayer, MockPlayer];
    act(() => result.current.play());
    expect([a.play, b.play].every((f) => f.mock.calls.length === 1)).toBe(true);
    await act(async () => result.current.seekTo(9));
    expect([a.currentTime, b.currentTime]).toEqual([9, 9]);
    act(() => result.current.pause());
    expect([a.pause, b.pause].every((f) => f.mock.calls.length === 1)).toBe(true);
  });

  it('re-seeks the muted player once a second when it drifts more than 0.25 s', () => {
    jest.useFakeTimers();
    try {
      renderHook(() => useAbPlayers('j1', OPTIONS));
      const [a, b] = mockPlayers as [MockPlayer, MockPlayer];
      a.currentTime = 20;
      b.currentTime = 19.8;
      act(() => void jest.advanceTimersByTime(1000));
      expect(b.seekTo).not.toHaveBeenCalled();
      b.currentTime = 19.6;
      act(() => void jest.advanceTimersByTime(1000));
      expect(b.seekTo).toHaveBeenCalledWith(20);
      expect(a.seekTo).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('reports loading until both mockPlayers are loaded', () => {
    const { result } = renderHook(() => useAbPlayers('j1', OPTIONS));
    expect(result.current.loading).toBe(true);
    act(() => mockPlayers[0]!.emit());
    expect(result.current.loading).toBe(true);
    act(() => mockPlayers[1]!.emit());
    expect(result.current.loading).toBe(false);
    expect(result.current.duration).toBe(100);
  });

  it('refreshes the URLs on a player error at most 3 times, then surfaces the error', async () => {
    mockGetUrls.mockResolvedValue({ options: OPTIONS });
    const { result } = renderHook(() => useAbPlayers('j1', OPTIONS));
    const a = mockPlayers[0]!;
    for (let i = 0; i < 4; i++) {
      await act(async () => a.emit({ error: 'boom' }));
    }
    expect(mockGetUrls).toHaveBeenCalledTimes(3);
    expect(a.replace).toHaveBeenCalledTimes(3);
    expect(result.current.error).toBe('boom');
  });
});
