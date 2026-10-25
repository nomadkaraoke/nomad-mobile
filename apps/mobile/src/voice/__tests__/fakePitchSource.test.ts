import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PitchFrame } from '@nomad/core';
import { parseWav } from '@nomad/core';
import { createFramer } from '../framer';
import { renderHook } from '@testing-library/react-native';
import { createFakePitchSource, FAKE_MIC_SECTIONS, useFakePitchSource } from '../useFakePitchSource';
import type { PcmBuffer } from '../pitchSource';

const WAV = join(__dirname, '../../../assets/fake-mic/baritone-scale.wav');

jest.mock('expo-asset', () => ({
  Asset: { fromModule: jest.fn(() => ({ downloadAsync: async () => ({ localUri: 'file:///fake-mic.wav' }), localUri: 'file:///fake-mic.wav' })) },
}));
jest.mock('expo-file-system', () => ({
  File: function File() {
    return { bytes: async () => new Uint8Array(jest.requireActual('node:fs').readFileSync(jest.requireActual('node:path').join(__dirname, '../../../assets/fake-mic/baritone-scale.wav'))) };
  },
}));
jest.mock('../../../assets/fake-mic/baritone-scale.wav', () => 1, { virtual: true });

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

it('the generated WAV is deterministic', () => {
  const bytes = readFileSync(WAV);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe('ba2c7027589b1edeb69f795388ed4d357d83fcfc435d70f7104d6d68e0febde6');
  const { sampleRate, samples } = parseWav(new Uint8Array(bytes));
  expect(sampleRate).toBe(16000);
  expect(samples.length / sampleRate).toBeCloseTo(23.1, 5);
});

it('grants permission, rejects an unknown fake name', async () => {
  await expect(createFakePitchSource('baritone-scale').requestPermission()).resolves.toBe('granted');
  expect(() => createFakePitchSource('nope')).toThrow('unknown fake mic');
});

it('emits 10 buffers of 1600 samples at 16 kHz per second, and stop halts them', async () => {
  const src = createFakePitchSource('baritone-scale');
  const got: PcmBuffer[] = [];
  await src.start((b) => got.push(b), 'low');
  jest.advanceTimersByTime(1000);
  expect(got).toHaveLength(10);
  expect(got[0]!.samples).toHaveLength(1600);
  expect(got[0]!.sampleRate).toBe(16000);
  src.stop();
  jest.advanceTimersByTime(1000);
  expect(got).toHaveLength(10);
});

it('stops at the end of the section', async () => {
  const src = createFakePitchSource('baritone-scale');
  const got: PcmBuffer[] = [];
  await src.start((b) => got.push(b), 'high');
  jest.advanceTimersByTime(10000);
  const [a, b] = FAKE_MIC_SECTIONS.high;
  expect(got).toHaveLength(Math.round(((b - a) * 16000) / 1600));
});

it('the high section reads as C4 once the quiet second is over', async () => {
  const src = createFakePitchSource('baritone-scale');
  const frames: PitchFrame[] = [];
  const framer = createFramer((f) => frames.push(f));
  await src.start((b) => framer.push(b), 'high');
  jest.advanceTimersByTime(3000);
  const voiced = frames.filter((f) => f.t > 1.3 && f.t < 1.9 && f.hz !== null && f.clarity > 0.9);
  expect(voiced.length).toBeGreaterThan(5);
  for (const f of voiced) expect(Math.abs(f.hz! - 261.6)).toBeLessThan(2);
  expect(frames.filter((f) => f.t < 1.0).every((f) => f.rms < 0.003)).toBe(true);
});

it('fake source song section: one pass with a held A4 (the falsetto chip E2E), then the sing slice loops', async () => {
  const src = createFakePitchSource('baritone-scale');
  const got: PcmBuffer[] = [];
  await src.start((b) => got.push(b), 'song');
  const [a, b] = FAKE_MIC_SECTIONS.song;
  const [sa, sb] = FAKE_MIC_SECTIONS.sing;
  expect(a).toBe(sb);
  const first = Math.ceil(((b - a) * 16000) / 1600);
  const perPass = Math.ceil(((sb - sa) * 16000) / 1600);
  jest.advanceTimersByTime((first + perPass * 2) * 100 + 500);
  expect(got.length).toBe(first + perPass * 2 + 5);
  // After the first pass the sing slice repeats.
  expect(Array.from(got[first + perPass]!.samples)).toEqual(Array.from(got[first]!.samples));
  for (let i = 1; i < got.length; i++) expect(got[i]!.timestamp).toBeGreaterThan(got[i - 1]!.timestamp);
  src.stop();
  const n = got.length;
  jest.advanceTimersByTime(1000);
  expect(got).toHaveLength(n);
});

it('the song pass ends on a held A4 of 1.5 s, above anything the sing slice reaches', async () => {
  const src = createFakePitchSource('baritone-scale');
  const frames: PitchFrame[] = [];
  const framer = createFramer((f) => frames.push(f));
  await src.start((b) => framer.push(b), 'song');
  const [a, b] = FAKE_MIC_SECTIONS.song;
  jest.advanceTimersByTime((b - a) * 1000 + 200);
  src.stop();
  const end = b - a;
  const high = frames.filter((f) => f.t > end - 1.3 && f.t < end - 0.3 && f.hz !== null && f.clarity > 0.9);
  expect(high.length).toBeGreaterThan(20);
  for (const f of high) expect(Math.abs(f.hz! - 440)).toBeLessThan(3);
  const before = frames.filter((f) => f.t < end - 1.7 && f.hz !== null && f.clarity > 0.9);
  expect(Math.max(...before.map((f) => f.hz!))).toBeLessThan(270); // ≤ C4 (261.6 Hz)
});

it('a stop() that lands before the asset loads leaves no timer running', async () => {
  const src = createFakePitchSource('baritone-scale');
  const got: PcmBuffer[] = [];
  const started = src.start((b) => got.push(b), 'low');
  src.stop();
  await started;
  jest.advanceTimersByTime(2000);
  expect(got).toHaveLength(0);
  expect(jest.getTimerCount()).toBe(0);
});

it('stops the source on unmount', async () => {
  const { result, unmount } = renderHook(() => useFakePitchSource());
  const got: PcmBuffer[] = [];
  await result.current.start((b) => got.push(b), 'low');
  jest.advanceTimersByTime(300);
  unmount();
  jest.advanceTimersByTime(1000);
  expect(got).toHaveLength(3);
});
