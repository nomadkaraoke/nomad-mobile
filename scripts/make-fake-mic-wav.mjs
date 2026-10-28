// Generates apps/mobile/assets/fake-mic/baritone-scale.wav: a synthetic "singer" for the FAKE_MIC E2E source.
// 16 kHz mono PCM16, 23.1 s, four sections (low / high / sing / song: the sing notes ending on a held A4, the
// voice session's falsetto-chip E2E). Each opens with 1.2 s of silence (the quiet
// second the noise floor is measured on). Deterministic: a test asserts the sha256 of the output.
// Usage: node scripts/make-fake-mic-wav.mjs
import { Buffer } from 'node:buffer';
import { mkdirSync, writeFileSync } from 'node:fs';

const RATE = 16000;
const HARMONICS = [1, 0.5, 0.25, 0.125];
const GAIN = 0.4 / HARMONICS.reduce((a, b) => a + b, 0);
const FADE = 0.005;
const SILENCE = 1.2;

// [midi, seconds] per note
const SECTIONS = [
  { notes: [57, 52, 48, 45].map((m) => [m, 0.8]) }, // low: A3 E3 C3 A2
  { notes: [60, 64].map((m) => [m, 0.8]) }, // high: C4 E4
  { notes: [55, 57, 59, 60, 57, 55, 59, 57, 53, 55].map((m) => [m, 0.6]) }, // sing
  // song: the sing notes, then A4 held 1.5 s (well above a baritone's chest comfort top: a falsetto candidate)
  { notes: [...[55, 57, 59, 60, 57, 55, 59, 57, 53, 55].map((m) => [m, 0.6]), [69, 1.5]] },
];

const midiToHz = (m) => 440 * 2 ** ((m - 69) / 12);

function note(midi, seconds) {
  const n = Math.round(seconds * RATE);
  const f = midiToHz(midi);
  const out = new Float32Array(n);
  const fade = Math.round(FADE * RATE);
  for (let i = 0; i < n; i++) {
    let s = 0;
    HARMONICS.forEach((a, k) => (s += a * Math.sin((2 * Math.PI * f * (k + 1) * i) / RATE)));
    const env = Math.min(1, i / fade, (n - 1 - i) / fade);
    out[i] = s * GAIN * env;
  }
  return out;
}

const parts = [];
for (const section of SECTIONS) {
  parts.push(new Float32Array(Math.round(SILENCE * RATE)));
  for (const [m, s] of section.notes) parts.push(note(m, s));
}
const total = parts.reduce((a, p) => a + p.length, 0);
const pcm = Buffer.alloc(total * 2);
let o = 0;
for (const p of parts) for (const v of p) pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32767))), (o++) * 2);

const header = Buffer.alloc(44);
header.write('RIFF', 0);
header.writeUInt32LE(36 + pcm.length, 4);
header.write('WAVEfmt ', 8);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);
header.writeUInt16LE(1, 22);
header.writeUInt32LE(RATE, 24);
header.writeUInt32LE(RATE * 2, 28);
header.writeUInt16LE(2, 32);
header.writeUInt16LE(16, 34);
header.write('data', 36);
header.writeUInt32LE(pcm.length, 40);

const dir = new URL('../apps/mobile/assets/fake-mic/', import.meta.url);
mkdirSync(dir, { recursive: true });
writeFileSync(new URL('baritone-scale.wav', dir), Buffer.concat([header, pcm]));
console.log(`wrote baritone-scale.wav: ${(total / RATE).toFixed(2)} s`);
