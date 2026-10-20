import type { CorrectionData, LyricsSegment, VocalGap, Word } from '../types';
import { fromCorrectionData, type ReviewDoc } from '../doc';

export const word = (id: string, s: number | null, e: number | null, extra: Partial<Word> = {}): Word => ({
  id, text: id, start_time: s, end_time: e, ...extra,
});
export const line = (id: string, words: Word[], extra: Partial<LyricsSegment> = {}): LyricsSegment => {
  const timed = words.filter((w) => w.start_time !== null && w.end_time !== null);
  return {
    id, text: words.map((w) => w.text).join(' '), words,
    start_time: timed.length ? (timed[0]!.start_time as number) : null,
    end_time: timed.length ? (timed[timed.length - 1]!.end_time as number) : null,
    ...extra,
  };
};
export const docWith = (segments: LyricsSegment[], extra: Partial<CorrectionData> = {}): ReviewDoc =>
  fromCorrectionData({ corrected_segments: segments, reference_lyrics: {}, ...extra } as unknown as CorrectionData);
export const gapOf = (extra: Partial<VocalGap> = {}): VocalGap => ({
  start: 30, end: 36, duration: 6, active_fraction: 0.8, longest_run_s: 5, suspect: true, evidenced: true, ...extra,
});
