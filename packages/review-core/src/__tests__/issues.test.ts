import fixture from './fixtures/correctionData.json';
import type { CorrectionData } from '../types';
import { fromCorrectionData } from '../doc';
import { collectIssues } from '../issues';
import { docWith, gapOf, line, word } from './helpers';

describe('collectIssues', () => {
  it('sorts the corrections fixture by time: untimed (time 0) before the later AI span', () => {
    const issues = collectIssues(fromCorrectionData(fixture as unknown as CorrectionData));
    expect(issues.map((i) => [i.kind, i.segment, i.word])).toEqual([
      ['untimed', 1, 0],
      ['ai_corrected', 0, 3],
      ['long_gap', 2, 0], // 15.9 -> 20.0 across the untimed line
      ['untimed', 2, 1],
    ]);
    const times = issues.map((i) => i.time);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it('untimed time is the nearest timed neighbour within the line', () => {
    const [i] = collectIssues(docWith([line('a', [word('x', 4, 5), word('y', null, null)])]));
    expect(i).toEqual({ kind: 'untimed', segment: 0, word: 1, time: 4 });
  });

  it('untimed uses the line start when no word is timed, else 0', () => {
    const [i] = collectIssues(docWith([line('a', [word('x', null, null)], { start_time: 7, end_time: 9 })]));
    expect(i!.time).toBe(7);
  });

  it('one untimed issue per run', () => {
    const d = docWith([line('a', [word('a', 1, 2), word('b', null, null), word('c', null, null), word('d', 3, 4), word('e', null, null)])]);
    expect(collectIssues(d).filter((i) => i.kind === 'untimed').map((i) => i.word)).toEqual([1, 4]);
  });

  it('one AI issue per span, not per word', () => {
    const ai = { ai_corrected: true, correction_span_id: 'sp1' };
    const d = docWith([
      line('a', [
        word('a', 1, 2, ai), word('b', 2, 3, ai), word('c', 3, 4, { ai_corrected: true, correction_span_id: 'sp2' }),
        word('d', 4, 5), word('e', 5, 6, { ai_corrected: true }), word('f', 6, 7, { ai_corrected: true }),
      ]),
    ]);
    expect(collectIssues(d).filter((i) => i.kind === 'ai_corrected').map((i) => i.word)).toEqual([0, 2, 4]);
  });

  it('flags estimated runs (not inside AI spans)', () => {
    const d = docWith([line('a', [
      word('a', 1, 2, { timing_estimated: true }), word('b', 2, 3, { timing_estimated: true }),
      word('c', 3, 4), word('d', 4, 5, { timing_estimated: true, ai_corrected: true }),
    ])]);
    const est = collectIssues(d).filter((i) => i.kind === 'estimated');
    expect(est).toEqual([{ kind: 'estimated', segment: 0, word: 0, time: 1 }]);
  });

  it('flags long words and long gaps (> 2 s) across lines', () => {
    const d = docWith([
      line('a', [word('a', 1, 4)]),
      line('b', [word('b', 6.5, 7), word('c', 7.0, 9.0)]),
    ]);
    expect(collectIssues(d).map((i) => [i.kind, i.segment, i.word, i.time])).toEqual([
      ['long_word', 0, 0, 1],
      ['long_gap', 1, 0, 4],
    ]);
  });

  it('exactly 2 s is not long', () => {
    expect(collectIssues(docWith([line('a', [word('a', 0, 2), word('b', 4, 6)])]))).toEqual([]);
  });

  it('includes open vocal gaps and drops them once words land inside', () => {
    const segs = [line('a', [word('a', 10, 11)]), line('b', [word('b', 40, 41)])];
    const open = collectIssues(docWith(segs, { vocal_gaps: { gaps: [gapOf()] } }));
    expect(open).toContainEqual({ kind: 'vocal_gap', segment: 1, time: 30 });
    const filled = collectIssues(docWith([...segs, line('c', [word('c', 31, 33)])], { vocal_gaps: { gaps: [gapOf()] } }));
    expect(filled.some((i) => i.kind === 'vocal_gap')).toBe(false);
  });

  it('a vocal gap after every line points at the last line', () => {
    const d = docWith([line('a', [word('a', 1, 2)])], { vocal_gaps: { gaps: [gapOf()] } });
    expect(collectIssues(d).find((i) => i.kind === 'vocal_gap')!.segment).toBe(0);
    expect(collectIssues(docWith([], { vocal_gaps: { gaps: [gapOf()] } }))[0]!.segment).toBe(0);
  });

  it('ties break by kind priority', () => {
    const d = docWith(
      [line('a', [word('x', 5, 5.5, { ai_corrected: true, timing_estimated: false }), word('y', null, null)], { start_time: 5, end_time: 5.5 })],
      { vocal_gaps: { gaps: [gapOf({ start: 5, end: 12 })] } },
    );
    const kinds = collectIssues(d).map((i) => i.kind);
    expect(kinds.indexOf('ai_corrected')).toBeLessThan(kinds.indexOf('untimed') + 10);
    const same = collectIssues(docWith([line('a', [word('x', null, null, { ai_corrected: true })], { start_time: 3, end_time: 4 })]));
    expect(same.map((i) => i.kind)).toEqual(['untimed', 'ai_corrected']);
  });
});
