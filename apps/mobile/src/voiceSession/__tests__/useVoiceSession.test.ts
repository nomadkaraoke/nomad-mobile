// useVoiceSession: the voice session's state machine (Phase 3d D5) over mocked decide calls, a fake song recorder
// and fake timers; sessionStore's resume window (Review Focus 2).
import { ApiError, type NextVoiceSong, type SessionSetup } from '@nomad/api-decide';
import { act, renderHook } from '@testing-library/react-native';

import { appStorage } from '../../storage';
import { fsState } from '../../test-utils/memoryFs';
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
}));

/** The fake recorder: records call order and hands back `nextTake` on stop(). */
const mockOrder: string[] = [];
const mockRec = {
  opts: null as null | { record: boolean; floor: number },
  nextTake: { pitch: null, file: null } as SongTake,
  start: jest.fn(async () => void mockOrder.push('recorder.start')),
  stop: jest.fn(async (): Promise<SongTake> => {
    mockOrder.push('recorder.stop');
    return mockRec.nextTake;
  }),
};
jest.mock('../recording/useSongRecorder', () => ({
  useSongRecorder: (_src: unknown, opts: { record: boolean; floor: number }) => {
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
  };
};

const network = () => new TypeError('Network request failed');
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
  mockRec.nextTake = { pitch: null, file: null };
  player.play.mockClear();
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
    expect(mockRec.opts).toEqual({ record: true, floor: 0.01 });

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

  it('an embed that never loads (offline) is skipped as unplayable after the ready timeout', async () => {
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
    expect(mockApi.skipVoiceSong).toHaveBeenCalledWith('s1', {
      song_key: 'a',
      reason: 'not_embeddable',
      video_id: 'vid-a',
    });
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
    expect(mockRec.opts).toEqual({ record: false, floor: 0.02 });
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
});
