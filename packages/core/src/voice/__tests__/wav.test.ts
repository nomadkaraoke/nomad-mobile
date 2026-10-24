import { parseWav } from '../wav';

function wav(format: number, bits: number, channels: number, data: number[], rate = 16000): Uint8Array {
  const bytesPer = bits / 8;
  const dataLen = data.length * bytesPer;
  const buf = new ArrayBuffer(44 + dataLen);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + dataLen, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, format, true);
  v.setUint16(22, channels, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * channels * bytesPer, true);
  v.setUint16(32, channels * bytesPer, true);
  v.setUint16(34, bits, true);
  str(36, 'data');
  v.setUint32(40, dataLen, true);
  if (bits === 32 || bits === 16) data.forEach((s, i) => (bits === 32 ? v.setFloat32(44 + i * 4, s, true) : v.setInt16(44 + i * 2, s, true)));
  return new Uint8Array(buf);
}

describe('parseWav', () => {
  it('reads a PCM16 mono header and samples', () => {
    const { sampleRate, samples } = parseWav(wav(1, 16, 1, [0, 16384, -32768]));
    expect(sampleRate).toBe(16000);
    expect(Array.from(samples)).toEqual([0, 0.5, -1]);
  });
  it('takes channel 0 of stereo', () => {
    const { samples } = parseWav(wav(1, 16, 2, [16384, -16384, 8192, -8192]));
    expect(Array.from(samples)).toEqual([0.5, 0.25]);
  });
  it('reads float32', () => {
    const { samples } = parseWav(wav(3, 32, 1, [0.25, -0.5], 44100));
    expect(Array.from(samples)).toEqual([0.25, -0.5]);
  });
  it('skips extra chunks before data', () => {
    const base = wav(1, 16, 1, [16384]);
    const extra = new Uint8Array([...'LIST'].map((c) => c.charCodeAt(0)).concat([2, 0, 0, 0, 1, 2]));
    const bytes = new Uint8Array([...base.slice(0, 36), ...extra, ...base.slice(36)]);
    expect(Array.from(parseWav(bytes).samples)).toEqual([0.5]);
  });
  it('throws on unsupported input', () => {
    expect(() => parseWav(wav(1, 8, 1, [1, 2]))).toThrow('unsupported wav');
    expect(() => parseWav(wav(1, 16, 3, [1, 2, 3]))).toThrow('unsupported wav');
    expect(() => parseWav(new Uint8Array(10))).toThrow('unsupported wav');
    expect(() => parseWav(new Uint8Array(44))).toThrow('unsupported wav');
  });
});
