import { toSubmission } from '../doc';
import { insertGapLines, insertGapText, openVocalGaps } from '../vocalGaps';
import { countUntimedWords } from '../timing';
import { docWith, gapOf, line, word } from './helpers';

const base = [line('a', [word('a', 10, 11)]), line('b', [word('b', 40, 41)])];

const gaps = (d: ReturnType<typeof docWith>) => openVocalGaps(d).map((o) => o.gap);

describe('openVocalGaps', () => {
  it('returns evidenced gaps with no word inside, sorted; suspect-only gaps are ignored', () => {
    const g1 = gapOf({ start: 30, end: 36 });
    const g2 = gapOf({ start: 15, end: 20 });
    const g3 = gapOf({ start: 50, end: 55, evidenced: false });
    expect(gaps(docWith(base, { vocal_gaps: { gaps: [g1, g2, g3] } }))).toEqual([g2, g1]);
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
  it('is not pending when nothing untimed sits in the gap', () => {
    expect(openVocalGaps(docWith(base, { vocal_gaps: { gaps: [gapOf()] } }))[0]).toMatchObject({ pending: false, pendingSegment: null });
  });
  it('is pending when untimed words sit between the gap neighbours (document order)', () => {
    const segs = [line('a', [word('a', 10, 11)]), line('mid', [word('m', null, null)]), line('b', [word('b', 40, 41)])];
    expect(openVocalGaps(docWith(segs, { vocal_gaps: { gaps: [gapOf()] } }))[0]).toMatchObject({ pending: true, pendingSegment: 1 });
  });
  it('untimed words elsewhere do not make a gap pending', () => {
    const segs = [line('x', [word('x', null, null)]), line('a', [word('a', 10, 11)]), line('b', [word('b', 40, 41)])];
    expect(openVocalGaps(docWith(segs, { vocal_gaps: { gaps: [gapOf()] } }))[0]!.pending).toBe(false);
  });
  it('inserting reference lines makes the gap pending (no duplicate Insert)', () => {
    const gap = gapOf({ reference_lines: { g: ['hello'] } });
    const d = docWith(base, { vocal_gaps: { gaps: [gap] } });
    expect(openVocalGaps(insertGapLines(d, gap).doc)[0]).toMatchObject({ pending: true, pendingSegment: 1 });
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
    expect(openVocalGaps(doc)).toHaveLength(1); // untimed words do not close the gap (it turns pending)
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

  it('without reference lines inserts nothing and asks for text', () => {
    const gap = gapOf({ reference_lines: {}, synced_reference_lines: { x: ['  '] } });
    const d = docWith(base);
    const r = insertGapLines(d, gap);
    expect(r).toEqual({ doc: d, insertedAt: -1, needsText: true });
    expect(r.doc).toBe(d);
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

describe('insertGapText', () => {
  it('inserts one line per newline, evenly spread, estimated, within the neighbours', () => {
    const gap = gapOf({ start: 20, end: 30 });
    const { doc, insertedAt } = insertGapText(docWith(base, { vocal_gaps: { gaps: [gap] } }), gap, 'one two\n\n three four \r\nfive');
    expect(insertedAt).toBe(1);
    expect(doc.segments.map((s) => s.text)).toEqual(['a', 'one two', 'three four', 'five', 'b']);
    const words = doc.segments.slice(1, 4).flatMap((s) => s.words);
    expect(words.every((w) => w.timing_estimated === true && w.start_time! < w.end_time!)).toBe(true);
    expect(words[0]!.start_time).toBeCloseTo(20); // gap.start; preceding ends at 11
    expect(words[4]!.end_time).toBeCloseTo(30);
    expect(words[1]!.start_time).toBeCloseTo(words[0]!.end_time!);
    expect(countUntimedWords(doc.segments)).toBe(0);
    expect(openVocalGaps(doc)).toHaveLength(0);
  });
  it('stays clear of tight neighbours and falls back to the gap when there is no room', () => {
    const gap = gapOf({ start: 30, end: 31 });
    const segs = [line('a', [word('a', 29, 30.9)], { singer: 2 }), line('b', [word('b', 30.95, 32)])];
    const { doc } = insertGapText(docWith(segs), gap, 'x y z');
    expect(doc.segments[1]!.words[0]!.start_time).toBe(30);
    expect(doc.segments[1]!.singer).toBe(2);
    const roomy = insertGapText(docWith([line('a', [word('a', 29, 30.5)]), line('b', [word('b', 40, 41)])]), gapOf({ start: 30, end: 36 }), 'x');
    expect(roomy.doc.segments[1]!.words[0]!.start_time).toBeCloseTo(30.55);
  });
  it('blank text inserts nothing', () => {
    const d = docWith(base);
    expect(insertGapText(d, gapOf(), ' \n ')).toEqual({ doc: d, insertedAt: -1 });
  });
});

describe('toSubmission', () => {
  it('drops wordless segments', () => {
    const d = docWith([line('a', [word('a', 1, 2)]), line('empty', [])]);
    expect(toSubmission(d).corrected_segments.map((s) => s.id)).toEqual(['a']);
  });
});
