import { act, renderHook } from '@testing-library/react-native';
import type { MicPermission, PcmBuffer, PitchSource, VoiceSection } from '../pitchSource';
import { useVoiceTest } from '../useVoiceTest';

const RATE = 16000;
const CHUNK = 1600;
const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

/** Mono sine (or silence when midi is null) as 100 ms buffers. */
function tone(midi: number | null, secs: number, amp = 0.3): Float32Array {
  const n = Math.round(secs * RATE);
  const out = new Float32Array(n);
  if (midi !== null) for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * hz(midi) * i) / RATE);
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
  feed(samples: Float32Array): void;
};

function makeSource(permission: MicPermission = 'granted'): FakeSource {
  let sink: ((b: PcmBuffer) => void) | null = null;
  let clock = 0;
  const src: FakeSource = {
    kind: 'fake',
    sections: [],
    stops: 0,
    requestPermission: async () => permission,
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
      for (let off = 0; off < samples.length; off += CHUNK) {
        sink?.({ samples: samples.subarray(off, off + CHUNK), sampleRate: RATE, timestamp: clock });
        clock += CHUNK / RATE;
      }
    },
  };
  return src;
}

// 1.2 s: frame windows are 2048 samples long, so a tone must start >= ~0.13 s after the end of the quiet second.
const SILENT_SECOND = () => tone(null, 1.2);
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
  act(() => result.current.done());
  expect(result.current.step).toBe('high');
  expect(result.current.phase).toBe('quiet');

  await feed(src, concat(SILENT_SECOND(), tone(69, 1.2)));
  act(() => result.current.done());
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
  act(() => result.current.done());
  await feed(src, concat(SILENT_SECOND(), tone(69, 1.2)));
  act(() => result.current.done());
  await feed(src, concat(SILENT_SECOND(), tone(55, 4)));
  await advance(14_900);
  expect(result.current.step).toBe('sing');
  await advance(200);
  expect(result.current.step).toBe('result');
});

it('done() does nothing before the step has a held note', async () => {
  const src = makeSource();
  const { result } = await begin(src);
  act(() => result.current.done());
  expect(result.current.step).toBe('low');
  await feed(src, concat(SILENT_SECOND(), tone(45, 0.3)));
  act(() => result.current.done());
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
  act(() => result.current.done());
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
  act(() => result.current.done());
  await advance(20_100); // high: nothing
  expect(result.current.step).toBe('no-notes');
  expect(result.current.result).toBeNull();
});

it('two held notes less than 3 semitones apart → no-notes, retry restarts at low', async () => {
  const src = makeSource();
  const { result } = await begin(src);
  await feed(src, concat(SILENT_SECOND(), tone(45, 1.2)));
  act(() => result.current.done());
  await feed(src, concat(SILENT_SECOND(), tone(46, 1.2)));
  act(() => result.current.done());
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
  act(() => result.current.done());
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
  await feed(src, SILENT_SECOND());
  expect(result.current.livePitch).toBeNull();
  // Within one 66 ms window only the first frame's value is published.
  await feed(src, tone(57, 1));
  expect(result.current.livePitch).toBeNull();
  await advance(70);
  await feed(src, tone(57, 0.3));
  expect(result.current.livePitch).toBeCloseTo(57, 0);
});
