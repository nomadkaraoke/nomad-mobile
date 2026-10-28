// "Analyse my music" (Phase 3d Part F): decide's personal pool (`GET /api/voice/personal-pool`) and the request
// (`POST`). Read again whenever Me comes back into focus and after a request; no timers and no push (Phase 6). Only
// asked when decide's voice flags say the session is open to this user.
import { getPersonalPool, personalPoolRefusal, requestPersonalPool, type PersonalPoolOut } from '@nomad/api-decide';
import { useQuery } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';

import { useAuth } from '../../auth/store';
import { useVoiceFlags } from '../debug/useVoiceDebug';

export const PERSONAL_POOL_KEY = ['voiceSession', 'personalPool'] as const;

/** What the last request said, shown under the card until the next one. */
export type PersonalPoolProblem =
  | { kind: 'cap'; nextAllowedAt: string | null }
  | { kind: 'paused' }
  | { kind: 'nothingToAdd' }
  | { kind: 'failed' };

/** The card's view of the pool: hidden, or which lines and actions to show. */
export type PersonalPoolView =
  | { kind: 'hidden' }
  | {
      kind: 'shown';
      cap: number;
      /** The newest batch is still being prepared: its song count. */
      preparing: number | null;
      /** Songs of the newest batch that are ready to sing (0 = none yet). */
      ready: number;
      /** The cap is used up until this time (ISO). */
      capUntil: string | null;
      /** No batch yet: the pitch line. */
      firstTime: boolean;
      /** The request button shows (no batch in progress, cap not used up). */
      canRequest: boolean;
    };

/** The card's lines from decide's pool (the newest batch, `batches[0]`, sets the state). */
export function personalPoolView(pool: PersonalPoolOut | undefined): PersonalPoolView {
  if (!pool?.eligible) return { kind: 'hidden' };
  const newest = pool.batches[0];
  const inProgress = !!newest && newest.status !== 'done';
  return {
    kind: 'shown',
    cap: pool.cap,
    preparing: inProgress ? newest.total : null,
    ready: newest?.ready ?? 0,
    capUntil: pool.next_allowed_at ?? null,
    firstTime: !newest,
    canRequest: !inProgress && !pool.next_allowed_at,
  };
}

/** A refusal from the last request, stamped with when it was shown (a newer read of the pool clears it). */
type Refusal = { problem: PersonalPoolProblem | null; hide: boolean; at: number; email: string | null };

export function usePersonalPool() {
  const email = useAuth((s) => (s.state.status === 'signedIn' ? s.state.session.email : null));
  // Closed to this user (decide's session flag, admins only until G1): don't ask, it would 403 on every Me focus.
  const open = useVoiceFlags().data?.session_enabled === true;
  const query = useQuery<PersonalPoolOut>({
    queryKey: [...PERSONAL_POOL_KEY, email],
    enabled: !!email && open,
    queryFn: getPersonalPool,
    retry: false,
  });
  const refetch = query.refetch;
  // Me stays mounted under the session modal: read the pool again on coming back.
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false; // the query's own mount fetch covers this one
        return;
      }
      if (email && open) void refetch();
    }, [email, open, refetch]),
  );

  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);

  const request = async () => {
    setBusy(true);
    setRefusal(null);
    let next: Omit<Refusal, 'at' | 'email'> | null = null;
    try {
      await requestPersonalPool();
    } catch (e) {
      const r = personalPoolRefusal(e);
      if (r?.reason === 'cap') next = { problem: { kind: 'cap', nextAllowedAt: r.nextAllowedAt }, hide: false };
      else if (r?.reason === 'budget_paused') next = { problem: { kind: 'paused' }, hide: false };
      else if (r?.reason === 'nothing_to_add') next = { problem: { kind: 'nothingToAdd' }, hide: false };
      // decide says the user can't use the pool after all (not eligible, or the session gate closed): hide the card.
      else if (r?.reason === 'not_eligible' || r?.reason === 'voice_session_disabled') next = { problem: null, hide: true };
      // concurrent_request: another request (another device, a double tap) is making the batch: the refetch shows it.
      else if (r?.reason !== 'concurrent_request') next = { problem: { kind: 'failed' }, hide: false };
    } finally {
      await refetch();
      // Stamped after this refetch, so only a later read of the pool (a focus, the next request) clears it.
      if (next) setRefusal({ ...next, at: Date.now(), email });
      setBusy(false);
    }
  };

  // Another account's refusal, or one older than the latest read of the pool, no longer applies.
  const current = refusal && refusal.email === email && query.dataUpdatedAt <= refusal.at ? refusal : null;
  let problem = current?.problem ?? null;
  // A cap that had already run out by the last read (or by the refusal) is no reason to wait.
  if (
    problem?.kind === 'cap' &&
    problem.nextAllowedAt &&
    Date.parse(problem.nextAllowedAt) <= Math.max(query.dataUpdatedAt, current?.at ?? 0)
  )
    problem = null;
  // The gate closed (or the user lost eligibility) on a later read: hide even over the last good data.
  const gateClosed = ['voice_session_disabled', 'not_eligible'].includes(personalPoolRefusal(query.error)?.reason ?? '');
  // Still loading, a failed first read, not eligible or closed: render nothing (no spinner, no layout jump). A later
  // failed read keeps the last pool.
  const hidden = !open || (query.isError && !query.data) || gateClosed || current?.hide;
  const view: PersonalPoolView = hidden ? { kind: 'hidden' } : personalPoolView(query.data);
  return { view, busy, problem, request };
}
