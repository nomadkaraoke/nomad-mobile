import type { CorrectionData, LyricsSegment, Word } from '../types';
import { fromCorrectionData, type ReviewDoc } from '../doc';
import {
  applyLineText, deleteLine, deleteWord, editWordText, insertLine, mergeLines, mergeWords,
  setDuet, setLineSinger, setWordTiming, shiftLine, splitLine, splitWord,
} from '../edits';

const W = (id: string, text: string, s: number | null, e: number | null, extra: Partial<Word> = {}): Word => ({
  id, text, start_time: s, end_time: e, ...extra,
});
const S = (id: string, words: Word[], extra: Partial<LyricsSegment> = {}): LyricsSegment => {
  const timed = words.filter((w) => w.start_time !== null);
  return {
    id, words, text: words.map((w) => w.text).join(' '),
    start_time: timed.length ? timed[0]!.start_time : null,
    end_time: timed.length ? timed[timed.length - 1]!.end_time : null, ...extra,
  };
};
const mk = (segments: LyricsSegment[]): ReviewDoc =>
  fromCorrectionData({ corrected_segments: segments, metadata: {} } as unknown as CorrectionData);

const fox = () =>
  mk([S('a', [W('1', 'the', 1, 2), W('2', 'quick', 2, 3), W('3', 'brown', 3, 4), W('4', 'fox', 4, 5)])]);

describe('deleteWord', () => {
  it('removes a word and recomputes segment bounds', () => {
    const d = deleteWord(fox(), 0, 0);
    expect(d.segments[0]!.text).toBe('quick brown fox');
    expect(d.segments[0]!.start_time).toBe(2);
    const e = deleteWord(d, 0, 2);
    expect(e.segments[0]!.end_time).toBe(4);
  });
  it('deleting the last word deletes the segment and keeps other identities', () => {
    const doc = mk([S('a', [W('1', 'x', 1, 2)]), S('b', [W('2', 'y', 3, 4)])]);
    const d = deleteWord(doc, 0, 0);
    expect(d.segments).toHaveLength(1);
    expect(d.segments[0]).toBe(doc.segments[1]);
  });
  it('ignores bad indices', () => {
    const doc = fox();
    expect(deleteWord(doc, 5, 0)).toBe(doc);
    expect(deleteWord(doc, 0, 9)).toBe(doc);
  });
});

describe('splitWord', () => {
  it('splits evenly with estimated flags and derived ids', () => {
    const d = splitWord(fox(), 0, 1, ['qu', 'ick']);
    const ws = d.segments[0]!.words;
    expect(ws.map((w) => w.text)).toEqual(['the', 'qu', 'ick', 'brown', 'fox']);
    expect(ws[1]).toMatchObject({ id: '2_s0', start_time: 2, end_time: 2.5, timing_estimated: true });
    expect(ws[2]).toMatchObject({ id: '2_s1', start_time: 2.5, end_time: 3, timing_estimated: true });
    expect(d.segments[0]!.text).toBe('the qu ick brown fox');
  });
  it('splits an untimed word into untimed parts and keeps original_text on the first', () => {
    const doc = mk([S('a', [W('1', 'ab', null, null, { original_text: 'zz', ai_corrected: true })])]);
    const ws = splitWord(doc, 0, 0, ['a', 'b']).segments[0]!.words;
    expect(ws[0]).toMatchObject({ start_time: null, original_text: 'zz', ai_corrected: true });
    expect(ws[1]!.original_text).toBeUndefined();
  });
  it('is a no-op for empty parts or a bad index', () => {
    const doc = fox();
    expect(splitWord(doc, 0, 0, [' ', ''])).toBe(doc);
    expect(splitWord(doc, 0, 8, ['a'])).toBe(doc);
  });
});

describe('editWordText', () => {
  it('replaces text keeping timing', () => {
    const d = editWordText(fox(), 0, 1, 'slow');
    expect(d.segments[0]!.words[1]).toMatchObject({ text: 'slow', start_time: 2, end_time: 3 });
    expect(d.segments[0]!.text).toBe('the slow brown fox');
  });
  it('splits when the text has spaces', () => {
    const d = editWordText(fox(), 0, 1, 'very quick');
    expect(d.segments[0]!.words).toHaveLength(5);
    expect(d.segments[0]!.words[1]!.timing_estimated).toBe(true);
  });
  it('deletes on empty text', () => {
    expect(editWordText(fox(), 0, 1, '  ').segments[0]!.text).toBe('the brown fox');
  });
  it('ignores a bad index', () => {
    const doc = fox();
    expect(editWordText(doc, 3, 0, 'x')).toBe(doc);
  });
});

describe('mergeWords', () => {
  it('uses start of w, end of w+1, joined with a space', () => {
    const d = mergeWords(fox(), 0, 1);
    expect(d.segments[0]!.words[1]).toMatchObject({ text: 'quick brown', start_time: 2, end_time: 4 });
    expect(d.segments[0]!.words).toHaveLength(3);
  });
  it('is a no-op on the last word', () => {
    const doc = fox();
    expect(mergeWords(doc, 0, 3)).toBe(doc);
  });
});

describe('applyLineText', () => {
  it('keeps matched timings and estimates new words', () => {
    const { doc, estimated } = applyLineText(fox(), 0, 'the quik brown red fox');
    const ws = doc.segments[0]!.words;
    expect(ws.map((w) => w.text)).toEqual(['the', 'quik', 'brown', 'red', 'fox']);
    expect(ws[0]).toMatchObject({ id: '1', start_time: 1, end_time: 2 });
    expect(ws[2]).toMatchObject({ id: '3', start_time: 3, end_time: 4 });
    expect(ws[4]).toMatchObject({ id: '4', start_time: 4, end_time: 5 });
    expect(ws[1]).toMatchObject({ start_time: 2, end_time: 3, timing_estimated: true });
    expect(ws[3]).toMatchObject({ start_time: 4, end_time: 4, timing_estimated: true });
    expect(ws[0]!.timing_estimated).toBeUndefined();
    expect(estimated).toBe(2);
  });
  it('matches case-insensitively and adopts the new casing', () => {
    const { doc, estimated } = applyLineText(fox(), 0, 'The Quick brown fox');
    expect(doc.segments[0]!.words[0]).toMatchObject({ id: '1', text: 'The', start_time: 1 });
    expect(estimated).toBe(0);
  });
  it('spreads a run of new words evenly between neighbours', () => {
    const { doc } = applyLineText(fox(), 0, 'the a b c fox');
    const ws = doc.segments[0]!.words;
    expect(ws[1]!.start_time).toBe(2);
    expect(ws[1]!.end_time).toBeCloseTo(2 + 2 / 3);
    expect(ws[3]!.end_time).toBe(4);
    const r = applyLineText(mk([S('a', [W('1', 'x', 0, 4), W('2', 'y', 4, 6)])]), 0, 'x p q y').doc.segments[0]!.words;
    expect(r[1]).toMatchObject({ start_time: 4, end_time: 4 });
  });
  it('falls back to segment bounds when there are no timed neighbours', () => {
    const { doc, estimated } = applyLineText(fox(), 0, 'totally different words');
    const ws = doc.segments[0]!.words;
    expect(ws[0]!.start_time).toBe(1);
    expect(ws[2]!.end_time).toBe(5);
    expect(estimated).toBe(3);
    expect(doc.segments[0]!.start_time).toBe(1);
  });
  it('leaves new words untimed when the line has no timing at all', () => {
    const doc = mk([S('a', [W('1', 'a', null, null)])]);
    const r = applyLineText(doc, 0, 'a b');
    expect(r.estimated).toBe(0);
    expect(r.doc.segments[0]!.words[1]).toMatchObject({ start_time: null, end_time: null });
  });
  it('deletes the line on empty text and ignores bad index', () => {
    expect(applyLineText(fox(), 0, '  ').doc.segments).toHaveLength(0);
    const doc = fox();
    expect(applyLineText(doc, 4, 'x').doc).toBe(doc);
  });
  it('keeps untouched segment identity', () => {
    const doc = mk([S('a', [W('1', 'x', 0, 1)]), S('b', [W('2', 'y', 2, 3)])]);
    expect(applyLineText(doc, 0, 'z').doc.segments[1]).toBe(doc.segments[1]);
  });
});

describe('splitLine / mergeLines', () => {
  it('splits at word w', () => {
    const d = splitLine(fox(), 0, 2);
    expect(d.segments.map((s) => s.text)).toEqual(['the quick', 'brown fox']);
    expect(d.segments[0]).toMatchObject({ start_time: 1, end_time: 3 });
    expect(d.segments[1]).toMatchObject({ start_time: 3, end_time: 5 });
    expect(d.segments[0]!.id).not.toBe(d.segments[1]!.id);
  });
  it('carries singer to both halves and rejects out-of-range w', () => {
    const doc = mk([S('a', [W('1', 'a', 0, 1), W('2', 'b', 1, 2)], { singer: 2 })]);
    expect(splitLine(doc, 0, 1).segments.map((s) => s.singer)).toEqual([2, 2]);
    expect(splitLine(doc, 0, 0)).toBe(doc);
    expect(splitLine(doc, 0, 2)).toBe(doc);
    expect(splitLine(doc, 3, 1)).toBe(doc);
  });
  it('merges with the next line', () => {
    const doc = mk([S('a', [W('1', 'a', 0, 1)]), S('b', [W('2', 'b', 2, 3)]), S('c', [W('3', 'c', 4, 5)])]);
    const d = mergeLines(doc, 0);
    expect(d.segments).toHaveLength(2);
    expect(d.segments[0]).toMatchObject({ id: 'a', text: 'a b', start_time: 0, end_time: 3 });
    expect(d.segments[1]).toBe(doc.segments[2]);
    expect(mergeLines(doc, 2)).toBe(doc);
  });
  it('pins the second line singer onto its words when singers differ', () => {
    const doc = mk([S('a', [W('1', 'a', 0, 1)], { singer: 2 }), S('b', [W('2', 'b', 2, 3), W('3', 'c', 3, 4, { singer: 0 })])]);
    const ws = mergeLines(doc, 0).segments[0]!.words;
    expect(ws[1]!.singer).toBe(1);
    expect(ws[2]!.singer).toBe(0);
    const same = mk([S('a', [W('1', 'a', 0, 1)]), S('b', [W('2', 'b', 2, 3)])]);
    expect(mergeLines(same, 0).segments[0]!.words[1]!.singer).toBeUndefined();
  });
});

describe('insertLine / deleteLine', () => {
  it('inserts after a segment with evenly timed words and inherited singer', () => {
    const doc = mk([S('a', [W('1', 'a', 0, 1)], { singer: 2 }), S('b', [W('2', 'b', 5, 6)])]);
    const d = insertLine(doc, 0, 'la la', 2, 4);
    expect(d.segments).toHaveLength(3);
    const n = d.segments[1]!;
    expect(n).toMatchObject({ text: 'la la', start_time: 2, end_time: 4, singer: 2 });
    expect(n.words.map((w) => [w.start_time, w.end_time])).toEqual([[2, 3], [3, 4]]);
  });
  it('inserts at the start with -1 and rejects bad input', () => {
    const doc = fox();
    expect(insertLine(doc, -1, 'hey', 0, 1).segments[0]!.text).toBe('hey');
    expect(insertLine(doc, -1, 'hey', 0, 1).segments[0]!.singer).toBeUndefined();
    expect(insertLine(doc, 0, ' ', 0, 1)).toBe(doc);
    expect(insertLine(doc, 7, 'x', 0, 1)).toBe(doc);
  });
  it('deletes a line', () => {
    const doc = mk([S('a', [W('1', 'a', 0, 1)]), S('b', [W('2', 'b', 2, 3)])]);
    expect(deleteLine(doc, 0).segments).toEqual([doc.segments[1]]);
    expect(deleteLine(doc, 5)).toBe(doc);
  });
});

describe('shiftLine', () => {
  const three = () =>
    mk([
      S('a', [W('1', 'a', 1, 2)]),
      S('b', [W('2', 'b', 4, 5), W('3', 'c', null, null), W('4', 'd', 6, 7)]),
      S('c', [W('5', 'e', 10, 11)]),
    ]);
  it('shifts keeping relative timings and null words null', () => {
    const d = shiftLine(three(), 1, 1);
    expect(d.segments[1]!.words.map((w) => [w.start_time, w.end_time])).toEqual([[5, 6], [null, null], [7, 8]]);
    expect(d.segments[1]).toMatchObject({ start_time: 5, end_time: 8 });
  });
  it('clamps against the previous and next lines', () => {
    expect(shiftLine(three(), 1, -10).segments[1]!.start_time).toBe(2);
    expect(shiftLine(three(), 1, 10).segments[1]!.end_time).toBe(10);
  });
  it('floors at 0 for the first line, is unbounded after the last', () => {
    expect(shiftLine(three(), 0, -5).segments[0]!.start_time).toBe(0);
    expect(shiftLine(three(), 2, 50).segments[2]!.start_time).toBe(60);
  });
  it('no-ops on zero effective delta, untimed lines and bad index', () => {
    const doc = three();
    expect(shiftLine(doc, 1, 0)).toBe(doc);
    const un = mk([S('a', [W('1', 'a', null, null)])]);
    expect(shiftLine(un, 0, 1)).toBe(un);
    expect(shiftLine(doc, 9, 1)).toBe(doc);
  });
});

describe('setWordTiming', () => {
  const two = () =>
    mk([
      S('a', [W('1', 'a', 1, 2), W('2', 'b', 2.5, 3)]),
      S('b', [W('3', 'c', 4, 5), W('4', 'd', 6, 7)]),
    ]);
  it('clamps start to the previous word end, including the previous line', () => {
    expect(setWordTiming(two(), 0, 1, { start: 0.1 }).segments[0]!.words[1]!.start_time).toBe(2);
    expect(setWordTiming(two(), 1, 0, { start: 0 }).segments[1]!.words[0]!.start_time).toBe(3);
  });
  it("cannot cross the next line's first word", () => {
    const d = setWordTiming(two(), 0, 1, { end: 9 });
    expect(d.segments[0]!.words[1]!.end_time).toBe(4);
    expect(d.segments[0]!.end_time).toBe(4);
  });
  it('clamps to the next word within a line', () => {
    expect(setWordTiming(two(), 0, 0, { end: 8 }).segments[0]!.words[0]!.end_time).toBe(2.5);
  });
  it('enforces the 0.05 s minimum length', () => {
    const d = setWordTiming(two(), 1, 1, { end: 6.01 });
    expect(d.segments[1]!.words[1]!.end_time).toBeCloseTo(6.05);
  });
  it('clamps end to audioDuration only when given', () => {
    expect(setWordTiming(two(), 1, 1, { end: 99, audioDuration: 7.5 }).segments[1]!.words[1]!.end_time).toBe(7.5);
    expect(setWordTiming(two(), 1, 1, { end: 99 }).segments[1]!.words[1]!.end_time).toBe(99);
  });
  it('floors start at 0 for the very first word', () => {
    expect(setWordTiming(two(), 0, 0, { start: -3 }).segments[0]!.words[0]!.start_time).toBe(0);
  });
  it('times an untimed word from one bound, skipping untimed neighbours', () => {
    const doc = mk([S('a', [W('1', 'a', 1, 2), W('2', 'b', null, null), W('3', 'c', null, null), W('4', 'd', 6, 7)])]);
    const d = setWordTiming(doc, 0, 1, { start: 3 });
    expect(d.segments[0]!.words[1]).toMatchObject({ start_time: 3, end_time: 3.05 });
    const e = setWordTiming(doc, 0, 2, { end: 5 });
    expect(e.segments[0]!.words[2]).toMatchObject({ start_time: 4.95, end_time: 5 });
    expect(setWordTiming(doc, 0, 1, {})).toBe(doc);
  });
  it('is a no-op when nothing changes or index is bad', () => {
    const doc = two();
    expect(setWordTiming(doc, 0, 0, { start: 1, end: 2 })).toBe(doc);
    expect(setWordTiming(doc, 5, 0, { start: 1 })).toBe(doc);
  });
});

describe('duet', () => {
  const duet = () =>
    mk([S('a', [W('1', 'a', 0, 1, { singer: 2 })], { singer: 2 }), S('b', [W('2', 'b', 1, 2)])]);
  it('sets a line singer', () => {
    const d = setLineSinger(duet(), 1, 0);
    expect(d.segments[1]!.singer).toBe(0);
    expect(setLineSinger(duet(), 9, 1).segments).toHaveLength(2);
  });
  it('setDuet(true) only flips the flag; false strips singers', () => {
    const on = setDuet(duet(), true);
    expect(on.isDuet).toBe(true);
    expect(on.segments[0]!.singer).toBe(2);
    const off = setDuet(on, false);
    expect(off.isDuet).toBe(false);
    expect(off.segments[0]!.singer).toBeUndefined();
    expect(off.segments[0]!.words[0]!.singer).toBeUndefined();
    expect(off.segments[1]).toBe(on.segments[1]);
  });
});
