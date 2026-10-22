/** Parses a RIFF/WAVE file: PCM16 or float32, mono or stereo (channel 0 is used). */
export function parseWav(bytes: Uint8Array): { sampleRate: number; samples: Float32Array } {
  const fail = (): never => {
    throw new Error('unsupported wav');
  };
  if (bytes.length < 12) return fail();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number) => String.fromCharCode(bytes[o]!, bytes[o + 1]!, bytes[o + 2]!, bytes[o + 3]!);
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return fail();

  let fmt: { format: number; channels: number; sampleRate: number; bits: number } | null = null;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const id = tag(offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === 'fmt ') {
      if (size < 16 || body + 16 > bytes.length) return fail();
      fmt = {
        format: view.getUint16(body, true),
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bits: view.getUint16(body + 14, true),
      };
    } else if (id === 'data') {
      if (!fmt) return fail();
      const { format, channels, sampleRate, bits } = fmt;
      const isPcm16 = format === 1 && bits === 16;
      const isFloat32 = format === 3 && bits === 32;
      if ((!isPcm16 && !isFloat32) || (channels !== 1 && channels !== 2) || sampleRate <= 0) return fail();
      const bytesPer = bits / 8;
      const end = Math.min(bytes.length, body + size);
      const frames = Math.floor((end - body) / (bytesPer * channels));
      const samples = new Float32Array(frames);
      for (let i = 0; i < frames; i++) {
        const o = body + i * bytesPer * channels;
        samples[i] = isPcm16 ? view.getInt16(o, true) / 32768 : view.getFloat32(o, true);
      }
      return { sampleRate, samples };
    }
    offset = body + size + (size % 2);
  }
  return fail();
}
