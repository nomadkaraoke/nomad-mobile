import fixture from './fixtures/correctionData.json';
import type { CorrectionData, LyricsSegment } from '../types';
import { fromCorrectionData, replaceSegment, toSubmission } from '../doc';

const data = fixture as unknown as CorrectionData;

describe('doc model', () => {
  it('round-trips the fixture including unknown keys', () => {
    const out = toSubmission(fromCorrectionData(data));
    expect(out).toEqual(fixture);
    expect(out.replay).toEqual(fixture.replay);
    expect(out.foo).toEqual(fixture.foo);
    expect(out.metadata.auto_approval).toEqual(fixture.metadata.auto_approval);
    expect(out.metadata.future_meta_key).toEqual(fixture.metadata.future_meta_key);
  });

  it('derives isDuet and defaults it to false', () => {
    expect(fromCorrectionData(data).isDuet).toBe(true);
    const { is_duet: _d, ...rest } = data;
    const doc = fromCorrectionData(rest as CorrectionData);
    expect(doc.isDuet).toBe(false);
    expect(toSubmission(doc).is_duet).toBe(false);
  });

  it('does not mutate the source', () => {
    const copy = JSON.parse(JSON.stringify(data));
    const doc = fromCorrectionData(data);
    replaceSegment(doc, 0, { ...doc.segments[0]!, text: 'x' });
    expect(data).toEqual(copy);
  });

  it('replaceSegment swaps one segment and keeps other identities', () => {
    const doc = fromCorrectionData(data);
    const seg: LyricsSegment = { ...doc.segments[1]!, text: 'changed' };
    const next = replaceSegment(doc, 1, seg);
    expect(next.segments[1]).toBe(seg);
    for (const i of [0, 2, 3]) expect(next.segments[i]).toBe(doc.segments[i]);
    expect(next.source).toBe(doc.source);
    expect(doc.segments[1]!.text).not.toBe('changed');
    expect(toSubmission(next).corrected_segments[1]!.text).toBe('changed');
  });

  it('replaceSegment ignores an out-of-range index', () => {
    const doc = fromCorrectionData(data);
    expect(replaceSegment(doc, 99, doc.segments[0]!)).toBe(doc);
    expect(replaceSegment(doc, -1, doc.segments[0]!)).toBe(doc);
  });
});
