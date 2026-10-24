import { classifyVoice } from '../voiceType';
import { summarizeRange } from '../range';
import { framesFor } from '../testSignals';

const held = (notes: number[]) => notes.map((n, i) => ({ start: i, end: i + 0.6, midi: n, note: n }));

describe('summarizeRange', () => {
  it('baritone: held A2..E4, free sing E3..C4', () => {
    const r = summarizeRange(held([45, 47, 62, 64]), framesFor([{ midi: 52, dur: 2 }, { midi: 57, dur: 2 }, { midi: 60, dur: 2 }]))!;
    expect(r).toMatchObject({ low: 45, high: 64, comfortLow: 52, comfortHigh: 60, heldCount: 4 });
    expect(r.freeVoicedS).toBeCloseTo(6, 6);
    expect(classifyVoice(r)).toMatchObject({ type: 'baritone', between: null });
  });
  it('range is order-independent (high step sung lower than low step)', () => {
    expect(summarizeRange(held([64, 45, 62]), [])).toMatchObject({ low: 45, high: 64 });
  });
  it('null with one held note or a span under 3', () => {
    expect(summarizeRange(held([50]), [])).toBeNull();
    expect(summarizeRange(held([50, 52]), [])).toBeNull();
  });
  it('no free sing → comfort from quartiles', () => {
    expect(summarizeRange(held([45, 61]), [])).toMatchObject({ comfortLow: 49, comfortHigh: 57, freeVoicedS: 0 });
  });
  it('under 3 s of free singing falls back to quartiles', () => {
    expect(summarizeRange(held([45, 61]), framesFor([{ midi: 55, dur: 2 }]))).toMatchObject({ comfortLow: 49, comfortHigh: 57 });
  });
  it('comfort from free singing is clamped into the held range', () => {
    const r = summarizeRange(held([50, 60]), framesFor([{ midi: 40, dur: 2 }, { midi: 70, dur: 2 }]))!;
    expect(r).toMatchObject({ comfortLow: 50, comfortHigh: 60 });
  });
});
