import fixture from './fixtures/correctionData.json';
import type { CorrectionData, LyricsSegment } from '../types';
import { docFingerprint, fromCorrectionData, replaceSegment, toSubmission } from '../doc';

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
    // Unknown stays unknown: toSubmission never invents is_duet.
    expect(toSubmission(doc)).not.toHaveProperty('is_duet');
  });

  it('toSubmission keeps the source is_duet unless one is given', () => {
    const doc = fromCorrectionData(data); // source is_duet: true
    expect(toSubmission({ ...doc, isDuet: false }).is_duet).toBe(true); // an untouched toggle is not sent
    expect(toSubmission(doc, false).is_duet).toBe(false);
    const { is_duet: _d, ...rest } = data;
    const plain = fromCorrectionData(rest as CorrectionData);
    expect(toSubmission(plain, true).is_duet).toBe(true); // a duet turned on still reaches gen
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

describe('docFingerprint', () => {
  const clone = (): CorrectionData => JSON.parse(JSON.stringify(fixture));

  it('is stable for equal docs and ignores keys outside the lyrics', () => {
    const a = clone();
    const b = { ...clone(), metadata: { ...clone().metadata, other: 1 }, foo: 'changed' } as CorrectionData;
    expect(docFingerprint(a)).toBe(docFingerprint(b));
    expect(docFingerprint(a)).toMatch(/^[0-9a-z]+-[0-9a-f]{16}$/);
  });

  it.each([
    ['word text', (d: CorrectionData) => { d.corrected_segments[0]!.words[0]!.text = 'other'; }],
    ['word start', (d: CorrectionData) => { d.corrected_segments[0]!.words[0]!.start_time = 99.5; }],
    ['word end', (d: CorrectionData) => { d.corrected_segments[0]!.words[0]!.end_time = null; }],
    ['word id', (d: CorrectionData) => { d.corrected_segments[0]!.words[0]!.id = 'zz'; }],
    ['segment id', (d: CorrectionData) => { d.corrected_segments[0]!.id = 'zz'; }],
    ['a removed line', (d: CorrectionData) => { d.corrected_segments.pop(); }],
    ['a word singer', (d: CorrectionData) => { d.corrected_segments[0]!.words[0]!.singer = 2; }],
  ])('changes when the %s changes', (_name, mutate) => {
    const d = clone();
    mutate(d);
    expect(docFingerprint(d)).not.toBe(docFingerprint(clone()));
  });

  it('does not confuse a word boundary with text', () => {
    const one = { corrected_segments: [{ id: 's', text: '', start_time: 0, end_time: 1, words: [{ id: 'a', text: 'b c', start_time: 0, end_time: 1 }] }] };
    const two = {
      corrected_segments: [
        { id: 's', text: '', start_time: 0, end_time: 1, words: [{ id: 'a', text: 'b', start_time: 0, end_time: 1 }, { id: 'c', text: '', start_time: 0, end_time: 1 }] },
      ],
    };
    expect(docFingerprint(one as never)).not.toBe(docFingerprint(two as never));
  });

  it('handles an empty doc', () => {
    expect(docFingerprint({ corrected_segments: [] })).toBe(docFingerprint({ corrected_segments: [] }));
  });
});
