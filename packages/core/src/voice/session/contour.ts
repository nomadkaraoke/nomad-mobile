// A song's compact pitch contour (10 Hz) and the chest-only pitch summary built from it (Phase 3d batch 1, Part M).
// The contour replaces the raw frames (~30 a second) so a finished song's pitch fits in the stored session and the
// summary can be recomputed once the singer has labelled falsetto notes in the quiz.
import { percentile, type VoicedFrame } from '../frames';
import type { HeldNote } from '../heldNotes';
import type { LabelledNote } from './falsetto';
import type { PitchSummary } from './pitchSummary';

/** `midi[i]`: the median voiced pitch in [t0 + i·dt, t0 + (i+1)·dt), null when nothing was voiced there. */
export type PitchContour = { t0: number; dt: number; midi: (number | null)[] };

export const CONTOUR_DT = 0.1;
/** Labelled spans are widened by this much each side before their contour bins are dropped. */
const SPAN_PAD_S = 0.2;
const MIN_VOICED_S = 10;
const MIN_HELD = 2;
const EPS = 1e-6;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

const round2 = (x: number) => Math.round(x * 100) / 100;

export type ContourBuilder = { push(f: VoicedFrame): void; contour(): PitchContour };

/** Builds the contour frame by frame (frames in time order), keeping only the current bin's frames. */
export function createContourBuilder(dt = CONTOUR_DT): ContourBuilder {
  let t0: number | null = null;
  const done: (number | null)[] = [];
  let bin = 0;
  let current: number[] = [];
  return {
    push(f) {
      if (t0 === null) t0 = f.t;
      const i = Math.max(0, Math.floor((f.t - t0) / dt + EPS));
      if (i > bin) {
        done.push(current.length ? round2(median(current)) : null);
        while (done.length < i) done.push(null);
        bin = i;
        current = [];
      }
      current.push(f.midi);
    },
    contour() {
      if (t0 === null) return { t0: 0, dt, midi: [] };
      return { t0, dt, midi: [...done, ...(current.length ? [round2(median(current))] : [])] };
    },
  };
}

export function contourFrom(frames: VoicedFrame[], dt = CONTOUR_DT): PitchContour {
  const b = createContourBuilder(dt);
  for (const f of [...frames].sort((x, y) => x.t - y.t)) b.push(f);
  return b.contour();
}

const mid = (h: HeldNote) => (h.start + h.end) / 2;
const inSpan = (t: number, l: LabelledNote) => t >= l.tStart - SPAN_PAD_S && t <= l.tEnd + SPAN_PAD_S;

/**
 * The song's pitch summary without falsetto: contour bins inside a `falsetto` span (± 0.2 s) and the held notes it
 * labels are dropped; `unsure` notes stay in the percentiles and the count but not in the held bounds. Same
 * thresholds as `summarizeSongPitch` (≥ 10 s voiced, ≥ 2 held notes); null below them. With no labels this is the
 * whole song's summary (`pitch_all`).
 */
export function chestSummary(contour: PitchContour, held: HeldNote[], labels: LabelledNote[]): PitchSummary | null {
  const falsetto = labels.filter((l) => l.label === 'falsetto');
  const unsure = labels.filter((l) => l.label === 'unsure');
  const { t0, dt } = contour;
  const midis: number[] = [];
  contour.midi.forEach((m, i) => {
    if (m === null) return;
    const from = t0 + i * dt;
    const to = from + dt;
    if (falsetto.some((l) => from < l.tEnd + SPAN_PAD_S && to > l.tStart - SPAN_PAD_S)) return;
    midis.push(m);
  });
  const chestHeld = held.filter((h) => !falsetto.some((l) => inSpan(mid(h), l)));
  const bounded = chestHeld.filter((h) => !unsure.some((l) => inSpan(mid(h), l))).map((h) => h.note);
  const voicedS = midis.length * dt;
  if (voicedS < MIN_VOICED_S - EPS || chestHeld.length < MIN_HELD || bounded.length === 0) return null;
  return {
    voicedS,
    heldCount: chestHeld.length,
    heldLow: Math.min(...bounded),
    heldHigh: Math.max(...bounded),
    p10: percentile(midis, 0.1),
    p50: percentile(midis, 0.5),
    p90: percentile(midis, 0.9),
  };
}
