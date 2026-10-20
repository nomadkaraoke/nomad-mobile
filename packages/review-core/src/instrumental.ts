import type { BackingVocalsAnalysis, CorrectionData, InstrumentalOption } from './types';

export type InstrumentalChoice = 'clean' | 'with_backing';

const asStem = (v: unknown): InstrumentalChoice | undefined => (v === 'clean' || v === 'with_backing' ? v : undefined);
/** Neither a stem nor an explicit "no recommendation" (null / absent / review_needed). */
const isGarbage = (v: unknown): boolean => v != null && v !== 'review_needed' && !asStem(v);

/**
 * Which instrumental to preselect (gen LyricsAnalyzer): the server's resolved selection, else the
 * backing-vocals analysis recommendation, else with_backing when the backing stem has audible
 * content, else clean. `confident` is the server's backing verdict, trusted only when the choice
 * came from a valid server value. Any unknown value anywhere gives `{clean, confident: false}`.
 */
export function recommendInstrumental(
  data: Pick<CorrectionData, 'auto_approval' | 'backing_vocals_analysis'>,
): { choice: InstrumentalChoice; confident: boolean } {
  const backing = data.auto_approval?.backing;
  const analysis: Partial<BackingVocalsAnalysis> | null | undefined = data.backing_vocals_analysis;
  const resolved = asStem(backing?.resolved_selection);
  const recommended = asStem(analysis?.recommended_selection);
  const picked = resolved ?? recommended;
  if (picked) return { choice: picked, confident: backing?.confident === true };
  if (isGarbage(backing?.resolved_selection) || isGarbage(analysis?.recommended_selection)) {
    return { choice: 'clean', confident: false };
  }
  return { choice: analysis?.has_audible_content === true ? 'with_backing' : 'clean', confident: false };
}

/**
 * True once both stems can be played. `audioComplete` (the server's flag) wins when present;
 * when absent, both stems having a URL means ready.
 */
export function stemsReady(options: readonly InstrumentalOption[] | null | undefined, audioComplete?: boolean): boolean {
  const has = (id: InstrumentalChoice): boolean => !!options?.some((o) => o.id === id && !!o.audio_url);
  const both = has('clean') && has('with_backing');
  return audioComplete === undefined ? both : audioComplete && both;
}
