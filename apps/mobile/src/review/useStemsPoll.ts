import { getInstrumentalUrls } from '@nomad/api-gen';
import { stemsReady, type BackingVocalsAnalysis, type CorrectionData, type InstrumentalOption } from '@nomad/review-core';
import { useEffect, useState } from 'react';

export const STEMS_POLL_MS = 15_000;
export const STEMS_POLL_MAX_MS = 10 * 60_000;

export type StemsState = {
  options: InstrumentalOption[];
  audioComplete?: boolean;
  analysis?: BackingVocalsAnalysis | null;
  autoApproval?: CorrectionData['auto_approval'];
};

/**
 * The instrumental stems for the review. Starts from what the correction doc already had and, while
 * the stems are not both playable, re-asks gen every 15 s for up to 10 min. Errors just wait for the next tick.
 */
export function useStemsPoll(jobId: string, initial: StemsState): StemsState & { ready: boolean } {
  const [state, setState] = useState<StemsState>(initial);
  const ready = stemsReady(state.options, state.audioComplete);

  useEffect(() => {
    if (ready) return;
    let cancelled = false;
    const deadline = Date.now() + STEMS_POLL_MAX_MS;
    const id = setInterval(async () => {
      try {
        const r = await getInstrumentalUrls(jobId);
        if (cancelled) return;
        setState({ options: r.options, audioComplete: r.audioComplete, analysis: r.backingAnalysis, autoApproval: r.autoApproval });
      } catch {
        // transient: try again next tick
      }
      if (Date.now() >= deadline) clearInterval(id);
    }, STEMS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [jobId, ready]);

  return { ...state, ready };
}
