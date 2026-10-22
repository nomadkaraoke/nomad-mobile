import type { VoicedFrame } from './frames';

/** Synthetic voiced frames for tests: consecutive notes, optional vibrato (cents peak, Hz). */
export function framesFor(
  notes: { midi: number; dur: number; vibratoCents?: number; vibratoHz?: number }[],
  hop = 0.01,
): VoicedFrame[] {
  const out: VoicedFrame[] = [];
  let t = 0;
  for (const n of notes) {
    const count = Math.round(n.dur / hop);
    for (let i = 0; i < count; i++) {
      const vib = n.vibratoCents ? (n.vibratoCents / 100) * Math.sin(2 * Math.PI * (n.vibratoHz ?? 5.5) * t) : 0;
      out.push({ t, midi: n.midi + vib });
      t += hop;
    }
  }
  return out;
}

/** A linear glide between two pitches at semisPerSec. */
export function slide(fromMidi: number, toMidi: number, semisPerSec: number, hop = 0.01): VoicedFrame[] {
  const count = Math.round(Math.abs(toMidi - fromMidi) / semisPerSec / hop);
  const dir = Math.sign(toMidi - fromMidi);
  return Array.from({ length: count }, (_, i) => ({ t: i * hop, midi: fromMidi + dir * semisPerSec * i * hop }));
}
