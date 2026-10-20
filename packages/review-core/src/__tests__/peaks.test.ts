import { decodePeaks, downsamplePeaks } from '../peaks';

const b64 = (bytes: number[]): string => {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let s = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    s += A[(n >> 18) & 63]! + A[(n >> 12) & 63]! + (i + 1 < bytes.length ? A[(n >> 6) & 63]! : '=') + (i + 2 < bytes.length ? A[n & 63]! : '=');
  }
  return s;
};

describe('decodePeaks', () => {
  it('decodes uint8 to 0..1 (padded and unpadded lengths)', () => {
    for (const bytes of [[0, 255, 51, 102], [255], [0, 128]]) {
      const out = decodePeaks(b64(bytes));
      expect(Array.from(out)).toEqual(bytes.map((b) => Math.fround(b / 255)));
    }
  });
  it('tolerates url-safe base64, whitespace and empty input', () => {
    expect(Array.from(decodePeaks('-_8='))).toEqual([Math.fround(251 / 255), Math.fround(255 / 255)]);
    expect(decodePeaks(' ').length).toBe(0);
  });
});

describe('downsamplePeaks', () => {
  it('uses a fractional stride with no drift over 44,100 points into 400 buckets', () => {
    const peaks = new Float32Array(44100);
    peaks[110] = 0.5; // 110 < 110.25 -> bucket 0
    peaks[111] = 0.6; // bucket 1 starts at 110.25 -> first sample 111
    peaks[44099] = 0.9; // the final sample is in the last bucket
    const out = downsamplePeaks(peaks, 400);
    expect(out).toHaveLength(400);
    expect(out[0]).toBeCloseTo(0.5);
    expect(out[1]).toBeCloseTo(0.6);
    expect(out[399]).toBeCloseTo(0.9);
    expect(out.slice(2, 399).every((v) => v === 0)).toBe(true);
  });
  it('takes the max per bucket', () => {
    expect(downsamplePeaks([0.1, 0.9, 0.2, 0.3], 2)).toEqual([0.9, 0.3]);
  });
  it('handles more buckets than samples and empty input', () => {
    expect(downsamplePeaks([0.5, 1], 4)).toEqual([0.5, 0.5, 1, 1]);
    expect(downsamplePeaks([], 3)).toEqual([0, 0, 0]);
  });
});
