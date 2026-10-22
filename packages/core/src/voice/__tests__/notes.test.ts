import { hzToMidi, midiToHz, midiToName, nameToMidi } from '../notes';

describe('notes', () => {
  it('A4 is 69 and C4 is 60', () => {
    expect(hzToMidi(440)).toBeCloseTo(69);
    expect(hzToMidi(261.626)).toBeCloseTo(60, 3);
    expect(midiToHz(69)).toBeCloseTo(440);
  });
  it('names round-trip', () => {
    expect(midiToName(45)).toBe('A2');
    expect(midiToName(46)).toBe('A#2');
    expect(nameToMidi('C#4')).toBe(61);
    expect(nameToMidi('E♭3')).toBe(51);
    expect(nameToMidi('Bb2')).toBe(46);
    expect(nameToMidi('F♯4')).toBe(66);
    expect(nameToMidi('H9')).toBeNull();
  });
});
