import { getCorrectionData, startReview } from '@nomad/api-gen';
import type { CorrectionData } from '@nomad/review-core';
import { useCallback, useEffect, useRef, useState } from 'react';

import { classifyLoadError, retryDelayMs, type LoadError } from './retry';
import { reportThrottled } from './telemetry';

export type ReviewLoad =
  | { status: 'loading'; retry(): void }
  | { status: 'ready'; data: CorrectionData; retry(): void }
  | { status: 'error'; error: LoadError; retry(): void };

/**
 * Opens the review (startReview, idempotent on gen) and loads the correction doc. Transient failures
 * retry on the 5/15/30/60 s schedule (Retry-After wins when present); after that, or on a final error,
 * the status is 'error' and `retry()` starts a fresh attempt.
 */
export function useReviewLoader(jobId: string): ReviewLoad {
  const [state, setState] = useState<
    { status: 'loading' } | { status: 'ready'; data: CorrectionData } | { status: 'error'; error: LoadError }
  >({ status: 'loading' });
  const run = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const launch = useCallback(() => {
    const id = (run.current += 1);
    if (timer.current) clearTimeout(timer.current);
    const attempt = async (n: number): Promise<void> => {
      try {
        await startReview(jobId);
        const data = await getCorrectionData(jobId);
        if (run.current === id) setState({ status: 'ready', data });
      } catch (e) {
        if (run.current !== id) return;
        const { error, transient, status } = classifyLoadError(e);
        reportThrottled('lyrics_load_failed', { jobId, status, attempt: n });
        const delay = transient ? retryDelayMs(e, n) : null;
        if (delay === null) {
          setState({ status: 'error', error });
          return;
        }
        timer.current = setTimeout(() => void attempt(n + 1), delay);
      }
    };
    void attempt(0);
  }, [jobId]);

  useEffect(() => {
    launch(); // the initial state is already 'loading'; callers key the screen by job
    return () => {
      run.current += 1;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [launch]);

  const retry = useCallback(() => {
    setState({ status: 'loading' });
    launch();
  }, [launch]);

  return { ...state, retry };
}
