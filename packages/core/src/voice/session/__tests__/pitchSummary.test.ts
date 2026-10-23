import { findHeldNotes } from '../../heldNotes';
import { framesFor } from '../../testSignals';
import { summarizeSongPitch } from '../index';

/** Consecutive held notes `from..to`, `dur` seconds each (10 ms hop). */
const line = (from: number, to: number, dur: number) =>
  framesFor(Array.from({ length: to - from + 1 }, (_, i) => ({ midi: from + i, dur })));

describe('summarizeSongPitch', () => {
  it('a 31 s line 50..62: voiced time, held extremes, nearest-rank percentiles', () => {
    const frames = line(50, 62, 2.4); // 13 notes x 240 frames
    const held = findHeldNotes(frames);
    expect(held).toHaveLength(13);
    const s = summarizeSongPitch(frames, held)!;
    expect(s.voicedS).toBeCloseTo(31.2, 6);
    expect(s).toMatchObject({ heldCount: 13, heldLow: 50, heldHigh: 62 });
    // nearest rank over 3120 frames: p10 -> rank 312 (note 51), p50 -> 1560 (56), p90 -> 2808 (61)
    expect([s.p10, s.p50, s.p90]).toEqual([51, 56, 61]);
  });

  it('vibrato does not move the held extremes off the sung notes', () => {
    const frames = framesFor([
      { midi: 48, dur: 6, vibratoCents: 30 },
      { midi: 55, dur: 6, vibratoCents: 30 },
      { midi: 60, dur: 6, vibratoCents: 30 },
    ]);
    const s = summarizeSongPitch(frames, findHeldNotes(frames))!;
    expect(s).toMatchObject({ heldLow: 48, heldHigh: 60 });
    expect(s.p50).toBeCloseTo(55, 0);
  });

  it('null under 10 s of voiced singing (8 s line)', () => {
    const frames = line(50, 53, 2);
    const held = findHeldNotes(frames);
    expect(held.length).toBeGreaterThanOrEqual(2);
    expect(summarizeSongPitch(frames, held)).toBeNull();
  });

  it('null with fewer than 2 held notes', () => {
    const frames = line(50, 62, 2.4);
    expect(summarizeSongPitch(frames, findHeldNotes(frames).slice(0, 1))).toBeNull();
    expect(summarizeSongPitch(frames, [])).toBeNull();
  });

  it('null with no frames', () => {
    expect(summarizeSongPitch([], [])).toBeNull();
  });

  it('frame order does not matter (voiced time from the median hop)', () => {
    const frames = line(50, 62, 2.4);
    const held = findHeldNotes(frames);
    expect(summarizeSongPitch([...frames].reverse(), held)).toEqual(summarizeSongPitch(frames, held));
  });
});
