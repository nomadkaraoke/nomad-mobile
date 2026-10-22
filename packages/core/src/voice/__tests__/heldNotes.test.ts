import { findHeldNotes } from '../heldNotes';
import { framesFor, slide } from '../testSignals';

describe('findHeldNotes', () => {
  it('a 0.6 s held A2 is one held note', () => {
    expect(findHeldNotes(framesFor([{ midi: 45, dur: 0.6 }]))).toEqual([expect.objectContaining({ note: 45 })]);
  });
  it('0.4 s is too short', () => {
    expect(findHeldNotes(framesFor([{ midi: 45, dur: 0.4 }]))).toEqual([]);
  });
  it('vibrato ±40 cents at 5.5 Hz still counts', () => {
    expect(findHeldNotes(framesFor([{ midi: 57, dur: 1, vibratoCents: 40, vibratoHz: 5.5 }]))).toHaveLength(1);
  });
  it('a slide at 4 semitones/s holds nothing', () => {
    expect(findHeldNotes(slide(45, 57, 4))).toEqual([]);
  });
  it('a 3-frame octave spike neither splits nor extends a held note', () => {
    const f = framesFor([{ midi: 50, dur: 1 }]);
    for (const i of [40, 41, 42]) f[i] = { t: f[i]!.t, midi: 62 };
    const notes = findHeldNotes(f);
    expect(notes.map((n) => n.note)).toEqual([50]);
    expect(notes[0]!.start).toBeCloseTo(0);
    expect(notes[0]!.end).toBeCloseTo(0.99);
  });
  it('a 150 ms gap splits notes', () => {
    const a = framesFor([{ midi: 50, dur: 0.6 }]);
    const b = framesFor([{ midi: 50, dur: 0.6 }]).map((f) => ({ ...f, t: f.t + 0.6 + 0.14 }));
    const notes = findHeldNotes([...a, ...b]);
    expect(notes.map((n) => n.note)).toEqual([50, 50]);
  });
  it('a 100 ms gap does not split', () => {
    const a = framesFor([{ midi: 50, dur: 0.3 }]);
    const b = framesFor([{ midi: 50, dur: 0.3 }]).map((f) => ({ ...f, t: f.t + 0.3 + 0.09 }));
    expect(findHeldNotes([...a, ...b])).toHaveLength(1);
  });
  it('a step to a new pitch yields two notes', () => {
    expect(findHeldNotes(framesFor([{ midi: 50, dur: 0.8 }, { midi: 55, dur: 0.8 }])).map((n) => n.note)).toEqual([50, 55]);
  });
});
