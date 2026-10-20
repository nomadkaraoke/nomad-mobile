import { ApiError, getVocalsPeaks } from '@nomad/api-gen';
import { decodePeaks, downsamplePeaks } from '@nomad/review-core';
import { useEffect, useState } from 'react';

import { reportThrottled } from '../telemetry';
import { STEMS_POLL_MAX_MS } from '../useStemsPoll';

/** Bars in the player-bar scrubber (a phone is ~350 pt wide: ~1.5 pt per bar). */
export const PEAK_BARS = 240;

export type VocalsPeaks = {
  /** pending: the stems are still separating (or the first fetch is in flight). failed: no waveform. */
  status: 'pending' | 'ready' | 'failed';
  peaks: number[];
  /** Seconds the peaks cover (0 until ready). */
  duration: number;
};

/**
 * The vocal stem's peak envelope for the scrubber. Polls while gen answers 202 (stems separating),
 * honouring its Retry-After, for as long as the stems poll waits. A failure reports `waveform_failed`
 * and leaves an empty waveform: playback and seeking still work without it.
 */
export function useVocalsPeaks(jobId: string): VocalsPeaks {
  const [state, setState] = useState<VocalsPeaks>({ status: 'pending', peaks: [], duration: 0 });

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const deadline = Date.now() + STEMS_POLL_MAX_MS;

    const load = async (): Promise<void> => {
      try {
        const r = await getVocalsPeaks(jobId);
        if (cancelled) return;
        if (r.status === 'ready') {
          const raw = decodePeaks(r.peaks);
          setState({
            status: 'ready',
            peaks: downsamplePeaks(raw, Math.min(PEAK_BARS, raw.length)),
            duration: r.rate > 0 ? raw.length / r.rate : 0,
          });
          return;
        }
        const wait = r.retryAfter * 1000;
        if (Date.now() + wait > deadline) {
          reportThrottled('waveform_slow', { jobId });
          setState({ status: 'failed', peaks: [], duration: 0 });
          return;
        }
        timer = setTimeout(() => void load(), wait);
      } catch (e) {
        if (cancelled) return;
        reportThrottled('waveform_failed', { jobId, status: e instanceof ApiError ? e.status : 0 });
        setState({ status: 'failed', peaks: [], duration: 0 });
      }
    };
    void load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [jobId]);

  return state;
}
