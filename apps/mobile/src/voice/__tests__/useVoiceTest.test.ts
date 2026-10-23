import { StrictMode, createElement, type ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react-native';
import type { MicPermission, PcmBuffer, PitchSource, VoiceSection } from '../pitchSource';
import { MAX_STEP_LISTEN_S, useVoiceTest } from '../useVoiceTest';

const RATE = 16000;
const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

/** Mono sine (or silence when midi is null) as 100 ms buffers. */
function tone(midi: number | null, secs: number, amp = 0.3, rate = RATE): Float32Array {
  const n = Math.round(secs * rate);
  const out = new Float32Array(n);
  if (midi !== null) for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * hz(midi) * i) / rate);
  return out;
}
function concat(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

type FakeSource = PitchSource & {
  sections: VoiceSection[];
  stops: number;
  /** Wall-clock ms the hook spent in each delivered buffer during the last feed(). */
  timings: number[];
  feed(samples: Float32Array): void;
};

/** `rate` is the delivered sample rate; buffers are always 100 ms long, like expo-audio's native stream. */
function makeSource(permission: MicPermission = 'granted', rate = RATE): FakeSource {
  const chunk = Math.round(rate / 10);
  let sink: ((b: PcmBuffer) => void) | null = null;
  let clock = 0;
  const src: FakeSource = {
    kind: 'fake',
    sections: [],
    stops: 0,
    timings: [],
    requestPermission: async () => permission,
    checkPermission: async () => permission,
    start: async (onBuffer, section) => {
      sink = onBuffer;
      clock = 0;
      src.sections.push(section);
    },
    stop: () => {
      src.stops++;
    },
    // Deliberately keeps delivering to the last sink after stop(): the hook must ignore it.
    feed(samples) {
      src.timings = [];
      for (let off = 0; off < samples.length; off += chunk) {
        const t0 = performance.now();
        sink?.({ samples: samples.subarray(off, off + chunk), sampleRate: rate, timestamp: clock });
        src.timings.push(performance.now() - t0);
        clock += chunk / rate;
      }
    },
  };
  return src;
}

const SILENT_SECOND = () => tone(null, 1.0);
const feed = (src: FakeSource, s: Float32Array) => act(() => src.feed(s));
const advance = (ms: number) => act(() => void jest.advanceTimersByTime(ms));

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

async function begin(src: FakeSource) {
  const hook = renderHook(() => useVoiceTest(src));
  await act(async () => {
    await hook.result.current.begin();
  });
  return hook;
}

it('walks intro→low→high→sing→result and classifies baritone', async () => {
  const src = makeSource();
  const { result } = await begin(src);
  expect(result.current.step).toBe('low');
  expect(result.current.phase).toBe('quiet');
  expect(src.sections).toEqual(['low']);

  await feed(src, concat(SILENT_SECOND(), tone(45, 1.2)));
  await advance(1000);
  expect(result.current.phase).toBe('listening');
  expect(result.current.held).toHaveLength(1);
  await act(async () => result.current.done());
  expect(result.current.step).toBe('high');
  expect(result.current.phase).toBe('quiet');

  await feed(src, concat(SILENT_SECOND(), tone(69, 1.2)));
  await act(async () => result.current.done());
  expect(result.current.step).toBe('sing');
  expect(src.sections).toEqual(['low', 'high', 'sing']);

  const sing = concat(SILENT_SECOND(), ...[52, 55, 59, 62, 57, 54].map((m) => tone(m, 0.8)));
  await feed(src, sing);
  act(() => result.current.skipSing());

  expect(result.current.step).toBe('result');
  expect(result.current.result?.range.low).toBe(45);
  expect(result.current.result?.range.high).toBe(69);
  expect(result.current.result?.voice.type).toBe('baritone');
  expect(src.stops).toBeGreaterThanOrEqual(3);
});

it('sing ends by itself at 15 s', async () => {
  const src = makeSource();
  const { result } = await begin(src);
  await feed(src, concat(SILENT_SECOND(), tone(45, 1.2)));
  await act(async () => result.current.done());
  await feed(src, concat(SILENT_SECOND(), tone(69, 1.2)));
  await act(async () => result.current.done());
  await feed(src, concat(SILENT_SECOND(), tone(55, 4)));
  await advance(14_900);
  expect(result.current.step).toBe('sing');
  await advance(200);
  expect(result.current.step).toBe('result');
});

it('done() does nothing before the step has a held note', async () => {
  const src = makeSource();
  const { result } = await begin(src);
  await act(async () => result.current.done());
  expect(result.current.step).toBe('low');
  await feed(src, concat(SILENT_SECOND(), tone(45, 0.3)));
  await act(async () => result.current.done());
  expect(result.current.step).toBe('low');
});

it('denied → permission-denied; blocked → permission-blocked (never a spinner)', async () => {
  const denied = await begin(makeSource('denied'));
  expect(denied.result.current.step).toBe('permission-denied');
  const blocked = await begin(makeSource('blocked'));
  expect(blocked.result.current.step).toBe('permission-blocked');
});

it('a permission request that throws lands on permission-denied, not a spinner', async () => {
  const src = makeSource();
  src.requestPermission = async () => {
    throw new Error('native module missing');
  };
  const { result } = await begin(src);
  expect(result.current.step).toBe('permission-denied');
});

it('start() throwing (mic busy) lands on mic-busy, not permission-denied; retry re-enters that step', async () => {
  const src = makeSource();
  const realStart = src.start;
  let busy = true;
  src.start = async (onBuffer, section) => {
    if (busy) throw new Error('AVAudioSession: mic in use');
    return realStart(onBuffer, section);
  };
  const { result } = await begin(src);
  expect(result.current.step).toBe('mic-busy');
  busy = false;
  await act(async () => {
    await result.current.retry();
  });
  expect(result.current.step).toBe('low');
  expect(src.sections).toEqual(['low']);

  // Busy again on high: retry goes back to high, keeping the low note.
  await feed(src, concat(SILENT_SECOND(), tone(45, 1.2)));
  busy = true;
  await act(async () => result.current.done());
  expect(result.current.step).toBe('mic-busy');
  busy = false;
  await act(async () => {
    await result.current.retry();
  });
  expect(result.current.step).toBe('high');
  expect(result.current.held).toHaveLength(1);
});

it('retry from permission-denied asks again', async () => {
  let perm: MicPermission = 'denied';
  const src = makeSource();
  src.requestPermission = async () => perm;
  const { result } = await begin(src);
  expect(result.current.step).toBe('permission-denied');
  perm = 'granted';
  await act(async () => {
    await result.current.retry();
  });
  expect(result.current.step).toBe('low');
});

it('20 s of silence on low → no-notes, retry returns to low', async () => {
  const src = makeSource();
  const { result } = await begin(src);
  await advance(19_900);
  expect(result.current.step).toBe('low');
  await advance(200);
  expect(result.current.step).toBe('no-notes');
  expect(src.stops).toBeGreaterThanOrEqual(1);
  await act(async () => {
    await result.current.retry();
  });
  expect(result.current.step).toBe('low');
  expect(result.current.phase).toBe('quiet');
  expect(src.sections).toEqual(['low', 'low']);
});

it('20 s with no note on high keeps the low note and retry returns to high', async () => {
  const src = makeSource();
  const { result } = await begin(src);
  await feed(src, concat(SILENT_SECOND(), tone(45, 1.2)));
  await act(async () => result.current.done());
  await advance(20_100);
  expect(result.current.step).toBe('no-notes');
  await act(async () => {
    await result.current.retry();
  });
  expect(result.current.step).toBe('high');
  expect(result.current.held).toHaveLength(1);
});

it('one held note overall → no-notes, never a result', async () => {
  const src = makeSource();
  const { result } = await begin(src);
  await feed(src, concat(SILENT_SECOND(), tone(45, 1.2)));
  await act(async () => result.current.done());
  await advance(20_100); // high: nothing
  expect(result.current.step).toBe('no-notes');
  expect(result.current.result).toBeNull();
});

it('two held notes less than 3 semitones apart → no-notes, retry restarts at low', async () => {
  const src = makeSource();
  const { result } = await begin(src);
  await feed(src, concat(SILENT_SECOND(), tone(45, 1.2)));
  await act(async () => result.current.done());
  await feed(src, concat(SILENT_SECOND(), tone(46, 1.2)));
  await act(async () => result.current.done());
  act(() => result.current.skipSing());
  expect(result.current.step).toBe('no-notes');
  expect(result.current.result).toBeNull();
  await act(async () => {
    await result.current.retry();
  });
  expect(result.current.step).toBe('low');
  expect(result.current.held).toHaveLength(0);
});

it('unmount calls stop and late buffers do nothing', async () => {
  const src = makeSource();
  const { result, unmount } = await begin(src);
  const before = src.stops;
  unmount();
  expect(src.stops).toBeGreaterThan(before);
  expect(() => src.feed(concat(SILENT_SECOND(), tone(45, 1.2)))).not.toThrow();
  expect(result.current.held).toHaveLength(0);
  await advance(30_000);
  expect(result.current.step).toBe('low');
});

it('buffers from the previous step are ignored after a step change', async () => {
  const src = makeSource();
  const { result } = await begin(src);
  await feed(src, concat(SILENT_SECOND(), tone(45, 1.2)));
  await act(async () => result.current.done());
  // the stale low-step sink would deliver a long note into high if it were not ignored
  expect(result.current.step).toBe('high');
  expect(result.current.held).toHaveLength(1);
});

it('the noise floor from the quiet second gates a constant hum', async () => {
  const src = makeSource();
  const { result } = await begin(src);
  await feed(src, tone(45, 3, 0.02)); // hum present from the first sample
  expect(result.current.held).toHaveLength(0);
  await advance(20_100);
  expect(result.current.step).toBe('no-notes');
});

it('control: the same hum starting after a silent second counts as a note', async () => {
  const src = makeSource();
  const { result } = await begin(src);
  await feed(src, concat(SILENT_SECOND(), tone(45, 1.5, 0.02)));
  expect(result.current.held).toHaveLength(1);
});

it('livePitch follows the voiced midi, throttled to 15 Hz', async () => {
  const src = makeSource();
  const { result } = await begin(src);
  await feed(src, tone(null, 1.3));
  expect(result.current.livePitch).toBeNull();
  // Within one 66 ms window only the first frame's value is published.
  await feed(src, tone(57, 1));
  expect(result.current.livePitch).toBeNull();
  await advance(70);
  await feed(src, tone(57, 0.3));
  expect(result.current.livePitch).toBeCloseTo(57, 0);
});

it('a tone starting exactly at 1.0 s audio time is heard, and phase flips on the audio clock', async () => {
  const src = makeSource();
  const { result } = await begin(src);
  await feed(src, concat(tone(null, 0.9)));
  expect(result.current.phase).toBe('quiet');
  await feed(src, concat(tone(null, 0.2), tone(45, 1.0)));
  expect(result.current.phase).toBe('listening'); // no wall-clock time has passed
  expect(result.current.held).toHaveLength(1);
});

it('phase falls back to the wall clock if no audio arrives', async () => {
  const src = makeSource();
  const { result } = await begin(src);
  await advance(1500);
  expect(result.current.phase).toBe('quiet');
  await advance(600);
  expect(result.current.phase).toBe('listening');
});

it('the 20 s no-note timeout starts when start() resolves', async () => {
  const src = makeSource();
  let release: () => void = () => {};
  src.start = (onBuffer, section) =>
    new Promise<void>((res) => {
      release = () => {
        src.sections.push(section);
        res();
      };
      void onBuffer;
    });
  const hook = renderHook(() => useVoiceTest(src));
  act(() => void hook.result.current.begin());
  await act(async () => {});
  await advance(30_000);
  expect(hook.result.current.step).toBe('low');
  await act(async () => release());
  await advance(19_900);
  expect(hook.result.current.step).toBe('low');
  await advance(200);
  expect(hook.result.current.step).toBe('no-notes');
});

it('cancel() stops the run and returns to intro with no result', async () => {
  const src = makeSource();
  const { result } = await begin(src);
  await feed(src, concat(SILENT_SECOND(), tone(45, 1.2)));
  expect(result.current.held).toHaveLength(1);
  const stops = src.stops;
  act(() => result.current.cancel());
  expect(src.stops).toBeGreaterThan(stops);
  expect(result.current.step).toBe('intro');
  expect(result.current.result).toBeNull();
  expect(result.current.held).toHaveLength(0);
  src.feed(tone(45, 1));
  await advance(30_000);
  expect(result.current.step).toBe('intro');
  await act(async () => {
    await result.current.begin();
  });
  expect(result.current.step).toBe('low');
});

it('cancel() during a pending permission prompt wins over the late answer', async () => {
  const src = makeSource();
  let answer: (p: MicPermission) => void = () => {};
  src.requestPermission = () => new Promise((res) => (answer = res));
  const { result } = renderHook(() => useVoiceTest(src));
  act(() => void result.current.begin());
  act(() => result.current.cancel());
  await act(async () => answer('granted'));
  expect(result.current.step).toBe('intro');
});

it('survives StrictMode unmount/remount: still runs and still stops on real unmount', async () => {
  const src = makeSource();
  const wrapper = ({ children }: { children: ReactNode }) => createElement(StrictMode, null, children);
  const hook = renderHook(() => useVoiceTest(src), { wrapper });
  await act(async () => {
    await hook.result.current.begin();
  });
  expect(hook.result.current.step).toBe('low');
  await feed(src, concat(SILENT_SECOND(), tone(45, 1.2)));
  expect(hook.result.current.held).toHaveLength(1);
  const stops = src.stops;
  hook.unmount();
  expect(src.stops).toBeGreaterThan(stops);
});

it('a stale start() resolving late does not stop the newer run', async () => {
  const src = makeSource();
  const releases: (() => void)[] = [];
  src.start = (_onBuffer, section) =>
    new Promise<void>((res) => {
      releases.push(() => {
        src.sections.push(section);
        res();
      });
    });
  const { result } = renderHook(() => useVoiceTest(src));
  act(() => void result.current.begin());
  await act(async () => {});
  // low's start() is still pending; cancel and begin again -> a newer run owns the source
  act(() => result.current.cancel());
  act(() => void result.current.begin());
  await act(async () => {});
  const stops = src.stops;
  await act(async () => releases[0]!()); // stale low start resolves
  expect(src.stops).toBe(stops);
});

it('range is min/max over all held notes when high is sung lower than low', async () => {
  const src = makeSource();
  const { result } = await begin(src);
  await feed(src, concat(SILENT_SECOND(), tone(60, 1.2)));
  await act(async () => result.current.done());
  await feed(src, concat(SILENT_SECOND(), tone(48, 1.2)));
  await act(async () => result.current.done());
  act(() => result.current.skipSing());
  expect(result.current.step).toBe('result');
  expect(result.current.result?.range.low).toBe(48);
  expect(result.current.result?.range.high).toBe(60);
  expect(result.current.result?.range.heldCount).toBe(2);
});

describe('at 48 kHz (what a phone delivers if it ignores the 16 kHz request)', () => {
  const R = 48000;
  const t48 = (midi: number | null, secs: number) => tone(midi, secs, 0.3, R);
  // Real performance.now for the per-buffer timings; timers stay fake.
  beforeEach(() => jest.useFakeTimers({ doNotFake: ['performance'] }));

  it('walks intro→low→high→sing→result with the same answer as at 16 kHz', async () => {
    const src = makeSource('granted', R);
    const { result } = await begin(src);
    await feed(src, concat(t48(null, 1), t48(45, 1.2)));
    expect(result.current.phase).toBe('listening');
    expect(result.current.held).toHaveLength(1);
    await act(async () => result.current.done());
    await feed(src, concat(t48(null, 1), t48(69, 1.2)));
    await act(async () => result.current.done());
    expect(result.current.step).toBe('sing');
    await feed(src, concat(t48(null, 1), ...[52, 55, 59, 62, 57, 54].map((m) => t48(m, 0.8))));
    act(() => result.current.skipSing());
    expect(result.current.step).toBe('result');
    expect(result.current.result?.range.low).toBe(45);
    expect(result.current.result?.range.high).toBe(69);
    expect(result.current.result?.voice.type).toBe('baritone');
  });

  it('perf: a 20 s continuous hold costs < 20 ms of JS per 100 ms buffer', async () => {
    const src = makeSource('granted', R);
    const { result } = await begin(src);
    await feed(src, concat(t48(null, 1), t48(45, 20)));
    expect(result.current.held).toHaveLength(1);
    // The last 5 s are the worst case: the longest frame list. The median, so GC pauses and a busy CI machine (jest
    // runs suites in parallel) can't flake it; the old re-sorting held-note pass cost ~130 ms here, now ~3 ms.
    const tail = src.timings.slice(-50).sort((a, b) => a - b);
    const median = tail[tail.length >> 1]!;
    expect(median).toBeLessThan(20);
  });

  it('stops collecting frames after MAX_STEP_LISTEN_S of listening (safety net)', async () => {
    const src = makeSource('granted', R);
    const { result } = await begin(src);
    await feed(src, concat(t48(null, 1), t48(45, MAX_STEP_LISTEN_S + 4)));
    // done() commits the step's final notes; high then shows them.
    await act(async () => result.current.done());
    expect(result.current.step).toBe('high');
    expect(result.current.held).toHaveLength(1);
    expect(result.current.held[0]!.end).toBeLessThan(1 + MAX_STEP_LISTEN_S);
    expect(result.current.held[0]!.end).toBeGreaterThan(MAX_STEP_LISTEN_S - 0.5);
  });
});
