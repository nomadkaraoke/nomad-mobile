import type { LyricsSegment, Word } from '../types';
import { fromCorrectionData, type ReviewDoc } from '../doc';
import { commitTapSync, createTapSync, press, release, shouldStop } from '../tapSync';
import fixture from './fixtures/correctionData.json';
import type { CorrectionData } from '../types';

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
