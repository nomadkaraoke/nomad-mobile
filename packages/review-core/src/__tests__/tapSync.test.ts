import type { CorrectionData, LyricsSegment, Word } from '../types';
import { fromCorrectionData, type ReviewDoc } from '../doc';
import { commitTapSync, createTapSync, press, release, shouldStop } from '../tapSync';
import fixture from './fixtures/correctionData.json';

const w = (id: string, s: number | null = null, e: number | null = null): Word => ({ id, text: id, start_time: s, end_time: e });
const docOf = (segments: LyricsSegment[]): ReviewDoc => ({
  source: { corrected_segments: segments } as unknown as CorrectionData,
  segments,
  isDuet: false,
});
const seg = (words: Word[], start: number | null, end: number | null, id = 's'): LyricsSegment => ({
  id, text: 't', words, start_time: start, end_time: end,
});
const tap = (s: ReturnType<typeof createTapSync>, t: number) => release(press(s, t), t + 0.05, 50);

describe('Tap To Sync', () => {
  it('a tap sequence gap-fills the previous word', () => {
    let s = createTapSync(docOf([seg([w('a'), w('b'), w('c')], 9, 12)]), 0);
    s = tap(s, 10);
    s = tap(s, 10.4);
    s = tap(s, 10.9);
    const [a, b, c] = s.segment.words;
    expect([a!.start_time, b!.start_time, c!.start_time]).toEqual([10, 10.4, 10.9]);
    expect(a!.end_time).toBeCloseTo(10.39);
    expect(b!.end_time).toBeCloseTo(10.89);
    expect(c!.end_time).toBeCloseTo(11.9);
    expect(s.done).toBe(true);
  });

  it('caps a gap fill at 1 s', () => {
    let s = createTapSync(docOf([seg([w('a'), w('b')], 9, 15)]), 0);
    s = tap(s, 10);
    s = press(s, 14);
    expect(s.segment.words[0]!.end_time).toBe(11);
  });

  it('a hold keeps its release time', () => {
    let s = createTapSync(docOf([seg([w('a'), w('b')], 9, 12)]), 0);
    s = release(press(s, 10), 10.6, 600);
    expect(s.segment.words[0]!.end_time).toBe(10.6);
    s = press(s, 11);
    expect(s.segment.words[0]!.end_time).toBe(10.6);
  });

  it('a hold that overruns the next onset is pulled back', () => {
    let s = createTapSync(docOf([seg([w('a'), w('b')], 9, 12)]), 0);
    s = release(press(s, 10), 10.6, 600);
    s = press(s, 10.5);
    expect(s.segment.words[0]!.end_time).toBeCloseTo(10.49);
  });

  it('clamps an early press to segStart - 3 s', () => {
    const s = press(createTapSync(docOf([seg([w('a')], 5, 8)]), 0), 0.2);
    expect(s.segment.words[0]!.start_time).toBe(2);
  });

  it('does not truncate a tap against a stale next-word start', () => {
    let s = createTapSync(docOf([seg([w('a', 9, 9.5), w('b', 10.2, 10.6)], 9, 11)]), 0);
    s = tap(s, 10);
    expect(s.synced.has(1)).toBe(false);
    expect(s.segment.words[0]!.end_time).toBe(11);
  });

  it('shouldStop is false while holding, true past end + 1 s', () => {
    let s = createTapSync(docOf([seg([w('a')], 5, 8)]), 0);
    expect(shouldStop(s, 9)).toBe(false);
    expect(shouldStop(s, 9.5)).toBe(true);
    s = press(s, 7);
    expect(shouldStop(s, 20)).toBe(false);
  });

  it('ignores press while holding or done, and release when not holding', () => {
    const s0 = createTapSync(docOf([seg([w('a')], 5, 8)]), 0);
    expect(release(s0, 6, 10)).toBe(s0);
    const held = press(s0, 6);
    expect(press(held, 7)).toBe(held);
    const done = release(held, 6.1, 10);
    expect(done.done).toBe(true);
    expect(press(done, 7)).toBe(done);
    expect(release(done, 7, 10)).toBe(done);
  });

  it('an abandoned press does not keep a stale end', () => {
    const s = press(createTapSync(docOf([seg([w('a', 5, 6)], 5, 8)]), 0), 7);
    expect(s.segment.words[0]).toMatchObject({ start_time: 7, end_time: 7 });
  });

  it('commit leaves no word with end < start and keeps other segments', () => {
    const doc = docOf([seg([w('a', 1, 2)], 1, 2, 'x'), seg([w('a'), w('b')], 9, 12, 'y')]);
    let s = createTapSync(doc, 1);
    s = tap(s, 10);
    s = tap(s, 10.5);
    const out = commitTapSync(doc, s);
    for (const word of out.segments[1]!.words) expect(word.end_time!).toBeGreaterThanOrEqual(word.start_time!);
    expect(out.segments[1]!.start_time).toBe(10);
    expect(out.segments[0]).toBe(doc.segments[0]);
  });

  it('a pass that stops early never leaves an untapped word starting before the tapped ones', () => {
    // Gen's fake fixture line 3 (15.5-19.5, five words) with line 4 at 20.0. Taps land late (slow taps on Android CI:
    // review-3 / review-10), so the pass auto-stops after four words; the fifth keeps its stale 18.74-19.5.
    const line3 = seg([w('nothing', 15.5, 16.26), w('here', 16.31, 17.07), w('was', 17.12, 17.88), w('ever', 17.93, 18.69),
      w('transcribed', 18.74, 19.5)], 15.5, 19.5, 's3');
    const line4 = seg([w('workers', 20, 20.53)], 20, 20.53, 's4');
    const doc = docOf([line3, line4]);
    let s = createTapSync(doc, 0);
    for (const t of [16.0, 17.2, 18.4, 19.6]) s = tap(s, t);
    expect(shouldStop(s, 20.6)).toBe(true);
    const out = commitTapSync(doc, s).segments[0]!.words;
    let prevEnd = -Infinity;
    for (const word of out) {
      if (word.start_time === null) continue;
      expect(word.start_time).toBeGreaterThanOrEqual(prevEnd);
      prevEnd = word.end_time ?? word.start_time;
    }
    // The stale word goes untimed (the untimed issue blocks Finish and leads to it); "ever" isn't squashed to 0 s.
    expect(out[4]).toMatchObject({ start_time: null, end_time: null });
    expect(out[3]!.start_time).toBe(19.6);
    expect(out[3]!.end_time).toBeGreaterThan(19.6);
    expect(out[3]!.end_time).toBeLessThan(20);
  });

  it('an untapped word that still starts after the last tapped one keeps its timing', () => {
    const doc = docOf([seg([w('a', 10, 10.5), w('b', 11, 11.5), w('c', 12, 12.5)], 10, 12.5)]);
    let s = createTapSync(doc, 0);
    s = tap(s, 10.1);
    s = tap(s, 10.9);
    const out = commitTapSync(doc, s).segments[0]!.words;
    expect(out[2]).toMatchObject({ start_time: 12, end_time: 12.5 });
    expect(out[1]!.end_time).toBeLessThan(12);
  });

  it('hold threshold is 200 ms (gen TAP_THRESHOLD_MS)', () => {
    const mk = () => press(createTapSync(docOf([seg([w('a'), w('b')], 9, 12)]), 0), 10);
    expect(release(mk(), 10.2, 199).segment.words[0]!.end_time).toBe(11); // tap
    expect(release(mk(), 10.2, 200).segment.words[0]!.end_time).toBe(10.2); // hold
  });

  describe('commit caps the last tapped word', () => {
    it('finished pass: capped before the next line start', () => {
      const doc = docOf([seg([w('a'), w('b')], 9, 12, 'x'), seg([w('c', 10.6, 11)], 10.6, 11, 'y')]);
      let s = createTapSync(doc, 0);
      s = tap(s, 10);
      s = tap(s, 10.4); // last word: tap end = 11.4
      expect(s.done).toBe(true);
      const out = commitTapSync(doc, s);
      expect(out.segments[0]!.words[1]!.end_time).toBeCloseTo(10.59);
      expect(out.segments[0]!.words[0]!.end_time).toBeCloseTo(10.39);
    });
    it('partial pass: capped before the next, un-resynced word in the same line', () => {
      const doc = docOf([seg([w('a', 9, 9.5), w('b', 10.5, 11), w('c', 11.5, 12)], 9, 12)]);
      let s = createTapSync(doc, 0);
      s = tap(s, 10); // stopped here, b/c keep stale timing
      const out = commitTapSync(doc, s);
      expect(out.segments[0]!.words[0]).toMatchObject({ start_time: 10, end_time: expect.closeTo(10.49) });
      expect(out.segments[0]!.words[1]).toMatchObject({ start_time: 10.5, end_time: 11 });
    });
    it('never goes below the word start and leaves an uncapped last line alone', () => {
      const doc = docOf([seg([w('a'), w('b')], 9, 12, 'x'), seg([w('c', 10.001, 11)], 10.001, 11, 'y')]);
      let s = createTapSync(doc, 0);
      s = tap(s, 10);
      s = tap(s, 10.0001);
      expect(commitTapSync(doc, s).segments[0]!.words[1]!.end_time).toBe(10.0001);
      const solo = docOf([seg([w('a')], 9, 12)]);
      expect(commitTapSync(solo, tap(createTapSync(solo, 0), 10)).segments[0]!.words[0]!.end_time).toBe(11);
    });
    it('commit without any tap changes nothing but sanitization', () => {
      const doc = docOf([seg([w('a', 1, 2)], 1, 2)]);
      expect(commitTapSync(doc, createTapSync(doc, 0)).segments[0]).toEqual(doc.segments[0]);
    });
  });

  it('empty segment is done immediately; bad index throws', () => {
    expect(createTapSync(docOf([seg([], 1, 2)]), 0).done).toBe(true);
    expect(() => createTapSync(docOf([]), 0)).toThrow(RangeError);
  });

  describe('bounds of a fully untimed line', () => {
    const doc = fromCorrectionData(fixture as unknown as CorrectionData);
    it('uses neighbour lines (seg-1 sits between 15.9 and 20)', () => {
      const s = createTapSync(doc, 1);
      expect([s.segStart, s.segEnd]).toEqual([15.9, 20]);
    });
    it('uses caller fallbacks when there are no neighbours', () => {
      const d = docOf([seg([w('a')], null, null)]);
      const s = createTapSync(d, 0, { fallbackStart: 30, fallbackEnd: 34 });
      expect([s.segStart, s.segEnd]).toEqual([30, 34]);
      const z = createTapSync(d, 0);
      expect([z.segStart, z.segEnd]).toEqual([0, 10]);
    });
    it('uses timed words when the segment bounds are null', () => {
      const s = createTapSync(docOf([seg([w('a', 4, 5), w('b')], null, null)]), 0);
      expect([s.segStart, s.segEnd]).toEqual([4, 5]);
    });
  });
});
