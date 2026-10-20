import { getPreviewStatus, isApiError, previewVideoPath, requestPreview } from '@nomad/api-gen';
import { mediaUrl, toSubmission } from '@nomad/review-core';
import { useCallback, useContext, useEffect, useRef, useState } from 'react';

import { useAuth } from '../../auth/store';
import { GEN_API_URL } from '../../config';
import { duetToSend, ReviewStoreContext } from '../store';

export const PREVIEW_POLL_MS = 3000;
export const PREVIEW_POLL_MAX_MS = 5 * 60_000;
/** After this long generating, the copy explains a cold video server. */
export const PREVIEW_SLOW_MS = 30_000;

export type PreviewState = 'idle' | 'generating' | 'slow' | 'ready' | 'error' | 'untimed';

/**
 * The optional preview video (spec §4.5). `start()` sends the current edits; `success` (a cache hit or
 * a synchronous render) is ready at once, `generating` polls the status every 3 s for up to 5 min
 * (the copy turns "slow" after 30 s). A 422 means some lyrics have no timing: `untimed`.
 * A failed status poll is retried on the next tick; only `error` or the deadline give up.
 * The URL is built when ready (tokens never persist) and is gen's redirect to the signed mp4.
 */
export function usePreview(jobId: string): { start(): void; state: PreviewState; uri?: string } {
  const store = useContext(ReviewStoreContext);
  if (!store) throw new Error('usePreview must be used inside a ReviewStoreContext.Provider');
  const [state, setState] = useState<PreviewState>('idle');
  const [uri, setUri] = useState<string | undefined>(undefined);
  // Bumped by every start and by unmount: older runs stop polling and never set state.
  const runRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stop = useCallback(() => {
    runRef.current += 1;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);
  useEffect(() => stop, [stop]);

  const start = useCallback(() => {
    stop();
    const run = runRef.current;
    const live = () => run === runRef.current;
    const ready = (hash: string) => {
      setUri(mediaUrl(GEN_API_URL, jobId, previewVideoPath(jobId, hash), useAuth.getState().getToken()));
      setState('ready');
    };
    setUri(undefined);
    setState('generating');
    const { doc } = store.getState();
    const isDuetArg = duetToSend(store.getState());
    const startedAt = Date.now();

    const poll = (hash: string) => {
      timerRef.current = setTimeout(async () => {
        let status: 'ready' | 'generating' | 'error' | null = null;
        try {
          status = await getPreviewStatus(jobId, hash);
        } catch {
          // transient: ask again next tick
        }
        if (!live()) return;
        if (status === 'ready') return ready(hash);
        if (status === 'error') return setState('error');
        const elapsed = Date.now() - startedAt;
        if (elapsed >= PREVIEW_POLL_MAX_MS) return setState('error');
        if (elapsed >= PREVIEW_SLOW_MS) setState('slow');
        poll(hash);
      }, PREVIEW_POLL_MS);
    };

    void requestPreview(jobId, toSubmission(doc, isDuetArg), isDuetArg)
      .then((r) => {
        if (!live()) return;
        if (r.status === 'success') ready(r.previewHash);
        else poll(r.previewHash);
      })
      .catch((e: unknown) => {
        if (live()) setState(isApiError(e, 422) ? 'untimed' : 'error');
      });
  }, [jobId, store, stop]);

  return { start, state, uri };
}
