import { ApiError, completeReview, getCorrectionData, saveCorrections } from '@nomad/api-gen';
import { toSubmission, type InstrumentalChoice } from '@nomad/review-core';
import { useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useCallback, useContext, useEffect, useRef, useState } from 'react';

import { clearDraft } from '../drafts';
import { ReviewStoreContext } from '../store';

/** What `instrumental_selection` gen gets: a stem, `auto` (gen resolves its confident verdict) or `custom` (BYO). */
export type SubmitSelection = InstrumentalChoice | 'auto' | 'custom';
export type SubmitState = 'idle' | 'saving' | 'done' | 'error';
/** Why a submit failed, for the copy: no connection vs gen refused or broke. */
export type SubmitError = 'network' | 'server';

/** How long the success state shows before the review leaves for the job page. */
export const SUCCESS_HOLD_MS = 1200;

/**
 * "Make my video" (spec §4.5): the web's three calls, in order —
 *   1. POST corrections (gen sanitizes the timing here),
 *   2. a fresh GET correction-data (it already holds gen's sanitized segments),
 *   3. POST complete with that doc, the instrumental selection and `is_duet ?? false`.
 * Re-entry is ignored while a submit is in flight (double taps). A failure keeps the draft and can be
 * retried; every call is idempotent on gen, so a retry after a drop between calls resumes safely.
 * On success: haptic, clear the draft, refresh the job lists, show success, then replace the review
 * with the job page (a replace, so Finish's "back goes to Lyrics" guard lets it leave).
 */
export function useSubmitReview(
  jobId: string,
  selection: SubmitSelection,
): { submit(): Promise<void>; state: SubmitState; error?: SubmitError } {
  const store = useContext(ReviewStoreContext);
  if (!store) throw new Error('useSubmitReview must be used inside a ReviewStoreContext.Provider');
  const queryClient = useQueryClient();
  const [state, setState] = useState<SubmitState>('idle');
  const [error, setError] = useState<SubmitError | undefined>(undefined);
  const busy = useRef(false);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (leaveTimer.current) clearTimeout(leaveTimer.current);
    },
    [],
  );

  const submit = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setState('saving');
    setError(undefined);
    // The draft is the safety net if any call fails or the app dies mid-submit.
    store.getState().flushDraft();
    const { doc, isDuetTouched } = store.getState();
    // Ruling M: is_duet goes with the corrections only when known (loaded true, or toggled).
    const isDuetArg = doc.source.is_duet === true || isDuetTouched ? doc.isDuet : undefined;
    try {
      await saveCorrections(jobId, toSubmission(doc), isDuetArg);
      const fresh = await getCorrectionData(jobId);
      await completeReview(jobId, fresh, selection, doc.isDuet);
    } catch (e) {
      busy.current = false;
      setError(e instanceof ApiError && e.status > 0 ? 'server' : 'network');
      setState('error');
      return;
    }
    clearDraft(jobId);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    void queryClient.invalidateQueries({ queryKey: ['jobs'] });
    void queryClient.invalidateQueries({ queryKey: ['job', jobId] });
    setState('done');
    // `busy` stays set: the review is finished, nothing may submit again.
    leaveTimer.current = setTimeout(() => router.replace({ pathname: '/job/[id]', params: { id: jobId } }), SUCCESS_HOLD_MS);
  }, [store, jobId, selection, queryClient]);

  return { submit, state, error };
}
