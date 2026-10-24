import { act, renderHook } from '@testing-library/react-native';
import * as audio from 'expo-audio';
import { Platform } from 'react-native';
import { fsState } from '../../test-utils/memoryFs';
import type { PcmBuffer, PitchSource } from '../../voice/pitchSource';
import { AAC_RECORDING_OPTIONS } from '../recording/aacSink';
import { SESSION_AUDIO_MODE, useSongRecorder } from '../recording/useSongRecorder';

// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories can't use imports
jest.mock('expo-file-system', () => require('../../test-utils/memoryFs'));
jest.mock('expo-audio', () => {
  const { useEffect } = jest.requireActual('react');
  // Like expo-audio's shared object: once released (the hook's own passive cleanup on unmount), every member throws.
  let released = false;
  let uri: string | null = null;
  const live = <T,>(v: T): T => {
    if (released) throw new Error('FunctionCallException: native recorder released');
    return v;
  };
  const recorder = {
    get uri() {
      return live(uri);
    },
    set uri(v: string | null) {
      uri = v;
    },
    prepareToRecordAsync: jest.fn(async () => {}),
    record: jest.fn(),
    stop: jest.fn(async () => {}),
    getStatus: jest.fn(() => ({ durationMillis: 0 })),
    __release: () => void (released = true),
    __reset: () => void (released = false),
    __live: live,
  };
  return {
    setAudioModeAsync: jest.fn(async () => {}),
    useAudioRecorder: jest.fn(() => {
      useEffect(() => () => recorder.__release(), []);
      return recorder;
    }),
    IOSOutputFormat: { MPEG4AAC: 'aac ' },
    AudioQuality: { MEDIUM: 64 },
    __recorder: recorder,
  };
});

const mocked = audio as unknown as {
  setAudioModeAsync: jest.Mock;
  useAudioRecorder: jest.Mock;
  __recorder: {
    uri: string | null;
    prepareToRecordAsync: jest.Mock;
    record: jest.Mock;
    stop: jest.Mock;
    getStatus: jest.Mock;
    __release(): void;
    __reset(): void;
    __live<T>(v: T): T;
  };
};

const RATE = 16000;
const AAC_URI = 'file:///document/recording-1.m4a';

/** A controllable source: start() resolves when the test says so; `emit` feeds it PCM. */
function fakeSource(kind: 'mic' | 'fake', order: string[] = []) {
  let onBuffer: ((b: PcmBuffer) => void) | null = null;
  const src = {
    kind,
    requestPermission: jest.fn(async () => 'granted' as const),
    checkPermission: jest.fn(async () => 'granted' as const),
    start: jest.fn(async (cb: (b: PcmBuffer) => void, section: string) => {
      order.push(`stream.start:${section}`);
      onBuffer = cb;
    }),
    stop: jest.fn(() => {
      order.push('stream.stop');
      onBuffer = null;
    }),
  };
  let pos = 0;
  /** `seconds` of a sine at `hz` (amplitude 0.3), in 100 ms buffers. */
  const emit = (hz: number, seconds: number) => {
    const n = Math.round(seconds * RATE);
    for (let start = 0; start < n; start += 1600) {
      const samples = new Float32Array(Math.min(1600, n - start));
      for (let i = 0; i < samples.length; i++) samples[i] = 0.3 * Math.sin((2 * Math.PI * hz * (pos + i)) / RATE);
      onBuffer?.({ samples, sampleRate: RATE, timestamp: pos / RATE });
      pos += samples.length;
    }
  };
  return { source: src as PitchSource & typeof src, emit };
}

/** A sung "song": two held notes (A3, E4), 12 s voiced in all. */
const sing = (emit: (hz: number, s: number) => void) => {
  emit(220, 6);
  emit(329.63, 6);
};

beforeEach(() => {
  jest.clearAllMocks();
  fsState.reset();
  const r = mocked.__recorder;
  r.__reset();
  r.uri = null;
  // Like the native recorder: prepare picks the path and creates the file; stop finalises it.
  r.prepareToRecordAsync.mockImplementation(async () => {
    r.uri = AAC_URI;
    fsState.files.set(AAC_URI, new Uint8Array(0));
  });
  r.stop.mockImplementation(async () => {
    r.__live(null);
    fsState.files.set(AAC_URI, new Uint8Array(1234));
  });
  r.getStatus.mockImplementation(() => r.__live({ durationMillis: 12_500 }));
});

let platform: { restore(): void } | null = null;
afterEach(() => {
  platform?.restore();
  platform = null;
});

describe('useSongRecorder', () => {
  it('creates the AAC recorder with mono 44.1 kHz AAC at 48 kbps', () => {
    renderHook(() => useSongRecorder(fakeSource('mic').source, { record: true, floor: 0.003 }));
    expect(mocked.useAudioRecorder).toHaveBeenCalledWith(AAC_RECORDING_OPTIONS);
    expect(AAC_RECORDING_OPTIONS).toEqual(
      expect.objectContaining({ extension: '.m4a', sampleRate: 44100, numberOfChannels: 1, bitRate: 48000 }),
    );
    expect(AAC_RECORDING_OPTIONS.android).toEqual(expect.objectContaining({ outputFormat: 'mpeg4', audioEncoder: 'aac' }));
  });

  it('start() runs the iOS order: audio mode, then the stream, then the recorder, and resolves after all three', async () => {
    const order: string[] = [];
    const { source } = fakeSource('mic', order);
    mocked.setAudioModeAsync.mockImplementation(async () => void order.push('mode'));
    mocked.__recorder.prepareToRecordAsync.mockImplementation(async () => {
      mocked.__recorder.uri = AAC_URI;
      order.push('recorder.prepare');
    });
    mocked.__recorder.record.mockImplementation(() => void order.push('recorder.record'));
    const { result } = renderHook(() => useSongRecorder(source, { record: true, floor: 0.003 }));
    await act(async () => {
      await result.current.start();
      order.push('start resolved');
    });
    expect(mocked.setAudioModeAsync).toHaveBeenCalledWith(SESSION_AUDIO_MODE);
    expect(SESSION_AUDIO_MODE).toEqual({
      allowsRecording: true,
      playsInSilentMode: true,
      shouldRouteThroughEarpiece: false,
      interruptionMode: 'mixWithOthers',
    });
    expect(order).toEqual(['mode', 'stream.start:song', 'recorder.prepare', 'recorder.record', 'start resolved']);
  });

  it('records AAC with consent: stop returns the pitch summary and an audio/mp4 file; recorder stops before the stream', async () => {
    const order: string[] = [];
    const { source, emit } = fakeSource('mic', order);
    mocked.__recorder.stop.mockImplementation(async () => {
      order.push('recorder.stop');
      fsState.files.set(AAC_URI, new Uint8Array(1234));
    });
    const { result } = renderHook(() => useSongRecorder(source, { record: true, floor: 0.003 }));
    await act(() => result.current.start());
    act(() => sing(emit));
    let out!: Awaited<ReturnType<typeof result.current.stop>>;
    await act(async () => {
      out = await result.current.stop();
    });
    expect(out.file).toEqual({ uri: AAC_URI, durationS: 12.5, contentType: 'audio/mp4' });
    expect(fsState.files.has(AAC_URI)).toBe(true);
    expect(out.pitch).not.toBeNull();
    expect(out.pitch!.heldCount).toBeGreaterThanOrEqual(2);
    expect(out.pitch!.heldLow).toBe(57); // A3
    expect(out.pitch!.heldHigh).toBe(64); // E4
    expect(out.pitch!.voicedS).toBeGreaterThanOrEqual(10);
    expect(order.slice(-2)).toEqual(['recorder.stop', 'stream.stop']);
  });

  it('recorder without consent writes no file but returns pitch (iOS keeps the recorder for the stream, then deletes its file)', async () => {
    const { source, emit } = fakeSource('mic');
    const { result } = renderHook(() => useSongRecorder(source, { record: false, floor: 0.003 }));
    await act(() => result.current.start());
    // iOS: the AAC recorder is what keeps the stream alive once the video plays (D1 spike), so it still runs.
    expect(mocked.__recorder.record).toHaveBeenCalled();
    act(() => sing(emit));
    let out!: Awaited<ReturnType<typeof result.current.stop>>;
    await act(async () => {
      out = await result.current.stop();
    });
    expect(out.file).toBeNull();
    expect(out.pitch).not.toBeNull();
    expect(fsState.files.size).toBe(0); // the keep-alive take was deleted
  });

  it('on Android without consent the recorder never runs', async () => {
    platform = jest.replaceProperty(Platform, 'OS', 'android');
    const { source, emit } = fakeSource('mic');
    const { result } = renderHook(() => useSongRecorder(source, { record: false, floor: 0.003 }));
    await act(() => result.current.start());
    act(() => sing(emit));
    let out!: Awaited<ReturnType<typeof result.current.stop>>;
    await act(async () => {
      out = await result.current.stop();
    });
    expect(mocked.__recorder.record).not.toHaveBeenCalled();
    expect(out.file).toBeNull();
    expect(out.pitch).not.toBeNull();
  });

  it('the fake source records a WAV (16 kHz PCM16) and never touches the AAC recorder or the audio mode', async () => {
    const { source, emit } = fakeSource('fake');
    const { result } = renderHook(() => useSongRecorder(source, { record: true, floor: 0.003 }));
    await act(() => result.current.start());
    act(() => sing(emit));
    let out!: Awaited<ReturnType<typeof result.current.stop>>;
    await act(async () => {
      out = await result.current.stop();
    });
    expect(mocked.__recorder.record).not.toHaveBeenCalled();
    expect(mocked.setAudioModeAsync).not.toHaveBeenCalled();
    expect(out.file).toEqual({ uri: expect.stringMatching(/\.wav$/), durationS: 12, contentType: 'audio/wav' });
    expect(fsState.files.get(out.file!.uri)!.length).toBe(44 + 12 * RATE * 2);
    expect(out.pitch).not.toBeNull();
  });

  it('sink "wav" on a real mic records WAV from the stream (the fallback)', async () => {
    const { source, emit } = fakeSource('mic');
    const { result } = renderHook(() => useSongRecorder(source, { record: true, floor: 0.003, sink: 'wav' }));
    await act(() => result.current.start());
    act(() => sing(emit));
    let out!: Awaited<ReturnType<typeof result.current.stop>>;
    await act(async () => {
      out = await result.current.stop();
    });
    expect(out.file?.contentType).toBe('audio/wav');
    expect(mocked.setAudioModeAsync).toHaveBeenCalledWith(SESSION_AUDIO_MODE);
  });

  it('the fake source without consent writes nothing', async () => {
    const { source, emit } = fakeSource('fake');
    const { result } = renderHook(() => useSongRecorder(source, { record: false, floor: 0.003 }));
    await act(() => result.current.start());
    act(() => sing(emit));
    let out!: Awaited<ReturnType<typeof result.current.stop>>;
    await act(async () => {
      out = await result.current.stop();
    });
    expect(out.file).toBeNull();
    expect(fsState.files.size).toBe(0);
    expect(out.pitch).not.toBeNull();
  });

  it('too little singing gives a null pitch summary', async () => {
    const { source, emit } = fakeSource('fake');
    const { result } = renderHook(() => useSongRecorder(source, { record: false, floor: 0.003 }));
    await act(() => result.current.start());
    act(() => emit(220, 3));
    let out!: Awaited<ReturnType<typeof result.current.stop>>;
    await act(async () => {
      out = await result.current.stop();
    });
    expect(out.pitch).toBeNull();
  });

  it('frames at or under the setup floor are not counted as singing', async () => {
    const { source, emit } = fakeSource('fake');
    const { result } = renderHook(() => useSongRecorder(source, { record: false, floor: 0.5 }));
    await act(() => result.current.start());
    act(() => sing(emit));
    let out!: Awaited<ReturnType<typeof result.current.stop>>;
    await act(async () => {
      out = await result.current.stop();
    });
    expect(out.pitch).toBeNull();
    expect(result.current.livePitch).toBeNull();
  });

  it('livePitch follows the singing and clears on stop', async () => {
    const { source, emit } = fakeSource('fake');
    const { result } = renderHook(() => useSongRecorder(source, { record: false, floor: 0.003 }));
    expect(result.current.livePitch).toBeNull();
    await act(() => result.current.start());
    act(() => emit(220, 1));
    expect(result.current.livePitch).not.toBeNull();
    expect(Math.round(result.current.livePitch!)).toBe(57);
    await act(async () => {
      await result.current.stop();
    });
    expect(result.current.livePitch).toBeNull();
  });

  it('a failing source.start rejects start(), stops the stream and leaves no file', async () => {
    const { source } = fakeSource('fake');
    source.start.mockRejectedValueOnce(new Error('mic busy'));
    const { result } = renderHook(() => useSongRecorder(source, { record: true, floor: 0.003 }));
    await act(async () => {
      await expect(result.current.start()).rejects.toThrow('mic busy');
    });
    expect(source.stop).toHaveBeenCalled();
    expect(fsState.files.size).toBe(0);
  });

  it('a recorder that fails to start keeps the pitch running with no file', async () => {
    const { source, emit } = fakeSource('mic');
    mocked.__recorder.prepareToRecordAsync.mockRejectedValueOnce(new Error('session busy'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { result } = renderHook(() => useSongRecorder(source, { record: true, floor: 0.003 }));
    await act(() => result.current.start());
    act(() => sing(emit));
    let out!: Awaited<ReturnType<typeof result.current.stop>>;
    await act(async () => {
      out = await result.current.stop();
    });
    expect(out.file).toBeNull();
    expect(out.pitch).not.toBeNull();
    expect(mocked.__recorder.stop).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('stop() during an in-flight start() leaves nothing running and no file', async () => {
    const { source } = fakeSource('mic');
    let release!: () => void;
    source.start.mockImplementationOnce(() => new Promise<void>((r) => (release = r)));
    const { result } = renderHook(() => useSongRecorder(source, { record: true, floor: 0.003 }));
    let started!: Promise<void>;
    await act(async () => {
      started = result.current.start();
      await Promise.resolve();
    });
    let out!: Awaited<ReturnType<typeof result.current.stop>>;
    await act(async () => {
      out = await result.current.stop();
      release();
      await started.catch(() => {});
    });
    expect(out).toEqual({ pitch: null, file: null });
    expect(mocked.__recorder.record).not.toHaveBeenCalled();
    expect(source.stop).toHaveBeenCalled();
    expect(fsState.files.size).toBe(0);
  });

  it('a second start() over a running take deletes the first take', async () => {
    const { source, emit } = fakeSource('fake');
    const { result } = renderHook(() => useSongRecorder(source, { record: true, floor: 0.003 }));
    await act(() => result.current.start());
    act(() => emit(220, 1));
    await act(() => result.current.start());
    expect(fsState.files.size).toBe(1); // only the new take's file
    let out!: Awaited<ReturnType<typeof result.current.stop>>;
    await act(async () => {
      out = await result.current.stop();
    });
    expect(out.file!.durationS).toBe(0);
  });

  it('unmount deletes a non-consented iOS keep-alive take (our cleanup runs before the hook releases the recorder)', async () => {
    const order: string[] = [];
    const r = mocked.__recorder;
    r.stop.mockImplementation(async () => {
      r.__live(null);
      order.push('recorder.stop');
    });
    const release = r.__release;
    r.__release = () => {
      order.push('release');
      release();
    };
    const { source, emit } = fakeSource('mic');
    const { result, unmount } = renderHook(() => useSongRecorder(source, { record: false, floor: 0.003 }));
    await act(() => result.current.start());
    act(() => emit(220, 1));
    expect(fsState.files.has(AAC_URI)).toBe(true);
    unmount();
    await act(async () => {});
    r.__release = release;
    expect(order).toEqual(['recorder.stop', 'release']);
    expect(fsState.files.has(AAC_URI)).toBe(false);
  });

  it('a keep-alive take is still deleted when the recorder was already released (uri, getStatus, stop all throw)', async () => {
    const { source, emit } = fakeSource('mic');
    const { result, unmount } = renderHook(() => useSongRecorder(source, { record: false, floor: 0.003 }));
    await act(() => result.current.start());
    act(() => emit(220, 1));
    mocked.__recorder.__release();
    expect(() => mocked.__recorder.uri).toThrow('released');
    unmount();
    await act(async () => {});
    expect(fsState.files.has(AAC_URI)).toBe(false);
  });

  it('stop() on a released recorder still deletes a keep-alive take', async () => {
    const { source, emit } = fakeSource('mic');
    const { result } = renderHook(() => useSongRecorder(source, { record: false, floor: 0.003 }));
    await act(() => result.current.start());
    act(() => sing(emit));
    mocked.__recorder.__release();
    let out!: Awaited<ReturnType<typeof result.current.stop>>;
    await act(async () => {
      out = await result.current.stop();
    });
    expect(out.file).toBeNull();
    expect(out.pitch).not.toBeNull();
    expect(fsState.files.size).toBe(0);
  });

  it('unmount stops the stream and discards the take', async () => {
    const { source, emit } = fakeSource('fake');
    const { result, unmount } = renderHook(() => useSongRecorder(source, { record: true, floor: 0.003 }));
    await act(() => result.current.start());
    act(() => emit(220, 1));
    unmount();
    expect(source.stop).toHaveBeenCalled();
    expect(fsState.files.size).toBe(0);
  });

  it('unmount after the mic stream was released (stop throws) does not throw and still discards the take', async () => {
    const { source, emit } = fakeSource('fake');
    const { result, unmount } = renderHook(() => useSongRecorder(source, { record: true, floor: 0.003 }));
    await act(() => result.current.start());
    act(() => emit(220, 1));
    source.stop.mockImplementation(() => {
      throw Object.assign(new Error('released'), { code: 'ERR_USING_RELEASED_SHARED_OBJECT' });
    });
    expect(() => unmount()).not.toThrow();
    expect(fsState.files.size).toBe(0);
  });

  it('stop() resolves the take when the mic stream was already released', async () => {
    const { source, emit } = fakeSource('fake');
    const { result } = renderHook(() => useSongRecorder(source, { record: true, floor: 0.003 }));
    await act(() => result.current.start());
    act(() => emit(220, 6));
    source.stop.mockImplementation(() => {
      throw Object.assign(new Error('released'), { code: 'ERR_USING_RELEASED_SHARED_OBJECT' });
    });
    let out: Awaited<ReturnType<typeof result.current.stop>> | null = null;
    await act(async () => {
      out = await result.current.stop();
    });
    expect(out!.file?.contentType).toBe('audio/wav');
  });
});
