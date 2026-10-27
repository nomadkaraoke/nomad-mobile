// "Analyse my music" (Phase 3d Part F): decide's personal pool (`GET /api/voice/personal-pool`) and the request
// (`POST`). Read again whenever Me comes back into focus and after a request; no timers and no push (Phase 6).
import { getPersonalPool, personalPoolRefusal, requestPersonalPool, type PersonalPoolOut } from '@nomad/api-decide';
import { useQuery } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';

import { useAuth } from '../../auth/store';

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

export function usePersonalPool() {
  const email = useAuth((s) => (s.state.status === 'signedIn' ? s.state.session.email : null));
  const query = useQuery<PersonalPoolOut>({
    queryKey: [...PERSONAL_POOL_KEY, email],
    enabled: !!email,
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
      if (email) void refetch();
    }, [email, refetch]),
  );

  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<PersonalPoolProblem | null>(null);
  /** decide said the user can't use the pool after all (not eligible, or the session gate closed): hide the card. */
  const [refused, setRefused] = useState(false);

  const request = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await requestPersonalPool();
    } catch (e) {
      const r = personalPoolRefusal(e);
      if (r?.reason === 'cap') setProblem({ kind: 'cap', nextAllowedAt: r.nextAllowedAt });
      else if (r?.reason === 'budget_paused') setProblem({ kind: 'paused' });
      else if (r?.reason === 'nothing_to_add') setProblem({ kind: 'nothingToAdd' });
      else if (r?.reason === 'not_eligible' || r?.reason === 'voice_session_disabled') setRefused(true);
      // concurrent_request: another request (another device, a double tap) is making the batch: the refetch shows it.
      else if (r?.reason !== 'concurrent_request') setProblem({ kind: 'failed' });
    } finally {
      await refetch();
      setBusy(false);
    }
  };

  // A failed read, still loading, or not eligible: render nothing (no spinner, no layout jump).
  const view: PersonalPoolView = query.isError || refused ? { kind: 'hidden' } : personalPoolView(query.data);
  return { view, busy, problem, request };
}
