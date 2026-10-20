import fixture from './fixtures/correctionData.json';
import type { LyricsSegment, Word } from '../types';
import { activeLine, clampSyncTime, countUntimedWords, firstUntimed, sanitizeSegment } from '../timing';

const segs = fixture.corrected_segments as unknown as LyricsSegment[];
const w = (id: string, s: number | null, e: number | null): Word => ({ id, text: id, start_time: s, end_time: e });
const seg = (words: Word[], start: number | null = null, end: number | null = null): LyricsSegment => ({
  id: 's', text: 't', words, start_time: start, end_time: end,
});

describe('sanitizeSegment', () => {
  it('clamps end >= start on a word', () => {
    const out = sanitizeSegment(seg([w('a', 5, 4.9)]));
    expect(out.words[0]!.end_time).toBe(5);
  });

  it('recomputes segment bounds from first and last timed words', () => {
    const out = sanitizeSegment(seg([w('a', null, null), w('b', 2, 3), w('c', null, null), w('d', 4, 6), w('e', null, null)], 0, 99));
    expect(out.start_time).toBe(2);
    expect(out.end_time).toBe(6);
  });

  it('keeps null bounds for an all-null segment without NaN', () => {
    const out = sanitizeSegment(seg([w('a', null, null), w('b', null, null)], 3, 4));
    expect(out.start_time).toBeNull();
    expect(out.end_time).toBeNull();
    expect(out.words.every((x) => x.start_time === null && x.end_time === null)).toBe(true);
  });

  it('keeps an empty segment null-bounded', () => {
    const out = sanitizeSegment(seg([], 1, 2));
    expect(out.start_time).toBeNull();
    expect(out.end_time).toBeNull();
  });

  it('handles a word with only one bound set', () => {
    const out = sanitizeSegment(seg([w('a', 1, null), w('b', null, 3)]));
    expect(out.words.map((x) => [x.start_time, x.end_time])).toEqual([[1, null], [null, 3]]);
    expect(Number.isNaN(out.start_time as number)).toBe(false);
  });

  it('does not mutate its input and returns the same object when unchanged', () => {
    const input = seg([w('a', 1, 2)], 1, 2);
    expect(sanitizeSegment(input)).toBe(input);
    const bad = seg([w('a', 5, 4)], 5, 5);
    sanitizeSegment(bad);
    expect(bad.words[0]!.end_time).toBe(4);
  });
});

describe('untimed words', () => {
  it('counts only null-timed words (fixture: 3 + 1)', () => {
    expect(countUntimedWords(segs)).toBe(4);
    expect(countUntimedWords([])).toBe(0);
  });

  it('counts a word with either bound null as untimed', () => {
    expect(countUntimedWords([seg([w('a', 1, null), w('b', null, 2), w('c', 1, 2)])])).toBe(2);
  });

  it('finds the first untimed word, or null', () => {
    expect(firstUntimed(segs)).toEqual({ segment: 1, word: 0 });
    expect(firstUntimed([segs[0]!, segs[3]!])).toBeNull();
    expect(firstUntimed([segs[0]!, segs[2]!])).toEqual({ segment: 1, word: 1 });
  });
});

describe('clampSyncTime', () => {
  it('passes a time inside the window', () => expect(clampSyncTime(0.5, 2, 4)).toBe(0.5));
  it('floors at 0', () => expect(clampSyncTime(-1, 1, 4)).toBe(0));
  it('caps at segEnd + 3', () => expect(clampSyncTime(9, 2, 4)).toBe(7));
  it('allows 3 s before the start', () => expect(clampSyncTime(6, 10, 14)).toBe(7));
  it('lifts times earlier than start - 3', () => expect(clampSyncTime(2, 10, 14)).toBe(7));
});

describe('activeLine', () => {
  const L = (s: number | null, e: number | null): LyricsSegment => seg([], s, e);
  const lines = [L(10, 12), L(12, 14), L(20, 22)];

  it('is -1 before the first line and for an empty list', () => {
    expect(activeLine(lines, 5)).toBe(-1);
    expect(activeLine([], 5)).toBe(-1);
  });
  it('finds the containing line', () => {
    expect(activeLine(lines, 10)).toBe(0);
    expect(activeLine(lines, 13)).toBe(1);
    expect(activeLine(lines, 21)).toBe(2);
  });
  it('stays on the last started line in a gap and after the end', () => {
    expect(activeLine(lines, 16)).toBe(1);
    expect(activeLine(lines, 99)).toBe(2);
  });
  it('skips untimed lines and uses first timed word when segment start is null', () => {
    const s = [L(10, 12), L(null, null), seg([w('a', 15, 16)], null, null)];
    expect(activeLine(s, 11)).toBe(0);
    expect(activeLine(s, 14)).toBe(0);
    expect(activeLine(s, 15.5)).toBe(2);
    expect(activeLine([L(null, null)], 3)).toBe(-1);
  });
});
