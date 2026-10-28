import { findHeldNotes, type HeldNote } from '../../heldNotes';
import { framesFor } from '../../testSignals';
import { createFalsettoDetector, falsettoOffset, sameNote, toNoteLabelsIn, type LabelledNote } from '../index';

const held = (start: number, end: number, note: number): HeldNote => ({ start, end, midi: note, note });

describe('falsettoOffset', () => {
  it('3 for yes, 4 for sometimes / unsure / unknown, 5 for no', () => {
    expect(falsettoOffset('yes')).toBe(3);
    expect(falsettoOffset('sometimes')).toBe(4);
    expect(falsettoOffset('no')).toBe(5);
    expect(falsettoOffset('unsure')).toBe(4);
    expect(falsettoOffset(null)).toBe(4);
    expect(falsettoOffset(undefined)).toBe(4);
  });
});

describe('createFalsettoDetector', () => {
  it('candidate when held ≥ chestTop + offset for ≥ 0.6 s', () => {
    const d = createFalsettoDetector({ chestTop: 59, offset: 4 });
    expect(d.push(held(1, 2.5, 62))).toBeNull(); // 3 above: chest
    expect(d.push(held(3, 3.5, 66))).toBeNull(); // 0.5 s: too short
    expect(d.push(held(4, 4.6, 63))).toEqual({ tStart: 4, tEnd: 4.6, midi: 63 });
    expect(d.all()).toEqual([{ tStart: 4, tEnd: 4.6, midi: 63 }]);
  });

  it('cooldown 20 s between shown chips but all() keeps both', () => {
    const d = createFalsettoDetector({ chestTop: 59, offset: 4 });
    expect(d.push(held(10, 11, 66))).not.toBeNull();
    // 12 s later, not higher: suppressed (no chip), still a candidate for the quiz.
    expect(d.push(held(22, 23, 66))).toBeNull();
    // ≥ 20 s after the shown chip: a new chip.
    expect(d.push(held(31.5, 32.5, 66))).toEqual({ tStart: 31.5, tEnd: 32.5, midi: 66 });
    expect(d.all().map((c) => c.tStart)).toEqual([10, 22, 31.5]);
  });

  it('a higher note while the chip still shows (≤ 5 s) replaces it', () => {
    const d = createFalsettoDetector({ chestTop: 59, offset: 4 });
    expect(d.push(held(10, 11.5, 64))).not.toBeNull();
    expect(d.push(held(12, 13.5, 69))).toEqual({ tStart: 12, tEnd: 13.5, midi: 69 });
    // Same or lower within the window: no replacement.
    expect(d.push(held(14, 15.5, 69))).toBeNull();
    expect(d.push(held(15.6, 16.4, 64))).toBeNull();
    expect(d.all()).toHaveLength(4);
  });

  it('no chestTop → no candidates', () => {
    const d = createFalsettoDetector({ chestTop: null, offset: 3 });
    expect(d.push(held(1, 3, 80))).toBeNull();
    expect(d.all()).toEqual([]);
  });

  it("Andrew's Fake Plastic Trees pattern (E4 then A4 leaps, chest top B3): the shown chip ends on A4", () => {
    // Chest line around G3–B3, then a leap to E4 and on to A4 (~1.5 s each), repeated twice 40 s apart.
    const phrase = [
      { midi: 55, dur: 2 },
      { midi: 57, dur: 2 },
      { midi: 59, dur: 2 },
      { midi: 64, dur: 1.5 },
      { midi: 69, dur: 1.5 },
      { midi: 57, dur: 2 },
    ];
    const rest = { midi: 52, dur: 29 };
    const frames = framesFor([...phrase, rest, ...phrase], 0.01);
    const d = createFalsettoDetector({ chestTop: 59, offset: falsettoOffset(null) });
    const shown: number[] = [];
    for (const n of findHeldNotes(frames)) {
      const c = d.push(n);
      if (c) shown.push(c.midi);
    }
    expect(shown).toEqual([64, 69, 64, 69]);
    // Chest notes (≤ 59) never qualify; E4 and A4 both do.
    expect(d.all().every((c) => c.midi >= 63)).toBe(true);
    expect(d.all().filter((c) => c.midi === 69)).toHaveLength(2);
  });
});

describe('toNoteLabelsIn', () => {
  const l = (tStart: number, midi: number, label: LabelledNote['label'] = 'falsetto'): LabelledNote => ({
    tStart,
    tEnd: tStart + 1,
    midi,
    label,
    source: 'live',
  });

  it("decide's NoteLabelIn, time order, rounded", () => {
    expect(toNoteLabelsIn([l(20.12345, 69.4), l(3, 66, 'unsure')])).toEqual([
      { t_start: 3, t_end: 4, midi: 66, label: 'unsure', source: 'live' },
      { t_start: 20.123, t_end: 21.123, midi: 69.4, label: 'falsetto', source: 'live' },
    ]);
  });

  it('caps at 40 and drops labels decide would refuse', () => {
    const many = Array.from({ length: 45 }, (_, i) => l(i * 2, 70));
    expect(toNoteLabelsIn(many)).toHaveLength(40);
    expect(toNoteLabelsIn([l(-1, 70), l(5, 20), l(5, 100), l(3601, 70)])).toEqual([]);
  });

  it('one label per note: a later answer for the same note wins', () => {
    const out = toNoteLabelsIn([l(5, 70, 'falsetto'), { ...l(5, 70, 'full'), source: 'quiz' }]);
    expect(out).toEqual([{ t_start: 5, t_end: 6, midi: 70, label: 'full', source: 'quiz' }]);
  });
});

describe('sameNote', () => {
  it('matches a label to the candidate it was made from', () => {
    const c = { tStart: 4, tEnd: 4.6, midi: 69 };
    expect(sameNote(c, { ...c })).toBe(true);
    expect(sameNote(c, { ...c, midi: 68 })).toBe(false);
    expect(sameNote(c, { ...c, tStart: 4.1 })).toBe(false);
  });
});
