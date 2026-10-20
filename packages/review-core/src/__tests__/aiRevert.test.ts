import type { CorrectionData, LyricsSegment, Word } from '../types';
import { fromCorrectionData, type ReviewDoc } from '../doc';
import { revertAiSpan, type ServerSuggestionUndoInfo } from '../aiRevert';

const W = (id: string, text: string, s: number | null, e: number | null, extra: Partial<Word> = {}): Word => ({
  id, text, start_time: s, end_time: e, ...extra,
});
const S = (id: string, words: Word[]): LyricsSegment => ({
  id, words, text: words.map((w) => w.text).join(' '),
  start_time: words[0]!.start_time, end_time: words[words.length - 1]!.end_time,
});
const mk = (segments: LyricsSegment[], undo?: Record<string, unknown>): ReviewDoc =>
  fromCorrectionData({
    corrected_segments: segments,
    metadata: { auto_approval: { pre_applied: true, undo_info: undo } },
  } as unknown as CorrectionData);

const span = { ai_corrected: true, correction_span_id: 'sp' };

describe('revertAiSpan', () => {
  it('reverts a replace, restoring original words', () => {
    const info: ServerSuggestionUndoInfo = {
      op: 'replace', new_word_ids: ['n1'], removed_words: [W('o1', 'gold', 1, 2)],
      segment_id: 'a', prev_word_id: null, removed_segment: null,
    };
    const doc = mk(
      [S('a', [W('n1', 'old', 1, 2, { ...span, original_text: 'gold' }), W('x', 'friend', 2, 3)]), S('b', [W('y', 'z', 5, 6)])],
      { sp: info },
    );
    const d = revertAiSpan(doc, 'sp');
    expect(d.segments[0]!.words.map((w) => w.text)).toEqual(['gold', 'friend']);
    expect(d.segments[0]!.text).toBe('gold friend');
    expect(d.segments[0]!.words[0]!.ai_corrected).toBeUndefined();
    expect(d.segments[1]).toBe(doc.segments[1]);
  });
  it('reverts a multi-word replace and an insert_after', () => {
    const rep: ServerSuggestionUndoInfo = {
      op: 'replace', new_word_ids: ['n1', 'n2'], removed_words: [W('o', 'wasnt', 1, 3)],
      segment_id: 'a', prev_word_id: null, removed_segment: null,
    };
    const ins: ServerSuggestionUndoInfo = {
      op: 'insert_after', new_word_ids: ['i1'], removed_words: [],
      segment_id: 'a', prev_word_id: 'x', removed_segment: null,
    };
    const doc = mk(
      [S('a', [W('x', 'x', 0, 1), W('n1', 'was', 1, 2, span), W('n2', 'not', 2, 3, span), W('i1', 'oh', 3, 4, span)])],
      { r: rep, i: ins },
    );
    const a = revertAiSpan(revertAiSpan(doc, 'r'), 'i');
    expect(a.segments[0]!.words.map((w) => w.text)).toEqual(['x', 'wasnt']);
    expect(a.segments[0]!.end_time).toBe(3);
  });
  it('reverts a delete by reinserting after prev word or at the start', () => {
    const after: ServerSuggestionUndoInfo = {
      op: 'delete', new_word_ids: [], removed_words: [W('d', 'uh', 1, 2)],
      segment_id: 'a', prev_word_id: 'x', removed_segment: null,
    };
    const start: ServerSuggestionUndoInfo = { ...after, prev_word_id: null };
    const doc = mk([S('a', [W('x', 'x', 0, 1), W('y', 'y', 2, 3)])], { after, start });
    expect(revertAiSpan(doc, 'after').segments[0]!.words.map((w) => w.text)).toEqual(['x', 'uh', 'y']);
    expect(revertAiSpan(doc, 'start').segments[0]!.words.map((w) => w.text)).toEqual(['uh', 'x', 'y']);
  });
  it('reverting a delete span twice is a no-op the second time (no duplicate word ids)', () => {
    const after: ServerSuggestionUndoInfo = {
      op: 'delete', new_word_ids: [], removed_words: [W('d', 'uh', 1, 2)],
      segment_id: 'a', prev_word_id: 'x', removed_segment: null,
    };
    const doc = mk([S('a', [W('x', 'x', 0, 1), W('y', 'y', 2, 3)])], { after });
    const once = revertAiSpan(doc, 'after');
    const twice = revertAiSpan(once, 'after');
    expect(twice).toBe(once);
    const ids = twice.segments[0]!.words.map((w) => w.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('reinserts a segment that a delete removed entirely, once', () => {
    const removed = S('gone', [W('g', 'ghost', 4, 5)]);
    const info: ServerSuggestionUndoInfo = {
      op: 'delete', new_word_ids: [], removed_words: [W('g', 'ghost', 4, 5)],
      segment_id: 'gone', prev_word_id: null, removed_segment: { segment: removed, index: 1 },
    };
    const doc = mk([S('a', [W('x', 'x', 0, 1)]), S('b', [W('y', 'y', 6, 7)])], { sp: info });
    const d = revertAiSpan(doc, 'sp');
    expect(d.segments.map((s) => s.id)).toEqual(['a', 'gone', 'b']);
    expect(d.segments[1]).not.toBe(removed);
    expect(revertAiSpan(d, 'sp')).toBe(d);
    const far = { ...info, removed_segment: { segment: removed, index: 99 } };
    expect(revertAiSpan(mk(doc.segments.slice(), { sp: far }), 'sp').segments[2]!.id).toBe('gone');
  });
  it('returns the doc unchanged when info is missing or malformed', () => {
    const doc = mk([S('a', [W('x', 'x', 0, 1)])], { s1: { x: 1 } });
    expect(revertAiSpan(doc, 'nope')).toBe(doc);
    expect(revertAiSpan(doc, 's1')).toBe(doc);
    const bare = mk([S('a', [W('x', 'x', 0, 1)])]);
    expect(revertAiSpan(bare, 'sp')).toBe(bare);
  });
  it('returns the doc unchanged when the span was edited since', () => {
    const rep: ServerSuggestionUndoInfo = {
      op: 'replace', new_word_ids: ['n1', 'n2'], removed_words: [W('o', 'q', 1, 3)],
      segment_id: 'a', prev_word_id: null, removed_segment: null,
    };
    const base = { ...rep };
    const missing = mk([S('a', [W('n1', 'a', 1, 2)])], { sp: base });
    expect(revertAiSpan(missing, 'sp')).toBe(missing);
    const split = mk([S('a', [W('n1', 'a', 1, 2), W('m', 'm', 2, 3), W('n2', 'b', 3, 4)])], { sp: base });
    expect(revertAiSpan(split, 'sp')).toBe(split);
    const noSeg = mk([S('zzz', [W('n1', 'a', 1, 2)])], { sp: base });
    expect(revertAiSpan(noSeg, 'sp')).toBe(noSeg);
    const del: ServerSuggestionUndoInfo = { ...rep, new_word_ids: [], prev_word_id: 'gone' };
    const noPrev = mk([S('a', [W('q', 'q', 1, 2)])], { sp: del });
    expect(revertAiSpan(noPrev, 'sp')).toBe(noPrev);
  });
});
