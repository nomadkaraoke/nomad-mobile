// Falsetto in a voice session (Phase 3d batch 1, Part M): which held notes might be falsetto (the live chip and the
// quiz catch-up) and the singer's labels as decide's `NoteLabelIn`.
import type { HeldNote } from '../heldNotes';

export type NoteLabel = 'falsetto' | 'full' | 'unsure';
export type UsesFalsetto = 'yes' | 'sometimes' | 'no' | 'unsure';
/** A held note high enough above the chest comfort top to ask about. Times in stream seconds, `midi` rounded. */
export type FalsettoCandidate = { tStart: number; tEnd: number; midi: number };
export type LabelledNote = FalsettoCandidate & { label: NoteLabel; source: 'live' | 'quiz' };

/** decide's `NoteLabelIn` (extra="forbid"). */
export type NoteLabelInBody = {
  t_start: number;
  t_end: number;
  midi: number;
  label: NoteLabel;
  source: 'live' | 'quiz';
};

/**
 * Semitones above the chest comfort top before a held note counts as a falsetto candidate: 3 when the singer says they
 * use falsetto, 5 when they say they don't, 4 otherwise (plan default 3).
 */
export function falsettoOffset(usesFalsetto: UsesFalsetto | null | undefined): number {
  if (usesFalsetto === 'yes') return 3;
  if (usesFalsetto === 'no') return 5;
  return 4;
}

export type FalsettoDetectorOptions = {
  /** The chest comfort top (MIDI); null = no reference yet, so nothing is a candidate. */
  chestTop: number | null;
  offset: number;
  /** Shortest hold that counts (s). */
  minHoldS?: number;
  /** Least time between two shown chips (s). */
  cooldownS?: number;
  /** How long a shown chip stays up (s): a higher candidate in that time replaces it instead of waiting. */
  showS?: number;
};

export type FalsettoDetector = {
  /**
   * Feeds one held note (each once, in time order). Returns the candidate to show now, or null: not a candidate, or
   * within the cooldown of the last shown one. A candidate higher than the chip still showing replaces it.
   */
  push(note: HeldNote): FalsettoCandidate | null;
  /** Every candidate so far, including the ones the cooldown kept off screen (the quiz catch-up asks about them). */
  all(): FalsettoCandidate[];
};

const EPS = 1e-6;

export function createFalsettoDetector({
  chestTop,
  offset,
  minHoldS = 0.6,
  cooldownS = 20,
  showS = 5,
}: FalsettoDetectorOptions): FalsettoDetector {
  const found: FalsettoCandidate[] = [];
  let shown: FalsettoCandidate | null = null;
  return {
    push(note) {
      if (chestTop === null) return null;
      if (note.end - note.start < minHoldS - EPS || note.note < chestTop + offset) return null;
      const c: FalsettoCandidate = { tStart: note.start, tEnd: note.end, midi: note.note };
      found.push(c);
      const since = shown ? c.tEnd - shown.tEnd : Infinity;
      if (since >= cooldownS - EPS || (shown && since <= showS + EPS && c.midi > shown.midi)) {
        shown = c;
        return c;
      }
      return null;
    },
    all: () => [...found],
  };
}

const MAX_LABELS = 40;
const round = (x: number, places: number) => Math.round(x * 10 ** places) / 10 ** places;

/**
 * The labels as decide's `note_labels`: one per note (a later answer for the same note wins), only what decide
 * accepts (0–3600 s, MIDI 24–96), in time order, at most 40.
 */
export function toNoteLabelsIn(labels: LabelledNote[]): NoteLabelInBody[] {
  const byNote = new Map<string, NoteLabelInBody>();
  for (const l of labels) {
    const body: NoteLabelInBody = {
      t_start: round(l.tStart, 3),
      t_end: round(Math.max(l.tEnd, l.tStart), 3),
      midi: round(l.midi, 2),
      label: l.label,
      source: l.source,
    };
    if (body.t_start < 0 || body.t_end > 3600 || body.midi < 24 || body.midi > 96) continue;
    const key = `${body.t_start}|${body.t_end}|${body.midi}`;
    byNote.delete(key);
    byNote.set(key, body);
  }
  return [...byNote.values()].sort((a, b) => a.t_start - b.t_start).slice(0, MAX_LABELS);
}

/** Whether `label` is about this candidate (the same note: the label was made from it). */
export const sameNote = (a: FalsettoCandidate, b: FalsettoCandidate): boolean =>
  Math.abs(a.tStart - b.tStart) < 1e-3 && Math.abs(a.tEnd - b.tEnd) < 1e-3 && a.midi === b.midi;
