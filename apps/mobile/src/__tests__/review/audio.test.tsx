import { act, renderHook } from '@testing-library/react-native';

import { setAudioModeAsync } from 'expo-audio';

import { resetPlaybackAudioModeForTests } from '../../audio/playbackMode';
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
  isLoaded = true;
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
    this.isLoaded = false;
    // The new item reports loaded shortly after, unless a test wants to control that moment.
    if (mockAutoLoad) queueMicrotask(() => this.emit({ isLoaded: true }));
  });
  remove = jest.fn(() => {
    this.removed = true;
  });
  addListener = jest.fn((_: string, l: Listener) => {
    this.listeners.push(l);
    return { remove: () => (this.listeners = this.listeners.filter((x) => x !== l)) };
  });
  emit(extra: Record<string, unknown> = {}) {
    if (typeof extra.isLoaded === 'boolean') this.isLoaded = extra.isLoaded;
    const status = { currentTime: this.currentTime, duration: 100, playing: this.playing, isLoaded: true, error: null, ...extra };
    this.listeners.forEach((l) => l(status));
  }
}

const mockPlayers: MockPlayer[] = [];
let mockAutoLoad = true;
jest.mock('expo-audio', () => ({
  setAudioModeAsync: jest.fn(async () => {}),
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
  mockAutoLoad = true;
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

  it('setRate applies to the player and survives a source switch', async () => {
    const { result, rerender } = renderHook((p: { ready: boolean }) => useReviewPlayer('j1', { vocalsReady: p.ready }), {
      initialProps: { ready: false },
    });
    act(() => result.current.setRate(0.5));
    expect(result.current.rate).toBe(0.5);
    act(() => result.current.setSource('vocals'));
    await act(async () => rerender({ ready: true }));
    expect(mockPlayers[0]!.rate).toBe(0.5);
  });

  it('removes the player on unmount', () => {
    const { unmount } = renderHook(() => useReviewPlayer('j1', { vocalsReady: false }));
    unmount();
    expect(mockPlayers[0]!.removed).toBe(true);
  });
});

describe('audio: robustness', () => {
  it('a throwing or rejecting play() sets play_failed instead of escaping; abort is benign', async () => {
    const { result } = renderHook(() => useReviewPlayer('j1', { vocalsReady: false }));
    const p = mockPlayers[0]!;
    p.play.mockImplementationOnce(() => {
      throw new Error('activateSession failed');
    });
    act(() => result.current.play());
    expect(result.current.error).toBe('play_failed');
    act(() => p.emit()); // a status tick must not clear a play failure
    expect(result.current.error).toBe('play_failed');
    const { result: r2 } = renderHook(() => useReviewPlayer('j1', { vocalsReady: false }));
    const abort = Object.assign(new Error('x'), { name: 'AbortError' });
    mockPlayers[1]!.play.mockImplementationOnce(() => Promise.reject(abort) as never);
    await act(async () => r2.current.toggle());
    expect(r2.current.error).toBeNull();
  });

  it('A/B play() throwing surfaces play_failed', () => {
    const { result } = renderHook(() => useAbPlayers('j1', OPTIONS));
    mockPlayers[0]!.play.mockImplementationOnce(() => {
      throw new Error('nope');
    });
    act(() => result.current.play());
    expect(result.current.error).toBe('play_failed');
  });

  it('pause() during an in-flight playRange seek prevents playback', async () => {
    const { result } = renderHook(() => useReviewPlayer('j1', { vocalsReady: false }));
    const p = mockPlayers[0]!;
    let release!: () => void;
    p.seekTo.mockImplementationOnce(() => new Promise<void>((r) => (release = r)));
    act(() => result.current.playRange(5, 8));
    act(() => result.current.pause());
    await act(async () => release());
    expect(p.play).not.toHaveBeenCalled();
  });

  it('unmount during an in-flight seek does not touch the removed player', async () => {
    const { result, unmount } = renderHook(() => useReviewPlayer('j1', { vocalsReady: false }));
    const p = mockPlayers[0]!;
    let release!: () => void;
    p.seekTo.mockImplementationOnce(() => new Promise<void>((r) => (release = r)));
    act(() => result.current.playRange(5, 8));
    unmount();
    await act(async () => release());
    expect(p.play).not.toHaveBeenCalled();
  });

  it('source swap pauses, waits for the new item to load, then seeks and resumes', async () => {
    mockAutoLoad = false;
    const { result, rerender } = renderHook((p: { ready: boolean }) => useReviewPlayer('j1', { vocalsReady: p.ready }), {
      initialProps: { ready: false },
    });
    const p = mockPlayers[0]!;
    p.currentTime = 12;
    p.playing = true;
    act(() => result.current.setSource('vocals'));
    rerender({ ready: true });
    expect(p.pause).toHaveBeenCalled();
    expect(p.replace).toHaveBeenCalledTimes(1);
    expect(p.seekTo).not.toHaveBeenCalled();
    await act(async () => p.emit({ isLoaded: true }));
    expect(p.seekTo).toHaveBeenCalledWith(12);
    expect(p.play).toHaveBeenCalledTimes(1);
  });

  it('exposes loaded from the player status', () => {
    const { result } = renderHook(() => useReviewPlayer('j1', { vocalsReady: false }));
    expect(result.current.loaded).toBe(false);
    act(() => mockPlayers[0]!.emit({ isLoaded: true }));
    expect(result.current.loaded).toBe(true);
  });

  it('A/B refresh-fetch rejection surfaces load_failed and stops loading', async () => {
    mockGetUrls.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useAbPlayers('j1', OPTIONS));
    await act(async () => mockPlayers[0]!.emit({ error: 'boom' }));
    expect(result.current.error).toBe('load_failed');
    expect(result.current.loading).toBe(false);
  });

  it('A/B reload error after refresh surfaces load_failed, stops loading, and releases the listener', async () => {
    mockAutoLoad = false;
    mockGetUrls.mockResolvedValue({ options: OPTIONS });
    const { result } = renderHook(() => useAbPlayers('j1', OPTIONS));
    const a = mockPlayers[0]!;
    const before = a.listeners.length;
    await act(async () => a.emit({ error: 'boom' }));
    expect(a.replace).toHaveBeenCalled();
    await act(async () => a.emit({ error: 'still broken', isLoaded: false }));
    expect(result.current.error).toBe('load_failed');
    expect(result.current.loading).toBe(false);
    expect(a.listeners.length).toBe(before);
    await act(async () => mockPlayers[1]!.emit({ isLoaded: true })); // settle the sibling's pending reload
  });

  it('A/B reload that never loads times out after 15 s with load_failed', async () => {
    jest.useFakeTimers();
    try {
      mockAutoLoad = false;
      mockGetUrls.mockResolvedValue({ options: OPTIONS });
      const { result } = renderHook(() => useAbPlayers('j1', OPTIONS));
      await act(async () => mockPlayers[0]!.emit({ error: 'boom' }));
      expect(result.current.error).toBeNull();
      await act(async () => void jest.advanceTimersByTime(15_000));
      expect(result.current.error).toBe('load_failed');
    } finally {
      jest.useRealTimers();
    }
  });

  it('toggling A/B during a refresh does not cancel the auto-resume', async () => {
    mockAutoLoad = false;
    mockGetUrls.mockResolvedValue({ options: OPTIONS });
    const { result } = renderHook(() => useAbPlayers('j1', OPTIONS));
    const [a, b] = mockPlayers as [MockPlayer, MockPlayer];
    a.playing = true;
    a.currentTime = 7;
    await act(async () => a.emit({ error: 'boom' }));
    act(() => result.current.setActive('with_backing'));
    await act(async () => {
      a.emit({ isLoaded: true });
      b.emit({ isLoaded: true });
    });
    expect(a.play).toHaveBeenCalled();
    expect(b.play).toHaveBeenCalled();
  });

  it('A/B play_failed clears on the next play attempt', () => {
    const { result } = renderHook(() => useAbPlayers('j1', OPTIONS));
    mockPlayers[0]!.play.mockImplementationOnce(() => {
      throw new Error('nope');
    });
    act(() => result.current.play());
    expect(result.current.error).toBe('play_failed');
    act(() => result.current.play());
    expect(result.current.error).toBeNull();
  });

  it('a newer source swap invalidates the older swap continuation', async () => {
    mockAutoLoad = false;
    const { result, rerender } = renderHook((p: { ready: boolean }) => useReviewPlayer('j1', { vocalsReady: p.ready }), {
      initialProps: { ready: false },
    });
    const p = mockPlayers[0]!;
    p.currentTime = 4;
    p.playing = true;
    act(() => result.current.setSource('vocals'));
    rerender({ ready: true }); // swap 1: song -> vocals
    p.playing = false; // swap 1 paused it
    act(() => result.current.setSource('song')); // swap 2: vocals -> song
    expect(p.replace).toHaveBeenCalledTimes(2);
    await act(async () => p.emit({ isLoaded: true }));
    expect(p.seekTo).toHaveBeenCalledTimes(1);
    expect(p.play).toHaveBeenCalledTimes(1);
  });

  it('lockstep ignores a removed (throwing) player', () => {
    jest.useFakeTimers();
    try {
      renderHook(() => useAbPlayers('j1', OPTIONS));
      Object.defineProperty(mockPlayers[1]!, 'currentTime', {
        get() {
          throw new Error('released');
        },
      });
      expect(() => act(() => void jest.advanceTimersByTime(1000))).not.toThrow();
    } finally {
      jest.useRealTimers();
    }
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
    expect(result.current.error).toBe('load_failed');
  });
});

describe('audio: playback mode (ruling E10-R7)', () => {
  const mode = setAudioModeAsync as jest.Mock;
  beforeEach(() => {
    resetPlaybackAudioModeForTests();
    mode.mockClear();
  });

  it('the review player sets the ringer-off playback mode before its first play, once per launch', async () => {
    const { result } = renderHook(() => useReviewPlayer('job-mode', { vocalsReady: false }));
    await act(async () => {});
    expect(mode).toHaveBeenCalledWith({ playsInSilentMode: true, interruptionMode: 'mixWithOthers' });
    const player = mockPlayers.at(-1)!;
    expect(mode.mock.invocationCallOrder[0]!).toBeLessThan(player.play.mock.invocationCallOrder[0] ?? Infinity);
    act(() => result.current.play());
    expect(player.play).toHaveBeenCalled();
    expect(mode.mock.invocationCallOrder[0]!).toBeLessThan(player.play.mock.invocationCallOrder[0]!);
    await act(async () => {});
    expect(mode).toHaveBeenCalledTimes(1);
  });

  it('the A/B players set it too', async () => {
    renderHook(() => useAbPlayers('j1', OPTIONS));
    await act(async () => {});
    expect(mode).toHaveBeenCalledWith(expect.objectContaining({ playsInSilentMode: true }));
  });

  it('a failed attempt is retried on the next play', async () => {
    mode.mockRejectedValueOnce(new Error('session busy'));
    const { result } = renderHook(() => useReviewPlayer('job-retry', { vocalsReady: false }));
    await act(async () => {});
    act(() => result.current.play());
    await act(async () => {});
    expect(mode).toHaveBeenCalledTimes(2);
  });
});
