import { Directory, File } from 'expo-file-system';
import type { PcmBuffer } from '../../voice/pitchSource';

/** The recording's format: 16 kHz mono PCM16 (decide's `audio/wav` fallback). */
export const WAV_RATE = 16000;
const HEADER_BYTES = 44;
/** PCM is buffered in JS and written in appends of at least this many bytes (one native call per ~8 s of audio). */
export const WAV_APPEND_BYTES = 256 * 1024;

export type FinishedRecording = { uri: string; durationS: number; bytes: number };
export type WavSink = {
  push(b: PcmBuffer): void;
  finish(): Promise<FinishedRecording>;
  abort(): void;
};

/** The 44-byte RIFF/WAVE header for `dataBytes` of 16 kHz mono PCM16. */
function wavHeader(dataBytes: number): Uint8Array {
  const h = new Uint8Array(HEADER_BYTES);
  const v = new DataView(h.buffer);
  const ascii = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) h[o + i] = s.charCodeAt(i);
  };
  ascii(0, 'RIFF');
  v.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, WAV_RATE, true);
  v.setUint32(28, WAV_RATE * 2, true); // byte rate
  v.setUint16(32, 2, true); // block align
  v.setUint16(34, 16, true); // bits per sample
  ascii(36, 'data');
  v.setUint32(40, dataBytes, true);
  return h;
}

let seq = 0;

/**
 * Streams PCM buffers into a WAV file in `dir`: resampled to 16 kHz mono PCM16 by linear interpolation (16 kHz input,
 * e.g. the fake mic, is copied as is), appended to the file in ≥ 256 KiB slices, and the header's sizes fixed up in
 * `finish()`. `abort()` deletes the file.
 */
export function createWavSink(dir: string): WavSink {
  const folder = new Directory(dir);
  folder.create({ intermediates: true, idempotent: true });
  const file = new File(dir, `take-${Date.now()}-${++seq}.wav`);
  file.create({ overwrite: true });
  // Placeholder header (sizes 0); finish() rewrites it in place.
  file.write(wavHeader(0));

  let pending = new Uint8Array(WAV_APPEND_BYTES * 2);
  let pendingLen = 0;
  let dataBytes = 0;
  let closed = false;
  // Resampler state: `pos` is the next output sample's position in input samples, relative to the start of the next
  // buffer (it may be in [-1, 0): between the previous buffer's last sample, `prev`, and the next buffer's first).
  let rate = 0;
  let step = 1;
  let pos = 0;
  let prev = 0;

  const writePending = () => {
    if (pendingLen === 0) return;
    file.write(pending.slice(0, pendingLen), { append: true });
    dataBytes += pendingLen;
    pendingLen = 0;
  };

  const put = (x: number) => {
    if (pendingLen + 2 > pending.length) {
      const grown = new Uint8Array(pending.length * 2);
      grown.set(pending.subarray(0, pendingLen));
      pending = grown;
    }
    const c = Math.max(-1, Math.min(1, x));
    const s = Math.round(c * 32767);
    pending[pendingLen++] = s & 0xff;
    pending[pendingLen++] = (s >> 8) & 0xff;
  };

  return {
    push(b) {
      if (closed || b.samples.length === 0) return;
      if (b.sampleRate !== rate) {
        rate = b.sampleRate;
        step = rate / WAV_RATE;
      }
      const s = b.samples;
      const n = s.length;
      while (pos <= n - 1) {
        const i = Math.floor(pos);
        const frac = pos - i;
        const a = i < 0 ? prev : s[i]!;
        const next = i + 1 < n ? s[i + 1]! : a;
        put(frac === 0 ? a : a + (next - a) * frac);
        pos += step;
      }
      pos -= n;
      prev = s[n - 1]!;
      if (pendingLen >= WAV_APPEND_BYTES) writePending();
    },
    async finish() {
      if (closed) throw new Error('wav sink closed');
      closed = true;
      writePending();
      const handle = file.open();
      try {
        handle.offset = 0;
        handle.writeBytes(wavHeader(dataBytes));
      } finally {
        handle.close();
      }
      return { uri: file.uri, durationS: dataBytes / 2 / WAV_RATE, bytes: HEADER_BYTES + dataBytes };
    },
    abort() {
      closed = true;
      pendingLen = 0;
      try {
        if (file.exists) file.delete();
      } catch {
        // Already gone.
      }
    },
  };
}
