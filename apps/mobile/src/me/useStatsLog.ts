import type { PendingLog } from '@nomad/core';
import { useMemo } from 'react';

import { useLogStore } from '../tonight/log/logStore';
import { useOutbox } from '../tonight/log/outbox';
import { libraryLog } from './pending';
import { toPendingLog, useLogMirror } from './useLogMirror';

/**
 * The records StatsCard counts: the log mirror with Tonight's still-queued writes applied, one record per id (a queued
 * put folds into its mirror record, a queued delete removes it), so "This year" moves as soon as a song is logged.
 */
export function useStatsLog(): PendingLog[] {
  const { entries } = useLogMirror();
  const items = useOutbox((s) => s.items);
  const local = useLogStore((s) => s.entries);
  return useMemo(() => {
    const mirror = Object.fromEntries(toPendingLog(entries).map((r) => [r.id, r]));
    return libraryLog(mirror, items, local).filter((r) => !r.deleted);
  }, [entries, items, local]);
}
