// useVoiceSession: the voice session's state machine (Phase 3d D5) over mocked decide calls, a fake song recorder
// and fake timers; sessionStore's resume window (Review Focus 2).
import { ApiError, type NextVoiceSong, type SessionSetup } from '@nomad/api-decide';
import { contourFrom, findHeldNotes, summarizeSongPitch, type HeldNote, type VoicedFrame } from '@nomad/core';
import { act, renderHook } from '@testing-library/react-native';

import { appStorage } from '../../storage';
import { fsState } from '../../test-utils/memoryFs';
import { profileFromSelfReport, useVoiceStore } from '../../voice/voiceStore';
import { useRecordingQueue } from '../recording/recordingQueue';
import type { SongTake } from '../recording/useSongRecorder';
import { restoreVoiceSession, SESSION_MAX_AGE_MS, VOICE_SESSION_KEY, useVoiceSessionStore } from '../sessionStore';
import { PLAYER_READY_TIMEOUT_MS, useVoiceSession } from '../useVoiceSession';

// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories can't use imports
jest.mock('expo-file-system', () => require('../../test-utils/memoryFs'));

const mockApi = {
  getVoiceFlags: jest.fn(),
  createVoiceSession: jest.fn(),
  getVoiceSession: jest.fn(),
  patchVoiceSession: jest.fn(),
  nextVoiceSong: jest.fn(),
  skipVoiceSong: jest.fn(),
  postVoiceAttempt: jest.fn(),
  getVoiceResult: jest.fn(),
  uploadVoiceRecording: jest.fn(),
  adoptVoiceSession: jest.fn(),
};
jest.mock('@nomad/api-decide', () => ({
  ...jest.requireActual('@nomad/api-decide'),
  getVoiceFlags: (...a: unknown[]) => mockApi.getVoiceFlags(...a),
  createVoiceSession: (...a: unknown[]) => mockApi.createVoiceSession(...a),
  getVoiceSession: (...a: unknown[]) => mockApi.getVoiceSession(...a),
  patchVoiceSession: (...a: unknown[]) => mockApi.patchVoiceSession(...a),
  nextVoiceSong: (...a: unknown[]) => mockApi.nextVoiceSong(...a),
  skipVoiceSong: (...a: unknown[]) => mockApi.skipVoiceSong(...a),
  postVoiceAttempt: (...a: unknown[]) => mockApi.postVoiceAttempt(...a),
  getVoiceResult: (...a: unknown[]) => mockApi.getVoiceResult(...a),
  uploadVoiceRecording: (...a: unknown[]) => mockApi.uploadVoiceRecording(...a),
  adoptVoiceSession: (...a: unknown[]) => mockApi.adoptVoiceSession(...a),
}));

/** The fake recorder: records call order and hands back `nextTake` on stop(). */
const mockOrder: string[] = [];
const mockRec = {
  opts: null as null | { record: boolean; floor: number; onHeldNote?: (n: HeldNote) => void },
  nextTake: { pitch: null, file: null, contour: null, held: [], takeOffsetS: 0 } as SongTake,
  start: jest.fn(async () => void mockOrder.push('recorder.start')),
  stop: jest.fn(async (): Promise<SongTake> => {
    mockOrder.push('recorder.stop');
    return mockRec.nextTake;
  }),
};
jest.mock('../recording/useSongRecorder', () => ({
  useSongRecorder: (_src: unknown, opts: { record: boolean; floor: number; onHeldNote?: (n: HeldNote) => void }) => {
    mockRec.opts = opts;
    return { start: mockRec.start, stop: mockRec.stop, livePitch: null };
  },
}));
jest.mock('../../voice/usePitchSource', () => ({
  usePitchSource: () => ({ kind: 'fake' }),
}));

const T0 = 1_800_000_000_000;
const SETUP: SessionSetup = {
  posture: 'standing',
  warmth: 'bit_warm',
  record: true,
  headphones: true,
  device: 'iPad15,7',
};
const DIR = 'file:///document/voice-recordings';

const song = (key: string, n: number, over: Partial<NextVoiceSong & { kind: 'song' }> = {}): NextVoiceSong => ({
  kind: 'song',
  song_key: key,
  artist: 'Alpha Band',
  title: `Invented Tune ${key}`,
  duration_s: 200,
  reason_type: 'comfortable_start',
  version: {
    video_id: `vid-${key}`,
    brand_code: 'NK',
    brand_name: 'Nomad',
    embeddable: true,
  },
  alternatives: [],
  song_range: { low: 48, high: 67, p10: 50, p50: 57, p90: 64 },
  attempt_n: n,
  max_attempts: 12,
  ...over,
});
const RESULT = {
  voice_type: 'baritone',
  confidence_label: 'medium',
  done_reason: 'confident',
  attempts: 3,
} as never;
const PITCH = {
  voicedS: 40,
  heldCount: 6,
  heldLow: 50,
  heldHigh: 64,
  p10: 51,
  p50: 57,
  p90: 63,
};

/** A take on disk (WAV, consented). */
const takeWithFile = (name: string): SongTake => {
  const uri = `${DIR}/${name}.wav`;
  fsState.files.set(uri, new Uint8Array(64));
  return {
    pitch: PITCH,
    file: { uri, durationS: 190, contentType: 'audio/wav' },
    contour: null,
    held: [],
    takeOffsetS: 0,
  };
};

const network = () => new TypeError('Network request failed');
/** A promise the test settles by hand (a call still in flight). */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
const store = () => useVoiceSessionStore.getState();
const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
};

type Hook = ReturnType<typeof useVoiceSession>;
const player = {
  play: jest.fn(() => void mockOrder.push('player.play')),
  pause: jest.fn(),
};
const note = (start: number, end: number, n: number): HeldNote => ({ start, end, midi: n, note: n });
const heard = (n: HeldNote) => act(() => mockRec.opts!.onHeldNote!(n));

async function mount() {
  const h = renderHook(() => useVoiceSession());
  await flush();
  h.result.current.playerRef.current = player;
  return h;
}

/** pick → play (ready → recorder → play() → playing) → ended → quiz. */
async function singIt(r: { current: Hook }) {
  await act(() => r.current.pickKnow());
  await act(() => r.current.onPlayer({ kind: 'ready' }));
  await act(() => r.current.onPlayer({ kind: 'playing' }));
  jest.advanceTimersByTime(180_000);
  await act(() => r.current.onPlayer({ kind: 'ended' }));
}

beforeEach(() => {
  jest.useFakeTimers({ now: T0 });
  for (const f of Object.values(mockApi)) f.mockReset();
  mockRec.start.mockClear();
  mockRec.stop.mockClear();
  mockRec.nextTake = { pitch: null, file: null, contour: null, held: [], takeOffsetS: 0 };
  player.play.mockClear();
  player.pause.mockClear();
  useVoiceStore.getState().clear();
  mockOrder.length = 0;
  fsState.reset();
  appStorage.clearAll();
  useRecordingQueue.getState().clearAll();
  store().clear();
  mockApi.getVoiceFlags.mockResolvedValue({
    session_enabled: true,
    is_admin: false,
    voice_data: false,
    active_session_id: null,
  });
  mockApi.createVoiceSession.mockResolvedValue({
    session_id: 's1',
    state: 'active',
  });
  mockApi.patchVoiceSession.mockResolvedValue(undefined);
  mockApi.skipVoiceSong.mockResolvedValue(undefined);
  mockApi.getVoiceResult.mockResolvedValue(RESULT);
  mockApi.uploadVoiceRecording.mockReturnValue(new Promise(() => {}));
});
afterEach(() => jest.useRealTimers());

describe('useVoiceSession', () => {
  it('full three-song walk to result', async () => {
    mockApi.nextVoiceSong
      .mockResolvedValueOnce(song('a', 1))
      .mockResolvedValueOnce(song('b', 2, { reason_type: 'upper_range' }))
      .mockResolvedValueOnce(song('c', 3));
    mockApi.postVoiceAttempt
      .mockResolvedValueOnce({
        attempt_id: 'x1',
        n: 1,
        done: false,
        done_reason: null,
        top_p: 0.4,
      })
      .mockResolvedValueOnce({
        attempt_id: 'x2',
        n: 2,
        done: false,
        done_reason: null,
        top_p: 0.6,
      })
      .mockResolvedValueOnce({
        attempt_id: 'x3',
        n: 3,
        done: true,
        done_reason: 'confident',
        top_p: 0.8,
      });
    const enqueue = jest.spyOn(useRecordingQueue.getState(), 'enqueue');
    const { result: r } = await mount();
    expect(r.current.step).toBe('intro');

    act(() => r.current.openSetup());
    await flush();
    expect(r.current.step).toBe('setup');
    await act(() => r.current.begin(SETUP, 0.01));
    expect(mockApi.createVoiceSession).toHaveBeenCalledWith(SETUP);
    expect(r.current.step).toBe('pick');
    expect(r.current.song?.song_key).toBe('a');
    expect(r.current.attemptN).toBe(1);
    expect(r.current.maxAttempts).toBe(12);
    expect(mockRec.opts).toEqual({ record: true, floor: 0.01, onHeldNote: expect.any(Function) });

    for (const [i, key] of ['a', 'b', 'c'].entries()) {
      mockRec.nextTake = takeWithFile(key);
      mockOrder.length = 0;
      await singIt(r);
      // The recorder runs before the video starts (iOS start order).
      expect(mockOrder).toEqual(['recorder.start', 'player.play', 'recorder.stop']);
      expect(r.current.step).toBe('quiz');
      expect(r.current.prefill).toEqual({
        highest: 64,
        lowest: 50,
        suggested: 'comfortable',
      });
      act(() => r.current.setAnswer({ feel: 'loved' }));
      act(() => r.current.setAnswer({ position: 'comfortable', tags: ['crowd_song'] }));
      await flush();
      await act(() => r.current.submitQuiz());
      expect(mockApi.postVoiceAttempt).toHaveBeenLastCalledWith('s1', {
        song_key: key,
        video_id: `vid-${key}`,
        started_at: expect.any(String),
        ended_at: expect.any(String),
        stopped_early: false,
        quiz: {
          feel: 'loved',
          position: 'comfortable',
          would_work_if: [],
          version_issues: [],
          tags: ['crowd_song'],
        },
        pitch: {
          voiced_s: 40,
          held_count: 6,
          held_low: 50,
          held_high: 64,
          p10: 51,
          p50: 57,
          p90: 63,
        },
        // No falsetto answers: the chest-only pitch is the song as sung.
        pitch_all: {
          voiced_s: 40,
          held_count: 6,
          held_low: 50,
          held_high: 64,
          p10: 51,
          p50: 57,
          p90: 63,
        },
      });
      expect(enqueue).toHaveBeenLastCalledWith(
        expect.objectContaining({
          sessionId: 's1',
          attemptN: i + 1,
          uri: `${DIR}/${key}.wav`,
          device: 'iPad15,7',
        }),
      );
      if (i < 2) {
        expect(r.current.step).toBe('pick');
        expect(r.current.quiz.feel).toBeNull();
      }
    }
    const body = mockApi.postVoiceAttempt.mock.calls[0]![1] as {
      started_at: string;
      ended_at: string;
    };
    expect(Date.parse(body.ended_at) - Date.parse(body.started_at)).toBe(180_000);
    expect(mockApi.getVoiceResult).toHaveBeenCalledWith('s1');
    expect(r.current.step).toBe('result');
    expect(r.current.result).toBe(RESULT);
    expect(useRecordingQueue.getState().items).toHaveLength(3);
    expect(mockApi.uploadVoiceRecording).toHaveBeenCalled();
  });

  it('unplayable skips to next version', async () => {
    mockApi.nextVoiceSong.mockResolvedValueOnce(song('a', 1)).mockResolvedValueOnce(
      song('a', 1, {
        version: {
          video_id: 'vid-a2',
          brand_code: 'NK',
          brand_name: 'Nomad',
          embeddable: false,
        },
      }),
    );
    const { result: r } = await mount();
    await act(() => r.current.begin(SETUP));
    expect(r.current.playerMode).toBe('embed-hosted');
    await act(() => r.current.pickKnow());
    await act(() => r.current.onPlayer({ kind: 'ready' }));
    await act(() => r.current.onPlayer({ kind: 'unplayable', code: 150 }));
    expect(mockApi.skipVoiceSong).toHaveBeenCalledWith('s1', {
      song_key: 'a',
      reason: 'not_embeddable',
      video_id: 'vid-a',
    });
    expect(mockRec.stop).toHaveBeenCalled();
    // The same song again (they said they know it): straight back to play, on the link-out player.
    expect(r.current.step).toBe('play');
    expect(r.current.song?.version.video_id).toBe('vid-a2');
    expect(r.current.playerMode).toBe('linkout');
  });

  it('an embed that never loads (offline) is skipped for this session only after the ready timeout', async () => {
    mockApi.nextVoiceSong.mockResolvedValueOnce(song('a', 1)).mockResolvedValueOnce(song('b', 1));
    const { result: r } = await mount();
    await act(() => r.current.begin(SETUP));
    await act(() => r.current.pickKnow());
    expect(PLAYER_READY_TIMEOUT_MS).toBe(20_000);
    await act(async () => {
      jest.advanceTimersByTime(PLAYER_READY_TIMEOUT_MS - 1);
    });
    expect(mockApi.skipVoiceSong).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    await flush();
    // A timeout doesn't prove YouTube refuses the embed (slow network, stuck WebView): never mark it for everyone.
    expect(mockApi.skipVoiceSong).toHaveBeenCalledWith('s1', { song_key: 'a', reason: 'something_else' });
    expect(r.current.step).toBe('pick');
    expect(r.current.song?.song_key).toBe('b');
  });

  it('skips a song the singer does not know', async () => {
    mockApi.nextVoiceSong.mockResolvedValueOnce(song('a', 1)).mockResolvedValueOnce(song('b', 1));
    const { result: r } = await mount();
    await act(() => r.current.begin(SETUP));
    await act(() => r.current.pickSkip('dont_know'));
    expect(mockApi.skipVoiceSong).toHaveBeenCalledWith('s1', {
      song_key: 'a',
      reason: 'dont_know',
    });
    expect(r.current.step).toBe('pick');
    expect(r.current.song?.song_key).toBe('b');
  });

  it('a skip that went through but whose next song failed retries only the next song', async () => {
    mockApi.nextVoiceSong
      .mockResolvedValueOnce(song('a', 1))
      .mockRejectedValueOnce(network())
      .mockResolvedValueOnce(song('b', 1));
    const { result: r } = await mount();
    await act(() => r.current.begin(SETUP));
    await act(() => r.current.pickSkip('something_else'));
    expect(r.current.error).toBe('network');
    expect(r.current.step).toBe('loading');
    await act(() => r.current.retry());
    expect(mockApi.skipVoiceSong).toHaveBeenCalledTimes(1);
    expect(r.current.error).toBeNull();
    expect(r.current.song?.song_key).toBe('b');
  });

  it('quiz requires Q1 and Q2', async () => {
    mockApi.nextVoiceSong.mockResolvedValueOnce(song('a', 1)).mockResolvedValueOnce(song('b', 2));
    mockApi.postVoiceAttempt.mockResolvedValue({
      attempt_id: 'x1',
      n: 1,
      done: false,
      done_reason: null,
      top_p: 0.4,
    });
    const { result: r } = await mount();
    await act(() => r.current.begin(SETUP));
    await singIt(r);
    await act(() => r.current.submitQuiz());
    expect(mockApi.postVoiceAttempt).not.toHaveBeenCalled();
    act(() => r.current.setAnswer({ feel: 'fine' }));
    await flush();
    await act(() => r.current.submitQuiz());
    expect(mockApi.postVoiceAttempt).not.toHaveBeenCalled();
    expect(r.current.step).toBe('quiz');
    act(() => r.current.setAnswer({ position: 'too_high' }));
    await flush();
    await act(() => r.current.submitQuiz());
    expect(mockApi.postVoiceAttempt).toHaveBeenCalledTimes(1);
    expect(r.current.step).toBe('pick');
  });

  it('attempt failure keeps answers and retries', async () => {
    mockApi.nextVoiceSong.mockResolvedValueOnce(song('a', 1)).mockResolvedValueOnce(song('b', 2));
    mockApi.postVoiceAttempt.mockRejectedValueOnce(network()).mockResolvedValueOnce({
      attempt_id: 'x1',
      n: 1,
      done: false,
      done_reason: null,
      top_p: 0.4,
    });
    mockRec.nextTake = takeWithFile('a');
    const { result: r } = await mount();
    await act(() => r.current.begin(SETUP));
    await singIt(r);
    act(() =>
      r.current.setAnswer({
        feel: 'not_for_me',
        position: 'too_low',
        knew: 'partly',
      }),
    );
    await flush();
    await act(() => r.current.submitQuiz());
    expect(r.current.step).toBe('quiz');
    expect(r.current.error).toBe('network');
    expect(r.current.quiz).toMatchObject({
      feel: 'not_for_me',
      position: 'too_low',
      knew: 'partly',
    });
    expect(useRecordingQueue.getState().items).toHaveLength(0);
    expect(fsState.files.has(`${DIR}/a.wav`)).toBe(true);

    await act(() => r.current.retry());
    expect(mockApi.postVoiceAttempt).toHaveBeenCalledTimes(2);
    expect(mockApi.postVoiceAttempt.mock.calls[1]![1]).toEqual(mockApi.postVoiceAttempt.mock.calls[0]![1]);
    expect(r.current.error).toBeNull();
    expect(r.current.step).toBe('pick');
    expect(useRecordingQueue.getState().items).toHaveLength(1);
  });

  it('restores to quiz after relaunch', async () => {
    mockApi.nextVoiceSong.mockResolvedValueOnce(song('a', 1)).mockResolvedValueOnce(song('b', 2));
    const first = await mount();
    await act(() => first.result.current.begin(SETUP));
    await act(() => first.result.current.pickKnow());
    await act(() => first.result.current.onPlayer({ kind: 'ready' }));
    await act(() => first.result.current.onPlayer({ kind: 'playing' }));
    jest.advanceTimersByTime(60_000);
    first.unmount();

    // Killed mid-song: a later launch reads the phone's copy, then checks decide still has the session active.
    restoreVoiceSession();
    mockApi.getVoiceSession.mockResolvedValue({
      session_id: 's1',
      state: 'active',
      attempts: 0,
      last_offer: song('a', 1),
    });
    mockApi.postVoiceAttempt.mockResolvedValue({
      attempt_id: 'x1',
      n: 1,
      done: false,
      done_reason: null,
      top_p: 0.4,
    });
    const { result: r } = await mount();
    expect(mockApi.getVoiceSession).toHaveBeenCalledWith('s1');
    expect(r.current.step).toBe('quiz');
    expect(r.current.song?.song_key).toBe('a');
    expect(r.current.setup).toEqual(SETUP);
    act(() => r.current.setAnswer({ feel: 'fine', position: 'comfortable' }));
    await flush();
    await act(() => r.current.submitQuiz());
    expect(mockApi.postVoiceAttempt).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({ song_key: 'a', stopped_early: true }),
    );
    expect(r.current.step).toBe('pick');
  });

  it('a relaunch keeps quiz answers already given', async () => {
    mockApi.nextVoiceSong.mockResolvedValueOnce(song('a', 1));
    const first = await mount();
    await act(() => first.result.current.begin(SETUP));
    await singIt(first.result);
    act(() => first.result.current.setAnswer({ feel: 'loved' }));
    await flush();
    first.unmount();
    restoreVoiceSession();
    mockApi.getVoiceSession.mockResolvedValue({
      session_id: 's1',
      state: 'active',
      attempts: 0,
      last_offer: null,
    });
    const { result: r } = await mount();
    expect(r.current.step).toBe('quiz');
    expect(r.current.quiz.feel).toBe('loved');
  });

  it('a relaunch on a session decide has finished shows its result; an abandoned one starts fresh', async () => {
    mockApi.nextVoiceSong.mockResolvedValue(song('a', 1));
    const first = await mount();
    await act(() => first.result.current.begin(SETUP));
    first.unmount();

    restoreVoiceSession();
    mockApi.getVoiceSession.mockResolvedValueOnce({
      session_id: 's1',
      state: 'done',
      attempts: 4,
      done_reason: 'confident',
    });
    const done = await mount();
    expect(done.result.current.step).toBe('result');
    expect(done.result.current.result).toBe(RESULT);
    done.unmount();

    store().clear();
    const again = await mount();
    await act(() => again.result.current.begin(SETUP));
    again.unmount();
    restoreVoiceSession();
    mockApi.getVoiceSession.mockResolvedValueOnce({
      session_id: 's1',
      state: 'abandoned',
      attempts: 0,
      done_reason: null,
    });
    const { result: r } = await mount();
    expect(r.current.step).toBe('intro');
    expect(store().sessionId).toBeNull();
  });

  it('a relaunch while offline keeps the stored step', async () => {
    mockApi.nextVoiceSong.mockResolvedValueOnce(song('a', 1));
    const first = await mount();
    await act(() => first.result.current.begin(SETUP));
    first.unmount();
    restoreVoiceSession();
    mockApi.getVoiceFlags.mockRejectedValue(network());
    mockApi.getVoiceSession.mockRejectedValue(network());
    const { result: r } = await mount();
    expect(r.current.step).toBe('pick');
    expect(r.current.song?.song_key).toBe('a');
  });

  it('stale session (> 6 h) starts fresh', async () => {
    mockApi.nextVoiceSong.mockResolvedValueOnce(song('a', 1));
    const first = await mount();
    await act(() => first.result.current.begin(SETUP));
    await singIt(first.result);
    first.unmount();
    expect(appStorage.getString(VOICE_SESSION_KEY)).toBeDefined();

    jest.setSystemTime(Date.now() + SESSION_MAX_AGE_MS + 1);
    restoreVoiceSession();
    expect(SESSION_MAX_AGE_MS).toBe(6 * 3600_000);
    expect(store().sessionId).toBeNull();
    expect(appStorage.getString(VOICE_SESSION_KEY)).toBeUndefined();
    const { result: r } = await mount();
    expect(mockApi.getVoiceSession).not.toHaveBeenCalled();
    expect(r.current.step).toBe('intro');
    expect(r.current.song).toBeNull();
  });

  it('disabled flag shows disabled', async () => {
    mockApi.getVoiceFlags.mockResolvedValue({
      session_enabled: false,
      is_admin: false,
      voice_data: false,
    });
    const { result: r } = await mount();
    expect(r.current.step).toBe('disabled');
  });

  it('a 403 voice_session_disabled from decide shows disabled', async () => {
    mockApi.createVoiceSession.mockRejectedValue(new ApiError(403, 'voice_session_disabled'));
    const { result: r } = await mount();
    await act(() => r.current.begin(SETUP));
    expect(r.current.step).toBe('disabled');
  });

  it('finish mid-play goes to result', async () => {
    mockApi.nextVoiceSong.mockResolvedValueOnce(song('a', 1));
    mockRec.nextTake = takeWithFile('a');
    const { result: r } = await mount();
    await act(() => r.current.begin(SETUP));
    await act(() => r.current.pickKnow());
    await act(() => r.current.onPlayer({ kind: 'ready' }));
    await act(() => r.current.onPlayer({ kind: 'playing' }));
    await act(() => r.current.finish());
    expect(mockRec.stop).toHaveBeenCalled();
    expect(mockApi.postVoiceAttempt).not.toHaveBeenCalled();
    expect(fsState.files.has(`${DIR}/a.wav`)).toBe(false);
    expect(mockApi.getVoiceResult).toHaveBeenCalledWith('s1');
    expect(r.current.step).toBe('result');
    expect(r.current.result).toBe(RESULT);
  });

  it('stop early goes to quiz and reports stopped_early', async () => {
    mockApi.nextVoiceSong.mockResolvedValueOnce(song('a', 1)).mockResolvedValueOnce(song('b', 2));
    mockApi.postVoiceAttempt.mockResolvedValue({
      attempt_id: 'x1',
      n: 1,
      done: false,
      done_reason: null,
      top_p: 0.4,
    });
    const { result: r } = await mount();
    await act(() => r.current.begin(SETUP));
    await act(() => r.current.pickKnow());
    await act(() => r.current.onPlayer({ kind: 'ready' }));
    await act(() => r.current.onPlayer({ kind: 'playing' }));
    await act(() => r.current.stopEarly());
    expect(r.current.step).toBe('quiz');
    expect(r.current.prefill).toBeNull();
    act(() => r.current.setAnswer({ feel: 'fine', position: 'both_ends' }));
    await flush();
    await act(() => r.current.submitQuiz());
    expect(mockApi.postVoiceAttempt).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({ stopped_early: true, pitch: null }),
    );
  });

  it('a 409 max_attempts on an attempt goes to the result', async () => {
    mockApi.nextVoiceSong.mockResolvedValueOnce(song('a', 12));
    mockApi.postVoiceAttempt.mockRejectedValue(new ApiError(409, 'max_attempts'));
    // decide never recorded this attempt (11 < 12): the take has no attempt to belong to.
    mockApi.getVoiceSession.mockResolvedValue({ session_id: 's1', state: 'done', attempts: 11, last_offer: null });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockRec.nextTake = takeWithFile('a');
    const { result: r } = await mount();
    await act(() => r.current.begin(SETUP));
    await singIt(r);
    act(() => r.current.setAnswer({ feel: 'fine', position: 'comfortable' }));
    await flush();
    await act(() => r.current.submitQuiz());
    expect(r.current.step).toBe('result');
    expect(useRecordingQueue.getState().items).toHaveLength(0);
    expect(fsState.files.has(`${DIR}/a.wav`)).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('attempt not recorded, take dropped'));
    warn.mockRestore();
  });

  it('a done reply from next goes to the result', async () => {
    mockApi.nextVoiceSong.mockResolvedValueOnce({
      kind: 'done',
      reason: 'no_candidates',
    });
    const { result: r } = await mount();
    await act(() => r.current.begin(SETUP));
    expect(r.current.step).toBe('result');
  });

  it('503 warming_up keeps the step with a retryable error', async () => {
    mockApi.nextVoiceSong.mockRejectedValueOnce(new ApiError(503, 'warming_up')).mockResolvedValueOnce(song('a', 1));
    const { result: r } = await mount();
    await act(() => r.current.begin(SETUP));
    expect(r.current.step).toBe('loading');
    expect(r.current.error).toBe('warming_up');
    await act(() => r.current.retry());
    expect(r.current.error).toBeNull();
    expect(r.current.step).toBe('pick');
  });

  it('a network error on begin keeps setup', async () => {
    mockApi.createVoiceSession.mockRejectedValueOnce(network());
    const { result: r } = await mount();
    act(() => r.current.openSetup());
    await flush();
    await act(() => r.current.begin(SETUP));
    expect(r.current.step).toBe('setup');
    expect(r.current.error).toBe('network');
  });

  it('consent turned off mid-song: the take is not queued and the session uploads are dropped', async () => {
    mockApi.nextVoiceSong.mockResolvedValueOnce(song('a', 1)).mockResolvedValueOnce(song('b', 2));
    mockApi.postVoiceAttempt.mockResolvedValue({
      attempt_id: 'x1',
      n: 1,
      done: false,
      done_reason: null,
      top_p: 0.4,
    });
    const dropSession = jest.spyOn(useRecordingQueue.getState(), 'dropSession');
    mockRec.nextTake = takeWithFile('a');
    const { result: r } = await mount();
    await act(() => r.current.begin(SETUP));
    await act(() => r.current.pickKnow());
    await act(() => r.current.onPlayer({ kind: 'ready' }));
    await act(() => r.current.patchContext({ record: false }));
    expect(mockApi.patchVoiceSession).toHaveBeenCalledWith('s1', {
      record: false,
    });
    expect(dropSession).toHaveBeenCalledWith('s1');
    expect(r.current.setup?.record).toBe(false);
    await act(() => r.current.onPlayer({ kind: 'ended' }));
    expect(fsState.files.has(`${DIR}/a.wav`)).toBe(false);
    act(() => r.current.setAnswer({ feel: 'fine', position: 'comfortable' }));
    await flush();
    await act(() => r.current.submitQuiz());
    expect(useRecordingQueue.getState().items).toHaveLength(0);
  });

  it('"getting warm" (Q7 warm) patches the setup warmth locally', async () => {
    mockApi.nextVoiceSong.mockResolvedValueOnce(song('a', 1)).mockResolvedValueOnce(song('b', 2));
    mockApi.postVoiceAttempt.mockResolvedValue({
      attempt_id: 'x1',
      n: 1,
      done: false,
      done_reason: null,
      top_p: 0.4,
    });
    const { result: r } = await mount();
    await act(() => r.current.begin({ ...SETUP, warmth: 'cold' }));
    await singIt(r);
    act(() =>
      r.current.setAnswer({
        feel: 'fine',
        position: 'comfortable',
        voiceNow: 'warm',
      }),
    );
    await flush();
    await act(() => r.current.submitQuiz());
    expect(r.current.setup?.warmth).toBe('warm');
  });

  it('warm-up runs the recorder without recording for the live ribbon', async () => {
    const { result: r } = await mount();
    act(() => r.current.openSetup());
    await flush();
    await act(() => r.current.startWarmup(0.02));
    expect(r.current.step).toBe('warmup');
    expect(mockRec.opts).toEqual({ record: false, floor: 0.02, onHeldNote: expect.any(Function) });
    expect(mockRec.start).toHaveBeenCalled();
    await act(() => r.current.endWarmup());
    expect(mockRec.stop).toHaveBeenCalled();
    expect(r.current.step).toBe('setup');
  });

  it('sweeps recording files nothing references on mount', async () => {
    const queued = `${DIR}/queued.wav`;
    fsState.files.set(queued, new Uint8Array(8));
    useRecordingQueue.getState().enqueue({
      sessionId: 's0',
      attemptN: 1,
      uri: queued,
      contentType: 'audio/wav',
      durationS: 5,
      device: null,
    });
    const orphanWav = `${DIR}/killed.wav`;
    const orphanAac = 'file:///document/ExpoAudio/recording-123.m4a';
    const otherAac = 'file:///document/Audio/recording-456.m4a';
    const unrelated = 'file:///document/ExpoAudio/notes.txt';
    for (const u of [orphanWav, orphanAac, otherAac, unrelated]) fsState.files.set(u, new Uint8Array(8));
    for (const d of [DIR, 'file:///document/ExpoAudio', 'file:///document/Audio']) fsState.dirs.add(d);
    await mount();
    expect(fsState.files.has(queued)).toBe(true);
    expect(fsState.files.has(orphanWav)).toBe(false);
    expect(fsState.files.has(orphanAac)).toBe(false);
    expect(fsState.files.has(otherAac)).toBe(false);
    expect(fsState.files.has(unrelated)).toBe(true);
  });

  describe('fix round 1', () => {
    it('double taps: begin, pickSkip and submitQuiz each call decide once', async () => {
      const created = deferred<{ session_id: string; state: string }>();
      mockApi.createVoiceSession.mockReturnValueOnce(created.promise);
      mockApi.nextVoiceSong
        .mockResolvedValueOnce(song('a', 1))
        .mockResolvedValueOnce(song('b', 1))
        .mockResolvedValueOnce(song('c', 2));
      const skipped = deferred<void>();
      mockApi.skipVoiceSong.mockReturnValueOnce(skipped.promise);
      const posted = deferred<unknown>();
      mockApi.postVoiceAttempt.mockReturnValueOnce(posted.promise);
      const { result: r } = await mount();

      let first!: Promise<void>;
      await act(async () => {
        first = r.current.begin(SETUP);
        void r.current.begin(SETUP);
      });
      expect(r.current.busy).toBe(true);
      await act(async () => {
        created.resolve({ session_id: 's1', state: 'active' });
        await first;
      });
      expect(mockApi.createVoiceSession).toHaveBeenCalledTimes(1);
      expect(r.current.busy).toBe(false);
      expect(r.current.step).toBe('pick');

      await act(async () => {
        first = r.current.pickSkip('dont_know');
        void r.current.pickSkip('dont_know');
      });
      await act(async () => {
        skipped.resolve();
        await first;
      });
      expect(mockApi.skipVoiceSong).toHaveBeenCalledTimes(1);
      expect(r.current.song?.song_key).toBe('b');

      await singIt(r);
      act(() => r.current.setAnswer({ feel: 'fine', position: 'comfortable' }));
      await act(async () => {
        first = r.current.submitQuiz();
        void r.current.submitQuiz();
      });
      await act(async () => {
        posted.resolve({ attempt_id: 'x1', n: 1, done: false, done_reason: null, top_p: 0.4 });
        await first;
      });
      expect(mockApi.postVoiceAttempt).toHaveBeenCalledTimes(1);
      expect(r.current.song?.song_key).toBe('c');
    });

    it('reset() during an in-flight next song leaves the session cleared (no stray pick)', async () => {
      const next = deferred<NextVoiceSong>();
      mockApi.nextVoiceSong.mockReturnValueOnce(next.promise);
      const { result: r } = await mount();
      let begun!: Promise<void>;
      await act(async () => {
        begun = r.current.begin(SETUP);
      });
      expect(r.current.step).toBe('loading');
      act(() => r.current.reset());
      await act(async () => {
        next.resolve(song('a', 1));
        await begun;
      });
      expect(store().sessionId).toBeNull();
      expect(store().song).toBeNull();
      expect(r.current.step).toBe('intro');
      expect(appStorage.getString(VOICE_SESSION_KEY)).toBeUndefined();
    });

    it('an offline relaunch at loading asks for the next song again, so the error and retry show', async () => {
      mockApi.nextVoiceSong.mockRejectedValueOnce(network());
      const first = await mount();
      await act(() => first.result.current.begin(SETUP));
      expect(first.result.current.step).toBe('loading');
      first.unmount();

      restoreVoiceSession();
      mockApi.getVoiceFlags.mockRejectedValue(network());
      mockApi.getVoiceSession.mockRejectedValue(network());
      mockApi.nextVoiceSong.mockRejectedValueOnce(network()).mockResolvedValueOnce(song('a', 1));
      const { result: r } = await mount();
      expect(r.current.step).toBe('loading');
      expect(r.current.error).toBe('network');
      await act(() => r.current.retry());
      expect(r.current.error).toBeNull();
      expect(r.current.step).toBe('pick');
    });

    it('a relaunch whose attempt decide already has re-sends the same body and queues the take under its n', async () => {
      mockApi.nextVoiceSong.mockResolvedValueOnce(song('a', 1)).mockResolvedValueOnce(song('b', 2));
      mockApi.postVoiceAttempt.mockReturnValueOnce(new Promise(() => {})); // the app dies while it is in flight
      mockRec.nextTake = takeWithFile('a');
      const first = await mount();
      await act(() => first.result.current.begin(SETUP));
      await singIt(first.result);
      act(() => first.result.current.setAnswer({ feel: 'loved', position: 'comfortable' }));
      await act(async () => {
        void first.result.current.submitQuiz();
      });
      const sent = mockApi.postVoiceAttempt.mock.calls[0]![1];
      first.unmount();

      jest.advanceTimersByTime(3600_000);
      restoreVoiceSession();
      mockApi.getVoiceSession.mockResolvedValue({ session_id: 's1', state: 'active', attempts: 1, last_offer: null });
      // decide dedupes on session + song + started_at and answers with the existing attempt.
      mockApi.postVoiceAttempt.mockResolvedValueOnce({
        attempt_id: 'x1',
        n: 1,
        done: false,
        done_reason: null,
        top_p: 0.4,
      });
      const { result: r } = await mount();
      expect(mockApi.postVoiceAttempt).toHaveBeenCalledTimes(2);
      expect(mockApi.postVoiceAttempt.mock.calls[1]![1]).toEqual(sent);
      expect(useRecordingQueue.getState().items).toEqual([
        expect.objectContaining({ sessionId: 's1', attemptN: 1, uri: `${DIR}/a.wav` }),
      ]);
      expect(r.current.step).toBe('pick');
      expect(r.current.song?.song_key).toBe('b');
    });

    it('a retried attempt refused with 409 (the lost reply ended the session) still queues the take under its n', async () => {
      mockApi.nextVoiceSong.mockResolvedValueOnce(song('a', 3));
      mockApi.postVoiceAttempt
        .mockRejectedValueOnce(network())
        .mockRejectedValueOnce(new ApiError(409, 'session_not_active'));
      mockApi.getVoiceSession.mockResolvedValue({ session_id: 's1', state: 'done', attempts: 3, last_offer: null });
      mockRec.nextTake = takeWithFile('a');
      const { result: r } = await mount();
      await act(() => r.current.begin(SETUP));
      await singIt(r);
      act(() => r.current.setAnswer({ feel: 'fine', position: 'comfortable' }));
      await act(() => r.current.submitQuiz());
      await act(() => r.current.retry());
      expect(useRecordingQueue.getState().items).toEqual([
        expect.objectContaining({ attemptN: 3, uri: `${DIR}/a.wav` }),
      ]);
      expect(r.current.step).toBe('result');
    });

    it('leaving play for disabled stops and drops the running take', async () => {
      mockApi.nextVoiceSong.mockResolvedValueOnce(song('a', 1));
      mockApi.patchVoiceSession.mockRejectedValueOnce(new ApiError(403, 'voice_session_disabled'));
      mockRec.nextTake = takeWithFile('a');
      const { result: r } = await mount();
      await act(() => r.current.begin(SETUP));
      await act(() => r.current.pickKnow());
      await act(() => r.current.onPlayer({ kind: 'ready' }));
      await act(() => r.current.patchContext({ posture: 'sitting' }));
      expect(r.current.step).toBe('disabled');
      expect(mockRec.stop).toHaveBeenCalled();
      expect(fsState.files.has(`${DIR}/a.wav`)).toBe(false);
    });
  });

  describe('fix round 2', () => {
    it('record:false tapped during an in-flight submitQuiz still drops the queue and the take, then sends the PATCH', async () => {
      mockApi.nextVoiceSong.mockResolvedValueOnce(song('a', 2)).mockResolvedValueOnce(song('b', 3));
      const posted = deferred<unknown>();
      mockApi.postVoiceAttempt.mockReturnValueOnce(posted.promise);
      const { result: r } = await mount();
      await act(() => r.current.begin(SETUP));
      // An earlier song's take still waiting to upload.
      const earlier = `${DIR}/earlier.wav`;
      fsState.files.set(earlier, new Uint8Array(8));
      useRecordingQueue
        .getState()
        .enqueue({ sessionId: 's1', attemptN: 1, uri: earlier, contentType: 'audio/wav', durationS: 9, device: null });
      mockRec.nextTake = takeWithFile('a');
      await singIt(r);
      act(() => r.current.setAnswer({ feel: 'fine', position: 'comfortable' }));

      let submitting!: Promise<void>;
      await act(async () => {
        submitting = r.current.submitQuiz();
      });
      expect(r.current.busy).toBe(true);
      await act(() => r.current.patchContext({ record: false }));
      // Local effects at once, while the attempt is still in flight.
      expect(r.current.setup?.record).toBe(false);
      expect(useRecordingQueue.getState().items).toEqual([]);
      expect(fsState.files.has(earlier)).toBe(false);
      expect(fsState.files.has(`${DIR}/a.wav`)).toBe(false);
      expect(mockApi.patchVoiceSession).not.toHaveBeenCalled();

      await act(async () => {
        posted.resolve({ attempt_id: 'x2', n: 2, done: false, done_reason: null, top_p: 0.4 });
        await submitting;
      });
      await flush();
      expect(mockApi.patchVoiceSession).toHaveBeenCalledWith('s1', { record: false });
      expect(useRecordingQueue.getState().items).toEqual([]);
      expect(r.current.step).toBe('pick');
      expect(r.current.busy).toBe(false);
    });

    it('a PATCH that fails offline is sent again after the next action', async () => {
      mockApi.nextVoiceSong.mockResolvedValueOnce(song('a', 1)).mockResolvedValueOnce(song('b', 1));
      mockApi.patchVoiceSession.mockRejectedValueOnce(network());
      const { result: r } = await mount();
      await act(() => r.current.begin(SETUP));
      await act(() => r.current.patchContext({ record: false }));
      expect(r.current.error).toBeNull();
      expect(useRecordingQueue.getState().items).toEqual([]);
      await act(() => r.current.pickSkip('dont_know'));
      await flush();
      expect(mockApi.patchVoiceSession).toHaveBeenCalledTimes(2);
      expect(mockApi.patchVoiceSession).toHaveBeenLastCalledWith('s1', { record: false });
    });

    it('after reset() with a hung request pending, busy is false and a new session can start', async () => {
      mockApi.createVoiceSession.mockReturnValueOnce(new Promise(() => {}));
      mockApi.nextVoiceSong.mockResolvedValueOnce(song('a', 1));
      const { result: r } = await mount();
      await act(async () => {
        void r.current.begin(SETUP);
      });
      expect(r.current.busy).toBe(true);
      act(() => r.current.reset());
      expect(r.current.busy).toBe(false);
      await act(() => r.current.begin(SETUP));
      expect(mockApi.createVoiceSession).toHaveBeenCalledTimes(2);
      expect(r.current.step).toBe('pick');
    });
  });

  describe('falsetto batch (M6–M8)', () => {
    const CONTOUR = { t0: 0.5, dt: 0.1, midi: [57, 57.02, null, 64] };
    const HELD = [{ start: 0.5, end: 1.4, midi: 57, note: 57 }];

    it('session store persists and restores contour/labels', async () => {
      mockApi.nextVoiceSong.mockResolvedValueOnce(song('a', 1));
      mockRec.nextTake = { pitch: PITCH, file: null, contour: CONTOUR, held: HELD, takeOffsetS: 1.25 };
      const first = await mount();
      await act(() => first.result.current.begin(SETUP));
      await singIt(first.result);
      expect(store()).toMatchObject({ step: 'quiz', contour: CONTOUR, held: HELD, takeOffsetS: 1.25 });
      const label = { tStart: 0.5, tEnd: 1.4, midi: 57, label: 'unsure' as const, source: 'live' as const };
      act(() => store().update({ noteLabels: [label], candidates: [{ tStart: 0.5, tEnd: 1.4, midi: 57 }] }));
      first.unmount();

      useVoiceSessionStore.setState({ contour: null, held: [], noteLabels: [], candidates: [] });
      restoreVoiceSession();
      expect(store()).toMatchObject({
        step: 'quiz',
        contour: CONTOUR,
        held: HELD,
        takeOffsetS: 1.25,
        noteLabels: [label],
        candidates: [{ tStart: 0.5, tEnd: 1.4, midi: 57 }],
      });
    });

    it('a copy stored before the falsetto fields still resumes (empty contour, no labels)', () => {
      const old = {
        sessionId: 's1',
        setup: SETUP,
        floor: 0.003,
        song: song('a', 1),
        step: 'quiz',
        attemptN: 1,
        quiz: {},
        pitch: PITCH,
        playStartedAt: T0 - 1000,
        playEndedAt: T0,
        stoppedEarly: false,
        take: null,
        savedAt: T0,
      };
      appStorage.set(VOICE_SESSION_KEY, JSON.stringify(old));
      restoreVoiceSession();
      expect(store()).toMatchObject({
        sessionId: 's1',
        step: 'quiz',
        contour: null,
        held: [],
        noteLabels: [],
        candidates: [],
        takeOffsetS: 0,
      });
    });
  
    const ESTIMATE = { low: 48, high: 59, sd_high: 2, source: 'model' as const };
    /** begin → pick → ready (the detector arms) → playing. */
    async function playing(over: Parameters<typeof song>[2] = {}, setup: SessionSetup = SETUP) {
      mockApi.nextVoiceSong.mockResolvedValueOnce(song('a', 1, over));
      const h = await mount();
      await act(() => h.result.current.begin(setup));
      await act(() => h.result.current.pickKnow());
      await act(() => h.result.current.onPlayer({ kind: 'ready' }));
      await act(() => h.result.current.onPlayer({ kind: 'playing' }));
      return h;
    }

    it('chip appears for a candidate and hides after 5 s', async () => {
      const { result: r } = await playing({ comfort_estimate: ESTIMATE });
      heard(note(10, 11, 62)); // 3 above: chest
      expect(r.current.falsettoChip).toBeNull();
      heard(note(20, 21.5, 69));
      expect(r.current.falsettoChip).toEqual({ tStart: 20, tEnd: 21.5, midi: 69 });
      act(() => jest.advanceTimersByTime(4900));
      expect(r.current.falsettoChip).not.toBeNull();
      act(() => jest.advanceTimersByTime(200));
      expect(r.current.falsettoChip).toBeNull();
      // Unanswered: the quiz asks about it.
      await act(() => r.current.onPlayer({ kind: 'ended' }));
      expect(store().candidates).toEqual([{ tStart: 20, tEnd: 21.5, midi: 69 }]);
      expect(store().noteLabels).toEqual([]);
    });

    it('yes records live falsetto label', async () => {
      const { result: r } = await playing({ comfort_estimate: ESTIMATE });
      heard(note(20, 21.5, 69));
      act(() => r.current.answerFalsetto(r.current.falsettoChip!, 'falsetto'));
      expect(r.current.falsettoChip).toBeNull();
      expect(store().noteLabels).toEqual([{ tStart: 20, tEnd: 21.5, midi: 69, label: 'falsetto', source: 'live' }]);
    });

    it('no chip without a chest reference', async () => {
      // No estimate and no profile on the phone.
      const a = await playing();
      heard(note(20, 21.5, 80));
      expect(a.result.current.falsettoChip).toBeNull();
      a.unmount();
      store().clear();
      // A model estimate that is still too unsure (sd_high > 3) and no profile on the phone.
      const b = await playing({ comfort_estimate: { ...ESTIMATE, sd_high: 5 } });
      heard(note(20, 21.5, 80));
      expect(b.result.current.falsettoChip).toBeNull();
    });

    it("an unsure model estimate falls back to the phone's comfort top; measured is used whatever its spread", async () => {
      act(() => useVoiceStore.getState().save(profileFromSelfReport('baritone', '2026-10-01T00:00:00Z')));
      const top = useVoiceStore.getState().profile!.comfortHigh;
      const a = await playing({ comfort_estimate: { ...ESTIMATE, sd_high: 5 } });
      heard(note(20, 21.5, top + 3));
      expect(a.result.current.falsettoChip).toBeNull();
      heard(note(30, 31.5, top + 4));
      expect(a.result.current.falsettoChip?.midi).toBe(top + 4);
      a.unmount();
      store().clear();
      const b = await playing({ comfort_estimate: { low: 48, high: 59, sd_high: 6, source: 'measured' } });
      heard(note(20, 21.5, 63));
      expect(b.result.current.falsettoChip?.midi).toBe(63);
    });

    it('setup "uses falsetto: yes" lowers the offset to 3', async () => {
      const { result: r } = await playing({ comfort_estimate: ESTIMATE }, { ...SETUP, uses_falsetto: 'yes' });
      heard(note(20, 21.5, 62));
      expect(r.current.falsettoChip?.midi).toBe(62);
    });

    it('player never paused by chip', async () => {
      const { result: r } = await playing({ comfort_estimate: ESTIMATE });
      expect(player.play).toHaveBeenCalledTimes(1);
      heard(note(20, 21.5, 69));
      act(() => r.current.answerFalsetto(r.current.falsettoChip!, 'full'));
      heard(note(45, 46.5, 70));
      act(() => jest.advanceTimersByTime(6000));
      expect(player.pause).not.toHaveBeenCalled();
      expect(player.play).toHaveBeenCalledTimes(1);
      expect(r.current.step).toBe('play');
    });

    it('two candidates within 20 s show one chip', async () => {
      const { result: r } = await playing({ comfort_estimate: ESTIMATE });
      heard(note(20, 21.5, 69));
      act(() => jest.advanceTimersByTime(5000));
      expect(r.current.falsettoChip).toBeNull();
      heard(note(30, 31.5, 69));
      expect(r.current.falsettoChip).toBeNull();
      await act(() => r.current.onPlayer({ kind: 'ended' }));
      expect(store().candidates).toHaveLength(2);
    });

    it('the chip goes away when the song ends; the warm-up never asks', async () => {
      const { result: r } = await playing({ comfort_estimate: ESTIMATE });
      heard(note(20, 21.5, 69));
      await act(() => r.current.onPlayer({ kind: 'ended' }));
      expect(r.current.falsettoChip).toBeNull();
      heard(note(40, 41.5, 72));
      expect(r.current.falsettoChip).toBeNull();
    });
  
    /** Steady notes at 100 frames a second. */
    const framesFor = (notes: { midi: number; dur: number }[]): VoicedFrame[] => {
      const out: VoicedFrame[] = [];
      for (const n of notes) for (let i = 0; i < Math.round(n.dur * 100); i++) out.push({ t: out.length / 100, midi: n.midi });
      return out;
    };
    /** 24 s of chest 50..57, then 6 s of A4 (69): a real take's pitch, contour and held notes. */
    const sungTake = (): SongTake => {
      const frames = framesFor([...Array.from({ length: 8 }, (_, i) => ({ midi: 50 + i, dur: 3 })), { midi: 69, dur: 6 }]);
      const held = findHeldNotes(frames);
      return { pitch: summarizeSongPitch(frames, held), file: null, contour: contourFrom(frames), held, takeOffsetS: 0 };
    };
    const A4 = (h: HeldNote[]) => {
      const n = h.find((x) => x.note === 69)!;
      return { tStart: n.start, tEnd: n.end, midi: 69 };
    };
    async function atQuiz() {
      mockApi.nextVoiceSong.mockResolvedValueOnce(song('a', 1)).mockResolvedValueOnce(song('b', 2));
      mockApi.postVoiceAttempt.mockResolvedValue({ attempt_id: 'x1', n: 1, done: false, done_reason: null, top_p: 0.4 });
      mockRec.nextTake = sungTake();
      const h = await mount();
      await act(() => h.result.current.begin(SETUP));
      await singIt(h.result);
      act(() => h.result.current.setAnswer({ feel: 'fine', position: 'comfortable' }));
      return h;
    }
    const body = () => mockApi.postVoiceAttempt.mock.calls[0]![1];

    it('catch-up lists unanswered candidates, max 3, highest first', async () => {
      const { result: r } = await atQuiz();
      const c = (t: number, m: number) => ({ tStart: t, tEnd: t + 1, midi: m });
      act(() =>
        store().update({
          candidates: [c(10, 64), c(30, 69), c(50, 66), c(70, 70), c(90, 65)],
          noteLabels: [{ ...c(70, 70), label: 'falsetto', source: 'live' }],
        }),
      );
      expect(r.current.catchUp).toEqual([c(30, 69), c(50, 66), c(90, 65)]);
      // A quiz answer keeps its row (shown as answered).
      act(() => r.current.answerFalsetto(c(30, 69), 'unsure', 'quiz'));
      expect(r.current.catchUp).toEqual([c(30, 69), c(50, 66), c(90, 65)]);
      // One label per note: answering again replaces it.
      act(() => r.current.answerFalsetto(c(30, 69), 'falsetto', 'quiz'));
      expect(store().noteLabels.filter((l) => l.tStart === 30)).toEqual([{ ...c(30, 69), label: 'falsetto', source: 'quiz' }]);
    });

    it('submit sends chest-only pitch, pitch_all and note_labels', async () => {
      const { result: r } = await atQuiz();
      const a4 = A4(store().held);
      act(() => r.current.answerFalsetto(a4, 'falsetto', 'quiz'));
      await act(() => r.current.submitQuiz());
      const b = body();
      expect(b.pitch_all).toEqual(expect.objectContaining({ held_high: 69 }));
      expect(b.pitch).toEqual(expect.objectContaining({ held_high: 57, held_count: 8 }));
      expect(b.pitch.p90).toBeLessThanOrEqual(57);
      expect(b.note_labels).toEqual([
        { t_start: expect.any(Number), t_end: expect.any(Number), midi: 69, label: 'falsetto', source: 'quiz' },
      ]);
    });

    it('submit without answering still works (pitch as sung, no labels)', async () => {
      const { result: r } = await atQuiz();
      act(() => store().update({ candidates: [A4(store().held)] }));
      await act(() => r.current.submitQuiz());
      const b = body();
      expect(b.pitch).toEqual(expect.objectContaining({ held_high: 69 }));
      expect(b.pitch_all).toEqual(b.pitch);
      expect(b).not.toHaveProperty('note_labels');
      expect(r.current.step).toBe('pick');
    });

    it('restore after kill keeps labels', async () => {
      const first = await atQuiz();
      const a4 = A4(store().held);
      act(() => first.result.current.answerFalsetto(a4, 'falsetto', 'quiz'));
      first.unmount();
      restoreVoiceSession();
      mockApi.getVoiceSession.mockResolvedValue({ session_id: 's1', state: 'active', attempts: 0, last_offer: song('a', 1) });
      const { result: r } = await mount();
      expect(r.current.step).toBe('quiz');
      await act(() => r.current.submitQuiz());
      expect(body().note_labels).toHaveLength(1);
      expect(body().pitch.held_high).toBe(57);
    });
  
    it('adoptResult saves the session result as the voice and marks the result saved', async () => {
      mockApi.nextVoiceSong.mockResolvedValueOnce(song('a', 1));
      mockApi.getVoiceResult.mockResolvedValue({ ...(RESULT as object), profile_saved: false, suited: [], loved: [] });
      const PROFILE = {
        low_midi: 45, high_midi: 64, comfort_low: 49, comfort_high: 59, voice_type: 'baritone', voice_type_between: null,
        register: null, confidence: 'low', method: 'session', measured_at: '2026-10-25T20:00:00Z', updated_at: '2026-10-25T20:00:00Z',
        evidence_count: 2, session_id: 's1',
      };
      mockApi.adoptVoiceSession.mockResolvedValue(PROFILE);
      const { result: r } = await mount();
      await act(() => r.current.begin(SETUP));
      await act(() => r.current.finish());
      expect(r.current.step).toBe('result');
      let ok = false;
      await act(async () => {
        ok = await r.current.adoptResult();
      });
      expect(ok).toBe(true);
      expect(mockApi.adoptVoiceSession).toHaveBeenCalledWith('s1');
      expect(r.current.result?.profile_saved).toBe(true);
      expect(useVoiceStore.getState().profile).toMatchObject({ method: 'session', voiceType: 'baritone', sessionId: 's1' });
    });

    it('adoptResult failing (409 no_evidence, offline) returns false and changes nothing', async () => {
      mockApi.nextVoiceSong.mockResolvedValueOnce(song('a', 1));
      mockApi.getVoiceResult.mockResolvedValue({ ...(RESULT as object), profile_saved: false, suited: [], loved: [] });
      mockApi.adoptVoiceSession.mockRejectedValue(new ApiError(409, 'no_evidence'));
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const { result: r } = await mount();
      await act(() => r.current.begin(SETUP));
      await act(() => r.current.finish());
      let ok = true;
      await act(async () => {
        ok = await r.current.adoptResult();
      });
      expect(ok).toBe(false);
      expect(r.current.result?.profile_saved).toBe(false);
      expect(useVoiceStore.getState().profile).toBeNull();
      warn.mockRestore();
    });
  });
});
