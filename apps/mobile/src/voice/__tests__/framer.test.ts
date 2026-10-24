import type { PitchFrame } from '@nomad/core';
import { createFramer } from '../framer';

const sine = (hz: number, rate: number, n: number, amp = 0.5) =>
  Float32Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / rate));

function run(samples: Float32Array, rate: number, chunk: number | number[]) {
  const frames: PitchFrame[] = [];
  const framer = createFramer((f) => frames.push(f));
  let off = 0;
  let i = 0;
  while (off < samples.length) {
    const size = Array.isArray(chunk) ? chunk[i++ % chunk.length]! : chunk;
    framer.push({ samples: samples.subarray(off, off + size), sampleRate: rate, timestamp: off / rate });
    off += size;
  }
  return { frames, framer };
}

it('detects a 48 kHz 220 Hz sine across uneven buffers, with the expected frame count and t', () => {
  const N = 48000;
  const { frames } = run(sine(220, 48000, N), 48000, [4800, 1000, 4800, 3333]);
  expect(frames).toHaveLength(Math.floor((N - 2048) / 512) + 1);
  for (const f of frames) {
    expect(f.hz).not.toBeNull();
    expect(Math.abs(f.hz! - 220)).toBeLessThan(1);
    expect(f.clarity).toBeGreaterThan(0.95);
    expect(f.rms).toBeCloseTo(0.5 / Math.SQRT2, 2);
  }
  expect(frames[0]!.t).toBe(0);
  expect(frames[1]!.t).toBeCloseTo(512 / 48000, 9);
});

it('works at 44.1 kHz and 16 kHz too', () => {
  for (const rate of [44100, 16000]) {
    const { frames } = run(sine(196, rate, rate), rate, 4410);
    expect(frames.length).toBeGreaterThan(10);
    expect(Math.abs(frames[3]!.hz! - 196)).toBeLessThan(1);
  }
});

it('silence is unvoiced or unclear, with rms 0', () => {
  const { frames } = run(new Float32Array(8192), 48000, 2048);
  expect(frames.length).toBeGreaterThan(0);
  for (const f of frames) {
    expect(f.hz === null || f.clarity < 0.9).toBe(true);
    expect(f.rms).toBe(0);
  }
});

it('reset() restarts t at 0 and drops pending samples', () => {
  const { frames, framer } = run(sine(220, 48000, 5000), 48000, 5000);
  const before = frames.length;
  framer.reset();
  const s = sine(220, 48000, 2048);
  framer.push({ samples: s, sampleRate: 48000, timestamp: 9 });
  expect(frames).toHaveLength(before + 1);
  expect(frames[before]!.t).toBe(0);
});

it('recreates the detector when the sample rate changes', () => {
  const frames: PitchFrame[] = [];
  const framer = createFramer((f) => frames.push(f));
  framer.push({ samples: sine(220, 48000, 3000), sampleRate: 48000, timestamp: 0 });
  framer.push({ samples: sine(330, 16000, 3000), sampleRate: 16000, timestamp: 0 });
  const last = frames[frames.length - 1]!;
  expect(Math.abs(last.hz! - 330)).toBeLessThan(2);
});
