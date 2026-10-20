import { ApiError, completeReview, getCorrectionData, getJob, saveCorrections } from '@nomad/api-gen';
import { jobPhase, jobStep } from '@nomad/core';
import { toSubmission, type InstrumentalChoice } from '@nomad/review-core';
import { useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useCallback, useContext, useEffect, useRef, useState } from 'react';

import { duetToSend, ReviewStoreContext } from '../store';

/** What `instrumental_selection` gen gets: a stem, `auto` (gen resolves its confident verdict) or `custom` (BYO). */
export type SubmitSelection = InstrumentalChoice | 'auto' | 'custom';
export type SubmitState = 'idle' | 'saving' | 'done' | 'error';
/** Why a submit failed, for the copy: no connection vs gen refused or broke. */
export type SubmitError = 'network' | 'server';
export type Submitter = { submit(): Promise<void>; state: SubmitState; error?: SubmitError };

/** How long the success state shows before the review leaves for the Make tab. */
export const SUCCESS_HOLD_MS = 1200;
/** Where the singer lands after submitting: the Make tab, whose job card shows the render's progress. */
export const AFTER_SUBMIT_HREF = '/make';

/** A fetch that never reached gen (ApiError 0 from the client, or fetch's TypeError) — not a bad response. */
const isNetworkError = (e: unknown): boolean =>
  e instanceof TypeError || (e instanceof ApiError && e.status === 0 && e.detail !== 'invalid_response');

/**
 * A failure that may hide a submit gen already took: the call-3 response was lost (network, a bad body),
 * or a retry hits gen's 400/409 because the job has left review. Gen then has the job past review.
 */
const mayHaveLanded = (e: unknown): boolean =>
  e instanceof TypeError || (e instanceof ApiError && (e.status === 0 || e.status === 400 || e.status === 409));

/** True when gen shows the job past review (rendering, done, …): the submit went through. */
export async function jobLeftReview(jobId: string): Promise<boolean> {
  try {
    const { status } = await getJob(jobId);
    return jobPhase(status) === 'done' || (jobPhase(status) === 'working' && jobStep(status).step >= 4);
  } catch {
    return false;
  }
}

/**
 * "Make my video" (spec §4.5): the web's three calls, in order —
 *   1. POST corrections (gen sanitizes the timing here),
 *   2. a fresh GET correction-data (it already holds gen's sanitized segments),
 *   3. POST complete with that doc, the instrumental selection and `is_duet ?? false`.
 * Lives in the review body (not the Finish step) so switching steps can't drop or repeat a submit.
 * Re-entry is ignored while a submit is in flight or after it succeeded. A failure keeps the draft and
 * can be retried (gen's calls are idempotent while the job is in review); a failure that may hide a
 * landed submit asks gen for the job first and counts it as success when the job has moved on.
 * On success: the store is finished (draft gone, edits frozen), haptic, the job lists refresh, success
 * shows, then the review leaves for the Make tab — unless the screen was closed meanwhile.
 */
export function useSubmitReview(jobId: string, selection: SubmitSelection): Submitter {
  const store = useContext(ReviewStoreContext);
  if (!store) throw new Error('useSubmitReview must be used inside a ReviewStoreContext.Provider');
  const queryClient = useQueryClient();
  const [state, setState] = useState<SubmitState>('idle');
  const [error, setError] = useState<SubmitError | undefined>(undefined);
  const busy = useRef(false);
  const mounted = useRef(true);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (leaveTimer.current) clearTimeout(leaveTimer.current);
    };
  }, []);

  const submit = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setState('saving');
    setError(undefined);
    // The draft is the safety net if any call fails or the app dies mid-submit.
    store.getState().flushDraft();
    const { doc } = store.getState();
    // Ruling M: is_duet goes with the corrections only when known (loaded true, or toggled).
    const isDuetArg = duetToSend(store.getState());
    try {
      await saveCorrections(jobId, toSubmission(doc, isDuetArg), isDuetArg);
      const fresh = await getCorrectionData(jobId);
      await completeReview(jobId, fresh, selection, doc.isDuet);
    } catch (e) {
      if (!(mayHaveLanded(e) && (await jobLeftReview(jobId)))) {
        busy.current = false;
        if (mounted.current) {
          setError(isNetworkError(e) ? 'network' : 'server');
          setState('error');
        }
        return;
      }
    }
    // `busy` stays set: the review is finished, nothing may submit again.
    store.getState().finish();
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    void queryClient.invalidateQueries({ queryKey: ['jobs'] });
    void queryClient.invalidateQueries({ queryKey: ['job', jobId] });
    if (!mounted.current) return; // the singer already left the review: don't navigate under them
    setState('done');
    leaveTimer.current = setTimeout(() => {
      if (mounted.current) router.dismissTo(AFTER_SUBMIT_HREF);
    }, SUCCESS_HOLD_MS);
  }, [store, jobId, selection, queryClient]);

  return { submit, state, error };
}
