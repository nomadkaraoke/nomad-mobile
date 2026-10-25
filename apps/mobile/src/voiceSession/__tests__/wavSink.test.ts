import { parseWav } from '@nomad/core';
import { fsState } from '../../test-utils/memoryFs';
import { createWavSink, WAV_APPEND_BYTES } from '../recording/wavSink';

// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories can't use imports
jest.mock('expo-file-system', () => require('../../test-utils/memoryFs'));

const DIR = 'file:///document/voice-recordings';

/** `seconds` of a sine at `hz`, sampled at `rate`, in buffers of `chunk` samples. */
function tone(hz: number, rate: number, seconds: number, chunk = 4800) {
  const n = Math.round(rate * seconds);
  const out: { samples: Float32Array; sampleRate: number; timestamp: number }[] = [];
  for (let start = 0; start < n; start += chunk) {
    const len = Math.min(chunk, n - start);
    const samples = new Float32Array(len);
    for (let i = 0; i < len; i++) samples[i] = 0.5 * Math.sin((2 * Math.PI * hz * (start + i)) / rate);
    out.push({ samples, sampleRate: rate, timestamp: start / rate });
  }
  return out;
}

beforeEach(() => fsState.reset());

describe('wavSink', () => {
  it('wav header and length: 1 s of 48 kHz float is 16 kHz mono PCM16, 32,044 bytes', async () => {
    const sink = createWavSink(DIR);
    for (const b of tone(440, 48000, 1)) sink.push(b);
    const r = await sink.finish();
    expect(r.bytes).toBe(32044);
    expect(r.durationS).toBeCloseTo(1, 6);
    expect(r.uri.startsWith(`${DIR}/`)).toBe(true);
    expect(r.uri.endsWith('.wav')).toBe(true);
    const bytes = fsState.files.get(r.uri)!;
    expect(bytes.length).toBe(32044);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const tag = (o: number) => String.fromCharCode(...bytes.slice(o, o + 4));
    expect(tag(0)).toBe('RIFF');
    expect(view.getUint32(4, true)).toBe(32044 - 8);
    expect(tag(8)).toBe('WAVE');
    expect(tag(12)).toBe('fmt ');
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint32(28, true)).toBe(32000); // byte rate
    expect(view.getUint16(34, true)).toBe(16);
    expect(tag(36)).toBe('data');
    expect(view.getUint32(40, true)).toBe(32000);
  });

  it('linear interpolation keeps the tone (resampled 44.1 kHz reads back as the same sine)', async () => {
    const sink = createWavSink(DIR);
    for (const b of tone(220, 44100, 0.5, 1023)) sink.push(b);
    const r = await sink.finish();
    const { sampleRate, samples } = parseWav(fsState.files.get(r.uri)!);
    expect(sampleRate).toBe(16000);
    expect(samples.length).toBe(8000);
    for (let i = 0; i < samples.length; i += 97) {
      expect(samples[i]!).toBeCloseTo(0.5 * Math.sin((2 * Math.PI * 220 * i) / 16000), 2);
    }
  });

  it('16 kHz input is copied sample for sample', async () => {
    const sink = createWavSink(DIR);
    sink.push({ samples: Float32Array.of(0, 0.25, -0.25, 1, -1, 2), sampleRate: 16000, timestamp: 0 });
    const r = await sink.finish();
    const { samples } = parseWav(fsState.files.get(r.uri)!);
    expect(Array.from(samples).map((v) => Math.round(v * 100) / 100)).toEqual([0, 0.25, -0.25, 1, -1, 1]);
  });

  it('writes in appends of at least 256 KiB (the last one may be smaller), header first', async () => {
    const sink = createWavSink(DIR);
    // 20 s at 16 kHz = 640,000 bytes of PCM.
    for (const b of tone(330, 16000, 20, 1600)) sink.push(b);
    const r = await sink.finish();
    expect(r.bytes).toBe(640044);
    const writes = fsState.writes.filter((w) => w.uri === r.uri);
    expect(writes[0]).toEqual({ uri: r.uri, bytes: 44, append: false });
    const appends = writes.slice(1);
    expect(appends.every((w) => w.append)).toBe(true);
    expect(appends.slice(0, -1).every((w) => w.bytes >= WAV_APPEND_BYTES)).toBe(true);
    expect(WAV_APPEND_BYTES).toBeGreaterThanOrEqual(256 * 1024);
    expect(appends.reduce((s, w) => s + w.bytes, 0)).toBe(640000);
  });

  it('abort deletes the file and leaves nothing behind', async () => {
    const sink = createWavSink(DIR);
    for (const b of tone(330, 16000, 10, 1600)) sink.push(b);
    sink.abort();
    expect([...fsState.files.keys()].filter((k) => k.startsWith(DIR))).toEqual([]);
  });

  it('an empty take still finishes as a valid 44-byte WAV', async () => {
    const r = await createWavSink(DIR).finish();
    expect(r.bytes).toBe(44);
    expect(r.durationS).toBe(0);
  });
});
