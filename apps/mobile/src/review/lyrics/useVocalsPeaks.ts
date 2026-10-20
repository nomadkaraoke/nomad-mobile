import { ApiError, getVocalsPeaks } from '@nomad/api-gen';
import { decodePeaks, downsamplePeaks, normalizePeaks } from '@nomad/review-core';
import { useEffect, useRef, useState } from 'react';

import { reportThrottled } from '../telemetry';

/** Bars in the player-bar scrubber (a phone is ~350 pt wide: ~1.5 pt per bar). */
export const PEAK_BARS = 240;
/** Once the stems poll says the stems exist, gen may still answer 202 for a moment: retry this many times. */
export const PEAKS_READY_RETRIES = 3;

export type VocalsPeaks = {
  /** pending: the stems are still separating (or the fetch is in flight). failed: no waveform. */
  status: 'pending' | 'ready' | 'failed';
  peaks: number[];
  /** Seconds the peaks cover (0 until ready). */
  duration: number;
};

/**
 * The vocal stem's peak envelope for the scrubber. One attempt on open; if gen answers 202 (stems
 * still separating) it waits for the stems poll (`stemsReady`) instead of polling on its own, then
 * fetches again (retrying a few times on Retry-After). A failure reports `waveform_failed` and leaves an
 * empty waveform: playback and seeking still work without it.
 */
export function useVocalsPeaks(jobId: string, stemsReady: boolean): VocalsPeaks {
  const [state, setState] = useState<VocalsPeaks>({ status: 'pending', peaks: [], duration: 0 });
  // Ready or failed: nothing more to fetch.
  const settledRef = useRef(false);

  useEffect(() => {
    if (settledRef.current) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let tries = 0;

    const load = async (): Promise<void> => {
      try {
        const r = await getVocalsPeaks(jobId);
        if (cancelled) return;
        if (r.status === 'ready') {
          settledRef.current = true;
          const raw = decodePeaks(r.peaks);
          setState({
            status: 'ready',
            // gen's peaks are absolute (a quiet stem would draw flat): scale them for display.
            peaks: normalizePeaks(downsamplePeaks(raw, Math.min(PEAK_BARS, raw.length))),
            duration: r.rate > 0 ? raw.length / r.rate : 0,
          });
          return;
        }
        if (!stemsReady) return; // the stems poll re-runs this effect when they land
        tries += 1;
        if (tries < PEAKS_READY_RETRIES) {
          timer = setTimeout(() => void load(), r.retryAfter * 1000);
          return;
        }
        settledRef.current = true;
        reportThrottled('waveform_slow', { jobId });
        setState({ status: 'failed', peaks: [], duration: 0 });
      } catch (e) {
        if (cancelled) return;
        settledRef.current = true;
        reportThrottled('waveform_failed', { jobId, status: e instanceof ApiError ? e.status : 0 });
        setState({ status: 'failed', peaks: [], duration: 0 });
      }
    };
    void load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [jobId, stemsReady]);

  return state;
}
