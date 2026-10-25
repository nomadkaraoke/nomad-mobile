import type { VoicedFrame } from '../frames';
import { createHeldNoteTracker, TRACKER_MAX_PENDING_S } from '../heldNoteTracker';
import { findHeldNotes } from '../heldNotes';

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

/**
 * A long voiced track (`secs` of it): held notes, slides, vibrato, octave spikes, short and long gaps. With
 * `gapP = 0` no piece is followed by a gap, so (spikes aside) the whole track is one continuous segment.
 */
function longSignal(seed: number, secs: number, gapP = 0.5): VoicedFrame[] {
  const rand = rng(seed);
  const fps = rand() < 0.5 ? 31.25 : 93.75;
  const frames: VoicedFrame[] = [];
  let t = 0;
  let midi = 40 + rand() * 30;
  while (t < secs) {
    const dur = 0.1 + rand() * 3;
    const kind = rand();
    const slope = kind < 0.3 ? (rand() - 0.5) * 10 : 0;
    const vib = rand() < 0.5 ? rand() * 0.6 : 0;
    const vibHz = 4 + rand() * 3;
    const n = Math.round(dur * fps);
    for (let i = 0; i < n; i++) {
      let m = midi + slope * (i / fps) + vib * Math.sin(2 * Math.PI * vibHz * (i / fps));
      if (rand() < 0.03) m += rand() < 0.5 ? 12 : -12;
      if (rand() < 0.3) m = Math.round(m * 4) / 4;
      frames.push({ t, midi: m });
      t += 1 / fps;
    }
    midi = kind < 0.3 ? Math.min(75, Math.max(35, midi + slope * dur)) : 40 + rand() * 30;
    if (rand() < gapP) t += rand() * 0.4;
  }
  return frames;
}

/** Feeds frames like the voice test does: one push per frame, notes() once per `perCall` frames (a mic buffer). */
function track(frames: VoicedFrame[], perCall: number, check?: (notes: ReturnType<typeof findHeldNotes>, i: number) => void, maxPendingS?: number) {
  const tr = createHeldNoteTracker({}, maxPendingS === undefined ? {} : { maxPendingS });
  let maxPending = 0;
  for (let i = 0; i < frames.length; i++) {
    tr.push(frames[i]!);
    if ((i + 1) % perCall === 0 || i === frames.length - 1) {
      const notes = tr.notes();
      check?.(notes, i);
      maxPending = Math.max(maxPending, tr.pendingFrames);
    }
  }
  return { notes: tr.notes(), maxPending };
}

describe('createHeldNoteTracker equals findHeldNotes over every frame so far', () => {
  it.each(Array.from({ length: 40 }, (_, i) => i + 1))('seed %i: 120 s with gaps, checked at every buffer', (seed) => {
    const frames = longSignal(seed, 120);
    const { notes } = track(frames, 5, (got, i) => {
      if (i % 50 === 4) expect(got).toEqual(findHeldNotes(frames.slice(0, i + 1)));
    });
    expect(notes).toEqual(findHeldNotes(frames));
    expect(notes.length).toBeGreaterThan(5);
  });

  it.each(Array.from({ length: 20 }, (_, i) => i + 100))('seed %i: 120 s with no gaps, compacting every 8 s', (seed) => {
    const frames = longSignal(seed, 120, 0);
    const { notes, maxPending } = track(frames, 3, undefined, 8);
    expect(notes).toEqual(findHeldNotes(frames));
    // Bounded: nowhere near the 120 s of frames, even though the track is (nearly) one continuous segment.
    expect(maxPending).toBeLessThan(frames.length / 4);
  });
});

describe('createHeldNoteTracker on one long continuous segment', () => {
  const fps = 93.75;
  /** 60 s with no gap: a 12 semitones/s zig-zag between 40 and 70 (too fast to hold, even at its turns), except 1 s holds at 5 s (43), 35 s (67), 55 s (50). */
  function slideWithHolds(): VoicedFrame[] {
    const holds = [
      { at: 5, midi: 43 },
      { at: 35, midi: 67 },
      { at: 55, midi: 50 },
    ];
    const frames: VoicedFrame[] = [];
    for (let i = 0; i < 60 * fps; i++) {
      const t = i / fps;
      const hold = holds.find((h) => t >= h.at && t < h.at + 1);
      const phase = (t * 12) % 60; // 0..60 semitones of travel per up-and-down cycle
      const zig = 40 + (phase < 30 ? phase : 60 - phase);
      frames.push({ t, midi: hold ? hold.midi : zig });
    }
    return frames;
  }

  it('a 60 s slide with holds at 5 s, 35 s and 55 s yields all three', () => {
    const frames = slideWithHolds();
    const { notes, maxPending } = track(frames, 9);
    expect(notes.map((n) => n.note)).toEqual([43, 67, 50]);
    expect(notes[0]!.start).toBeCloseTo(5, 0);
    expect(notes[1]!.start).toBeCloseTo(35, 0);
    expect(notes[2]!.start).toBeCloseTo(55, 0);
    expect(notes).toEqual(findHeldNotes(frames));
    expect(maxPending).toBeLessThanOrEqual((TRACKER_MAX_PENDING_S + 1) * fps);
  });

  it('a 70 s unbroken hold is split, not dropped, and stays bounded', () => {
    const frames: VoicedFrame[] = [];
    for (let i = 0; i < 70 * fps; i++) frames.push({ t: i / fps, midi: 45 + 0.1 * Math.sin(i / 3) });
    const { notes, maxPending } = track(frames, 9);
    expect(notes.length).toBeGreaterThanOrEqual(2);
    expect(notes.every((n) => n.note === 45)).toBe(true);
    expect(notes[0]!.start).toBe(0);
    expect(notes[notes.length - 1]!.end).toBe(frames[frames.length - 1]!.t);
    expect(maxPending).toBeLessThanOrEqual((TRACKER_MAX_PENDING_S + 1) * fps);
  });

  it('reset() forgets everything', () => {
    const tr = createHeldNoteTracker();
    for (let i = 0; i < 100; i++) tr.push({ t: i / fps, midi: 45 });
    expect(tr.notes()).toHaveLength(1);
    tr.reset();
    expect(tr.notes()).toEqual([]);
    expect(tr.pendingFrames).toBe(0);
  });
});
