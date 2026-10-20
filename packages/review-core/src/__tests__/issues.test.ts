import fixture from './fixtures/correctionData.json';
import type { CorrectionData } from '../types';
import { fromCorrectionData } from '../doc';
import { collectIssues } from '../issues';
import { docWith, gapOf, line, word } from './helpers';

describe('collectIssues', () => {
  it('sorts the corrections fixture in song order', () => {
    const issues = collectIssues(fromCorrectionData(fixture as unknown as CorrectionData));
    expect(issues.map((i) => [i.kind, i.segment, i.word, i.time])).toEqual([
      ['ai_corrected', 0, 3, 14.4],
      ['untimed', 1, 0, 15.9], // fully untimed line: previous line's last timed end
      ['untimed', 2, 1, 20],
    ]);
  });

  it('untimed time is the nearest timed neighbour within the line', () => {
    const [i] = collectIssues(docWith([line('a', [word('x', 4, 5), word('y', null, null)])]));
    expect(i).toEqual({ kind: 'untimed', segment: 0, word: 1, time: 4 });
  });

  it('fully untimed line: previous line end, else next line start, else 0', () => {
    const un = line('u', [word('u', null, null)], { start_time: 99, end_time: 100 });
    const t = (segs: ReturnType<typeof line>[]) => collectIssues(docWith(segs)).find((i) => i.kind === 'untimed')!.time;
    expect(t([line('a', [word('a', 1, 2)]), un, line('b', [word('b', 8, 9)])])).toBe(2);
    expect(t([un, line('b', [word('b', 8, 9)])])).toBe(8);
    expect(t([un])).toBe(0);
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

  it('flags long words and long gaps inside a line (> 2 s), not between lines', () => {
    const d = docWith([
      line('a', [word('a', 1, 4)]),
      line('b', [word('b', 10, 10.5), word('c', 13, 13.5)]),
    ]);
    expect(collectIssues(d).map((i) => [i.kind, i.segment, i.word, i.time])).toEqual([
      ['long_word', 0, 0, 1],
      ['long_gap', 1, 1, 10.5],
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
      [line('a', [word('x', 5, 5.04, { ai_corrected: true })])],
      { vocal_gaps: { gaps: [gapOf({ start: 5, end: 12 })] } },
    );
    expect(collectIssues(d).map((i) => i.kind)).toEqual(['vocal_gap', 'ai_corrected']);
    const same = collectIssues(docWith([line('a', [word('x', null, null, { ai_corrected: true })], { start_time: 3, end_time: 4 })]));
    expect(same.map((i) => i.kind)).toEqual(['untimed', 'ai_corrected']);
  });
});
