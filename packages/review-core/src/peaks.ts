const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Decode base64 uint8 peaks (waveform-data) to 0..1 floats. No atob/Buffer: runs anywhere. */
export function decodePeaks(base64: string): Float32Array {
  const clean = base64.replace(/[^A-Za-z0-9+/\-_]/g, '').replace(/-/g, '+').replace(/_/g, '/');
  const bytes: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const ch of clean) {
    acc = (acc << 6) | B64.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((acc >> bits) & 0xff);
      acc &= (1 << bits) - 1;
    }
  }
  const out = new Float32Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = bytes[i]! / 255;
  return out;
}

/**
 * Max per bucket with a fractional stride (length / buckets), so bucket i covers
 * [i*stride, (i+1)*stride) with no drift and the last bucket includes the final sample.
 */
export function downsamplePeaks(peaks: ArrayLike<number>, buckets: number): number[] {
  const n = peaks.length;
  const out: number[] = new Array(Math.max(0, Math.floor(buckets))).fill(0);
  if (n === 0) return out;
  const stride = n / out.length;
  for (let i = 0; i < out.length; i++) {
    let from = Math.ceil(i * stride);
    let to = Math.min(n, Math.ceil((i + 1) * stride));
    if (to <= from) {
      // More buckets than samples: the bucket holds no whole sample, use the one it falls in.
      from = Math.min(n - 1, Math.floor(i * stride));
      to = from + 1;
    }
    let m = 0;
    for (let j = from; j < to; j++) if (peaks[j]! > m) m = peaks[j]!;
    out[i] = m;
  }
  return out;
}
