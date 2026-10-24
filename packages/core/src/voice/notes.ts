const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const SEMITONE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** MIDI as a float: A4 = 440 Hz = 69, C4 = 60. */
export function hzToMidi(hz: number): number {
  return 69 + 12 * Math.log2(hz / 440);
}

export function midiToHz(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

/** Rounded name with sharps, e.g. 46 -> "A#2". */
export function midiToName(m: number): string {
  const n = Math.round(m);
  return `${NAMES[((n % 12) + 12) % 12]!}${Math.floor(n / 12) - 1}`;
}

/** Parses "C#4", "E♭3", "Bb2"; null when it is not a note name. */
export function nameToMidi(name: string): number | null {
  const m = /^([A-Ga-g])([#♯b♭]?)(-?\d+)$/.exec(name.trim());
  if (!m) return null;
  const acc = m[2] === '#' || m[2] === '♯' ? 1 : m[2] === 'b' || m[2] === '♭' ? -1 : 0;
  return (Number(m[3]) + 1) * 12 + SEMITONE[m[1]!.toUpperCase()]! + acc;
}
