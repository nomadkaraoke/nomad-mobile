import { insertGapLines, openVocalGaps } from '../vocalGaps';
import { countUntimedWords } from '../timing';
import { docWith, gapOf, line, word } from './helpers';

const base = [line('a', [word('a', 10, 11)]), line('b', [word('b', 40, 41)])];

describe('openVocalGaps', () => {
  it('returns evidenced and suspect gaps with no word inside, sorted', () => {
    const g1 = gapOf({ start: 30, end: 36 });
    const g2 = gapOf({ start: 15, end: 20, evidenced: false });
    const g3 = gapOf({ start: 50, end: 55, suspect: false, evidenced: false });
    expect(openVocalGaps(docWith(base, { vocal_gaps: { gaps: [g1, g2, g3] } }))).toEqual([g2, g1]);
  });
  it('ignores neighbours touching the edges but not overlapping words', () => {
    const d = docWith([line('a', [word('a', 28, 30.02)]), line('b', [word('b', 35.98, 38)])], { vocal_gaps: { gaps: [gapOf()] } });
    expect(openVocalGaps(d)).toHaveLength(1);
    const over = docWith([line('a', [word('a', 28, 31)])], { vocal_gaps: { gaps: [gapOf()] } });
    expect(openVocalGaps(over)).toHaveLength(0);
  });
  it('is empty with no vocal_gaps, and skips zero-length gaps', () => {
    expect(openVocalGaps(docWith(base))).toEqual([]);
    expect(openVocalGaps(docWith(base, { vocal_gaps: { gaps: [gapOf({ start: 5, end: 5 })] } }))).toEqual([]);
  });
});

describe('insertGapLines', () => {
  it('inserts untimed reference lines between the neighbours, bounded by the gap', () => {
    const gap = gapOf({ reference_lines: { genius: ['hello there', '  ', 'oh my'] } });
    const { doc, insertedAt } = insertGapLines(docWith(base, { vocal_gaps: { gaps: [gap] } }), gap);
    expect(insertedAt).toBe(1);
    expect(doc.segments.map((s) => s.text)).toEqual(['a', 'hello there', 'oh my', 'b']);
    expect(doc.segments[1]).toMatchObject({ start_time: 30, end_time: 36 });
    expect(countUntimedWords(doc.segments)).toBe(4);
    expect(openVocalGaps(doc)).toHaveLength(1); // untimed words do not close the gap
  });

  it('prefers synced lines and uses the reference segments timings', () => {
    const gap = gapOf({ synced_reference_lines: { lrclib: ['la la'] }, reference_lines: { genius: ['other'] } });
    const ref = {
      lrclib: { segments: [line('r1', [{ ...word('la', 31, 32), text: 'la' }, { ...word('la2', 32, 33), text: 'la' }], { text: 'la la' })] },
    };
    const d = docWith(base, { vocal_gaps: { gaps: [gap] }, reference_lyrics: ref as never });
    const { doc } = insertGapLines(d, gap);
    expect(doc.segments[1]!.words.map((w) => [w.start_time, w.end_time])).toEqual([[31, 32], [32, 33]]);
    expect(doc.segments[1]!.start_time).toBe(31);
    expect(openVocalGaps(doc)).toHaveLength(0);
  });

  it('compresses a reference line that overruns the next line, untimes one that cannot fit', () => {
    const gap = gapOf({ start: 30, end: 36, synced_reference_lines: { s: ['one two', 'three four'] } });
    const ref = {
      s: {
        segments: [
          line('r1', [{ ...word('a', 31, 33), text: 'one' }, { ...word('b', 33, 37), text: 'two' }], { text: 'one two' }),
          line('r2', [{ ...word('c', 37, 38), text: 'three' }, { ...word('d', 38, 39), text: 'four' }], { text: 'three four' }),
        ],
      },
    };
    const segs = [line('a', [word('a', 10, 11)]), line('b', [word('b', 35, 36.5)])];
    const { doc } = insertGapLines(docWith(segs, { vocal_gaps: { gaps: [gap] }, reference_lyrics: ref as never }), gap);
    const first = doc.segments[1]!;
    expect(first.end_time!).toBeLessThanOrEqual(34.95);
    expect(first.words.every((w) => w.start_time !== null)).toBe(true);
    // r2 starts at 37 > gap.end: not matched as inside the gap -> untimed
    expect(doc.segments[2]!.words.every((w) => w.start_time === null)).toBe(true);
  });

  it('untimes a timed line when the room is too small', () => {
    const gap = gapOf({ start: 30, end: 31, synced_reference_lines: { s: ['one two'] } });
    const ref = { s: { segments: [line('r', [{ ...word('a', 30.1, 30.2), text: 'one' }, { ...word('b', 30.2, 30.3), text: 'two' }], { text: 'one two' })] } };
    const segs = [line('a', [word('a', 29, 30.95)]), line('b', [word('b', 31, 32)])];
    const { doc } = insertGapLines(docWith(segs, { reference_lyrics: ref as never }), gap);
    const ins = doc.segments.find((s) => s.text === 'one two')!;
    expect(ins.words.every((w) => w.start_time === null)).toBe(true);
  });

  it('inserts one empty line spanning the gap when there are no reference lines', () => {
    const gap = gapOf({ reference_lines: {} });
    const { doc, insertedAt } = insertGapLines(docWith(base), gap);
    expect(insertedAt).toBe(1);
    expect(doc.segments[1]).toMatchObject({ text: '', words: [], start_time: 30, end_time: 36 });
  });

  it('splits a line that spans the gap and copies the neighbouring singer', () => {
    const gap = gapOf({ start: 12, end: 14, reference_lines: { g: ['mid'] } });
    const segs = [line('a', [word('a', 10, 11), word('b', 15, 16)], { singer: 2 })];
    const { doc, insertedAt } = insertGapLines(docWith(segs), gap);
    expect(insertedAt).toBe(1);
    expect(doc.segments.map((s) => s.text)).toEqual(['a', 'mid', 'b']);
    expect(doc.segments[1]!.singer).toBe(2);
    expect(doc.segments[0]!.id).toBe('a');
    expect(doc.segments[2]!.id).not.toBe('a');
  });

  it('appends after the last line when every word is before the gap', () => {
    const gap = gapOf({ reference_lines: { g: ['end'] } });
    const { insertedAt } = insertGapLines(docWith([line('a', [word('a', 1, 2)])]), gap);
    expect(insertedAt).toBe(1);
  });
});
