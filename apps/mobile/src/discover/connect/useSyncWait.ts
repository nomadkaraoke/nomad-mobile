import { getSyncStatus, triggerSync } from '@nomad/api-decide';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useInvalidateAfterImport } from './queries';

/** Poll decide's sync status every 2 s for up to 2 min (spec §5.5). Mutable so tests can shrink the wait. */
export const syncPollConfig = { intervalMs: 2000, timeoutMs: 120_000 };

/** idle → syncing → done (with what the service added), slow (still going after the wait) or failed. */
export type SyncPhase = 'idle' | 'syncing' | 'done' | 'slow' | 'failed';
export type SyncCounts = { artists: number; songs: number };

type Outcome = { phase: 'done'; counts: SyncCounts | null } | { phase: 'failed' } | null;

/**
 * After connecting a polled service (ListenBrainz, Last.fm): start a sync and wait for that job (POST /sync hands
 * back the live job's id, a running or resumed one included). decide keeps a finished
 * job in `GET /api/services/sync/status` for a minute, so a 2 s poll always sees it. `stalled` (a dead heartbeat)
 * resumes on decide's side, so it is just "still going". Whatever happens the summary, picks and profile refresh.
 */
export function useSyncWait(service: 'listenbrainz' | 'lastfm') {
  const invalidate = useInvalidateAfterImport();
  const [phase, setPhase] = useState<SyncPhase>('idle');
  const [counts, setCounts] = useState<SyncCounts | null>(null);
  const alive = useRef(true);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => {
    alive.current = true;
    const pending = timers.current;
    return () => {
      alive.current = false;
      pending.forEach(clearTimeout);
      pending.clear();
    };
  }, []);

  /** Resolves after `ms`; on unmount the timer is cleared and the wait just stops. */
  const sleep = useCallback(
    (ms: number) =>
      new Promise<void>((resolve) => {
        const id = setTimeout(() => {
          timers.current.delete(id);
          resolve();
        }, ms);
        timers.current.add(id);
      }),
    [],
  );

  const poll = useCallback(async (jobId: string): Promise<Outcome> => {
    const job = (await getSyncStatus()).active_job;
    // No job any more: it finished and aged out of the status (only if the phone slept through the poll).
    if (!job) return { phase: 'done', counts: null };
    if (job.job_id !== jobId) return null; // another job is newest (not ours): keep waiting for ours
    if (job.status === 'failed') return { phase: 'failed' };
    if (job.status !== 'completed') return null; // pending, in_progress, stalled
    const item = job.results?.find((r) => r.service_type === service);
    if (item?.error) return { phase: 'failed' };
    return { phase: 'done', counts: item ? { artists: item.artists_stored ?? 0, songs: item.tracks_matched } : null };
  }, [service]);

  const start = useCallback(async () => {
    setPhase('syncing');
    setCounts(null);
    let outcome: Outcome = null;
    try {
      const { job_id: jobId } = await triggerSync();
      const deadline = Date.now() + syncPollConfig.timeoutMs;
      while (alive.current && !outcome && Date.now() < deadline) {
        try {
          // A hung request can't hold the wait past its deadline.
          let timer: ReturnType<typeof setTimeout> | undefined;
          const timedOut = new Promise<null>((resolve) => {
            timer = setTimeout(() => resolve(null), Math.max(0, deadline - Date.now()));
          });
          try {
            outcome = await Promise.race([poll(jobId), timedOut]);
          } finally {
            clearTimeout(timer);
          }
        } catch {
          // a blip while polling: keep trying until the wait is over
        }
        if (!outcome) await sleep(syncPollConfig.intervalMs);
      }
    } catch {
      outcome = { phase: 'failed' }; // connected, but the sync didn't start (decide's schedule picks it up later)
    }
    invalidate();
    if (!alive.current) return;
    if (!outcome) setPhase('slow');
    else {
      setPhase(outcome.phase);
      if (outcome.phase === 'done') setCounts(outcome.counts);
    }
  }, [invalidate, poll, sleep]);

  return { phase, counts, start };
}
