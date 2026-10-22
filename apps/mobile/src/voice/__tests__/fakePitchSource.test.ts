import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PitchFrame } from '@nomad/core';
import { parseWav } from '@nomad/core';
import { createFramer } from '../framer';
import { createFakePitchSource, FAKE_MIC_SECTIONS } from '../useFakePitchSource';
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
  expect(createHash('sha256').update(bytes).digest('hex')).toBe('11db3bc4fbce569fa2d6719008c36ca67ba065f1ccb3663c69ae5b7680e88dcf');
  const { sampleRate, samples } = parseWav(new Uint8Array(bytes));
  expect(sampleRate).toBe(16000);
  expect(samples.length / sampleRate).toBeCloseTo(14.4, 5);
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
