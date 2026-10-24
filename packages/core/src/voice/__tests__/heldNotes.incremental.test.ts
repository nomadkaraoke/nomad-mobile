import type { VoicedFrame } from '../frames';
import { findHeldNotes, type HeldNote } from '../heldNotes';

/** The original batch algorithm (re-sorts the whole run on every frame), kept as the reference. */
function batchFindHeldNotes(
  frames: VoicedFrame[],
  opts: { minHoldS?: number; tolCents?: number; maxGapS?: number; medianWindowS?: number } = {},
): HeldNote[] {
  const median = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    const mid = s.length >> 1;
    return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
  };
  const { minHoldS = 0.5, tolCents = 50, maxGapS = 0.1, medianWindowS = 0.2 } = opts;
  const eps = 1e-9;
  const sorted = [...frames].sort((a, b) => a.t - b.t);
  const notes: HeldNote[] = [];
  const segments: VoicedFrame[][] = [];
  for (const f of sorted) {
    const seg = segments[segments.length - 1];
    if (seg && f.t - seg[seg.length - 1]!.t <= maxGapS + eps) seg.push(f);
    else segments.push([f]);
  }
  for (const seg of segments) {
    const r: number[] = [];
    let lo = 0;
    for (let i = 0; i < seg.length; i++) {
      while (seg[i]!.t - seg[lo]!.t > medianWindowS + eps) lo++;
      r.push(median(seg.slice(lo, i + 1).map((f) => f.midi)));
    }
    let first = 0;
    let runMed = r[0]!;
    const close = (last: number) => {
      if (seg[last]!.t - seg[first]!.t >= minHoldS - eps) {
        notes.push({ start: seg[first]!.t, end: seg[last]!.t, midi: runMed, note: Math.round(runMed) });
      }
    };
    for (let i = 1; i < seg.length; i++) {
      if (Math.abs(r[i]! - runMed) <= tolCents / 100) runMed = median(r.slice(first, i + 1));
      else {
        close(i - 1);
        first = i;
        runMed = r[i]!;
      }
    }
    close(seg.length - 1);
  }
  return notes;
}

/** Deterministic PRNG (mulberry32) so a failure is reproducible from its seed. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Random voiced track: held notes, slides, vibrato, octave spikes, short and long gaps, at 31 or 94 fps. */
function randomSignal(seed: number): VoicedFrame[] {
  const rand = rng(seed);
  const fps = rand() < 0.5 ? 31.25 : 93.75;
  const frames: VoicedFrame[] = [];
  let t = 0;
  let midi = 40 + rand() * 30;
  const pieces = 2 + Math.floor(rand() * 8);
  for (let p = 0; p < pieces; p++) {
    const dur = 0.1 + rand() * 3;
    const kind = rand();
    const slope = kind < 0.2 ? (rand() - 0.5) * 10 : 0;
    const vib = rand() < 0.5 ? rand() * 0.6 : 0;
    const vibHz = 4 + rand() * 3;
    const n = Math.round(dur * fps);
    for (let i = 0; i < n; i++) {
      let m = midi + slope * (i / fps) + vib * Math.sin(2 * Math.PI * vibHz * (i / fps));
      if (rand() < 0.03) m += rand() < 0.5 ? 12 : -12;
      // Quantise some values so duplicates (and even-length median ties) actually occur.
      if (rand() < 0.3) m = Math.round(m * 4) / 4;
      frames.push({ t, midi: m });
      t += 1 / fps;
    }
    midi = kind < 0.2 ? midi + slope * dur : 40 + rand() * 30;
    t += rand() < 0.5 ? rand() * 0.3 : 0;
  }
  return frames;
}

describe('findHeldNotes (incremental run median) equals the batch reference', () => {
  it.each(Array.from({ length: 200 }, (_, i) => i + 1))('seed %i', (seed) => {
    const frames = randomSignal(seed);
    expect(findHeldNotes(frames)).toEqual(batchFindHeldNotes(frames));
  });

  it('the random signals actually exercise held notes (not just empty results)', () => {
    let notes = 0;
    let withNotes = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const n = batchFindHeldNotes(randomSignal(seed)).length;
      notes += n;
      if (n > 0) withNotes++;
    }
    expect(withNotes).toBeGreaterThan(100);
    expect(notes).toBeGreaterThan(200);
  });

  it('also with non-default options', () => {
    for (let seed = 1000; seed < 1050; seed++) {
      const frames = randomSignal(seed);
      const opts = { minHoldS: 0.3, tolCents: 30, maxGapS: 0.15, medianWindowS: 0.1 };
      expect(findHeldNotes(frames, opts)).toEqual(batchFindHeldNotes(frames, opts));
    }
  });

  it('a 20 s continuous hold at 94 fps runs in well under the old cost', () => {
    const frames: VoicedFrame[] = [];
    for (let i = 0; i < 20 * 93.75; i++) frames.push({ t: i / 93.75, midi: 45 + 0.1 * Math.sin(i / 3) });
    findHeldNotes(frames);
    const t0 = performance.now();
    const notes = findHeldNotes(frames);
    const ms = performance.now() - t0;
    expect(notes).toHaveLength(1);
    // The old re-sorting version took ~125 ms here; the incremental one takes a few ms.
    expect(ms).toBeLessThan(20);
  });
});
