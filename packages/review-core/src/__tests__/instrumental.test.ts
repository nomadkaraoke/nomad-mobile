import { recommendInstrumental, stemsReady } from '../instrumental';
import type { BackingVocalsAnalysis, InstrumentalOption } from '../types';

const analysis = (rec: string, audible = false): BackingVocalsAnalysis => ({
  has_audible_content: audible, total_duration_seconds: 200, audible_segments: [], recommended_selection: rec,
  total_audible_duration_seconds: 0, audible_percentage: 0, silence_threshold_db: -40,
});
const ap = (o: object) => ({ auto_approval: { backing: o } });

describe('recommendInstrumental', () => {
  it('resolved_selection wins, confident follows the verdict', () => {
    expect(recommendInstrumental({ ...ap({ resolved_selection: 'with_backing', confident: true }), backing_vocals_analysis: analysis('clean') }))
      .toEqual({ choice: 'with_backing', confident: true });
    expect(recommendInstrumental(ap({ resolved_selection: 'clean', confident: false }))).toEqual({ choice: 'clean', confident: false });
    expect(recommendInstrumental(ap({ resolved_selection: 'clean' }))).toEqual({ choice: 'clean', confident: false });
  });
  it('falls through to the analysis recommendation', () => {
    expect(recommendInstrumental({ backing_vocals_analysis: analysis('with_backing') })).toEqual({ choice: 'with_backing', confident: false });
    expect(recommendInstrumental({ ...ap({ resolved_selection: null, confident: true }), backing_vocals_analysis: analysis('clean') }))
      .toEqual({ choice: 'clean', confident: true });
  });
  it('review_needed preselects by audible content, no badge', () => {
    expect(recommendInstrumental({ backing_vocals_analysis: analysis('review_needed', true) })).toEqual({ choice: 'with_backing', confident: false });
    expect(recommendInstrumental({ backing_vocals_analysis: analysis('review_needed', false) })).toEqual({ choice: 'clean', confident: false });
  });
  it('no analysis: clean, not confident', () => {
    expect(recommendInstrumental({})).toEqual({ choice: 'clean', confident: false });
    expect(recommendInstrumental({ backing_vocals_analysis: null })).toEqual({ choice: 'clean', confident: false });
  });
  it('garbage values give clean, not confident', () => {
    expect(recommendInstrumental({ ...ap({ resolved_selection: 'bogus', confident: true }), backing_vocals_analysis: analysis('nonsense', true) }))
      .toEqual({ choice: 'clean', confident: false });
    expect(recommendInstrumental({ backing_vocals_analysis: analysis('what', true) })).toEqual({ choice: 'clean', confident: false });
    expect(recommendInstrumental(ap({ resolved_selection: 42 as never }))).toEqual({ choice: 'clean', confident: false });
  });
});

describe('stemsReady', () => {
  const both: InstrumentalOption[] = [
    { id: 'clean', label: 'c', audio_url: '/a' }, { id: 'with_backing', label: 'b', audio_url: '/b' },
  ];
  it('undefined flag: both stems present means ready', () => {
    expect(stemsReady(both)).toBe(true);
    expect(stemsReady([both[0]!])).toBe(false);
    expect(stemsReady([{ ...both[0]!, audio_url: null }, both[1]!])).toBe(false);
    expect(stemsReady([])).toBe(false);
    expect(stemsReady(undefined)).toBe(false);
  });
  it('explicit flag wins', () => {
    expect(stemsReady(both, false)).toBe(false);
    expect(stemsReady(both, true)).toBe(true);
    expect(stemsReady([], true)).toBe(false);
  });
});
