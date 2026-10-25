import type { VoicedFrame } from './frames';
import { HELD_NOTE_DEFAULTS, scanHeldNotes, type HeldNote, type HeldNoteOptions } from './heldNotes';

/**
 * Seconds of frames the tracker keeps before it compacts. Compaction never changes the result (see below), so this
 * only trades memory for how often it runs; a single unbroken run longer than this is split (the one approximation).
 */
export const TRACKER_MAX_PENDING_S = 30;

export type HeldNoteTracker = {
  /** Adds one voiced frame. Frames must arrive in time order (the mic framer's are). */
  push(f: VoicedFrame): void;
  /** Held notes over every frame pushed so far: the same as findHeldNotes(allFrames), with bounded work. */
  notes(): HeldNote[];
  /** Frames still kept (for tests and debugging). */
  readonly pendingFrames: number;
  reset(): void;
};

/**
 * Incremental `findHeldNotes` for a live mic, with work and memory bounded however long the singer goes on.
 *
 * - A voiced gap > maxGapS closes a segment, and findHeldNotes handles segments independently: the closed segment's
 *   notes are final, so they are computed once and its frames dropped.
 * - One gap-free segment can still grow (a long slide). Once the kept frames span more than `maxPendingS`, everything
 *   before the segment's open run (the last run, the only one new frames can extend) is final: those notes are kept
 *   and frames older than the open run's start minus the rolling-median window are dropped. The kept window frames
 *   still feed the rolling median but start no run (`scanHeldNotes`' `runsFrom`), so later results are identical.
 * - The only approximation: if the open run itself spans more than `maxPendingS` (one note held within ±tolCents for
 *   over 30 s), it is closed as a note there and a fresh run starts at the next frame. A >30 s hold reported as two
 *   notes of the same pitch changes nothing the range or the voice test uses.
 */
export function createHeldNoteTracker(
  opts: HeldNoteOptions = {},
  { maxPendingS = TRACKER_MAX_PENDING_S }: { maxPendingS?: number } = {},
): HeldNoteTracker {
  const { maxGapS, medianWindowS } = { ...HELD_NOTE_DEFAULTS, ...opts };
  const eps = 1e-9;
  let finalised: HeldNote[] = [];
  let pending: VoicedFrame[] = [];
  let runsFrom = -Infinity;

  /** Keeps frames from (t - window) on, with runs starting at t. */
  const dropBefore = (t: number) => {
    // A little extra margin: frames outside every later window are skipped by scanHeldNotes' own window loop.
    const keepFrom = t - medianWindowS - 1e-6;
    pending = pending.filter((f) => f.t >= keepFrom);
    runsFrom = t;
  };

  return {
    push(f) {
      const last = pending[pending.length - 1];
      if (last && f.t - last.t > maxGapS + eps) {
        finalised.push(...scanHeldNotes(pending, opts, runsFrom).notes);
        pending = [];
        runsFrom = -Infinity;
      }
      pending.push(f);
    },
    notes() {
      const { notes, openRunStart } = scanHeldNotes(pending, opts, runsFrom);
      const first = pending[0];
      const last = pending[pending.length - 1];
      if (!first || !last || openRunStart === null || last.t - first.t <= maxPendingS) return [...finalised, ...notes];
      if (last.t - openRunStart <= maxPendingS) {
        // Exact: everything before the open run is final.
        finalised.push(...notes.filter((n) => n.start < openRunStart));
        dropBefore(openRunStart);
      } else {
        // The open run is longer than maxPendingS: close it here (the documented approximation).
        finalised.push(...notes);
        const next = last.t + 1e-6;
        dropBefore(next);
        // Nothing at or after `next` yet: keep only the window frames for the next run's rolling median.
      }
      return [...finalised, ...scanHeldNotes(pending, opts, runsFrom).notes];
    },
    get pendingFrames() {
      return pending.length;
    },
    reset() {
      finalised = [];
      pending = [];
      runsFrom = -Infinity;
    },
  };
}
