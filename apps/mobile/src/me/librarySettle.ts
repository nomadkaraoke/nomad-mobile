import type { PendingLog, PendingSetlist } from '@nomad/core';
import { create } from 'zustand';

import { useLogStore } from '../tonight/log/logStore';
import { useOutbox } from '../tonight/log/outbox';
import { currentUserKey } from './account';
import { useLovedOverrides } from './lovedOverrides';
import { useMeOutbox } from './meOutbox';
import { foldLog, pendingLog, pendingSetlists } from './pending';
import { meQueryClient } from './queryClientRef';
import { hasSetlistsCache, type SentSetlist } from './setlistsCache';
import { syncedFeels, syncedRecords } from './useLogMirror';

type Sent<T> = T & { sentAt: number };

/**
 * Writes the server has accepted that the cached library may not show yet. A send removes its item from the outbox
 * at once, but the library only learns of it from a later fetch (which may be pending or fail), so the overlay keeps
 * applying the sent record until a fetch that STARTED after the send lands (`settle`), like `lovedOverrides`.
 */
type Store = {
  log: Record<string, Sent<PendingLog>>;
  setlists: Record<string, Sent<PendingSetlist>>;
  /**
   * Setlist writes sent while the account had no setlists cache (the first fetch pending or failed), for the setlists
   * screens: without them a sent list would vanish from the outbox overlay with nothing to fall back to. Once set, an
   * entry follows later sends of that list too, so an older write never shows over a newer one.
   */
  setlistsSent: Record<string, SentSetlist>;
  /** Drops everything sent before `before` (a library fetch started at `before` has landed). */
  settle(before: number): void;
  /** Drops the setlist writes sent before `before` (a setlists fetch started at `before` has landed). */
  settleSetlists(before: number): void;
  clear(): void;
};

export const useLibrarySettle = create<Store>((set, get) => ({
  log: {},
  setlists: {},
  setlistsSent: {},
  settle: (before) => {
    const keep = <T extends { sentAt: number }>(r: Record<string, T>) => Object.fromEntries(Object.entries(r).filter(([, v]) => v.sentAt > before));
    set({ log: keep(get().log), setlists: keep(get().setlists) });
  },
  settleSetlists: (before) =>
    set({ setlistsSent: Object.fromEntries(Object.entries(get().setlistsSent).filter(([, v]) => v.sentAt > before)) }),
  clear: () => set({ log: {}, setlists: {}, setlistsSent: {} }),
}));

useOutbox.addSentListener((item, _result, owner) => {
  if (currentUserKey() !== owner) return;
  const { log } = useLibrarySettle.getState();
  const old = log[item.id];
  const mirror = syncedRecords(owner, meQueryClient());
  const syncedRec = (id: string) => mirror.get(id);
  if (item.op === 'delete') {
    // A delete of a record the server had keeps taking its counts off the cached library until a later fetch sees it.
    const { [item.id]: _gone, ...rest } = log;
    const rec = old && !old.deleted ? (old.synced ? { ...old, deleted: true } : undefined) : pendingLog([item], useLogStore.getState().entries, undefined, syncedRec)[0];
    useLibrarySettle.setState({ log: rec?.deleted && rec.synced ? { ...rest, [item.id]: { ...rec, sentAt: Date.now() } } : rest });
    return;
  }
  const feel = (id: string) => old?.survey?.feel ?? syncedFeels(owner, meQueryClient()).get(id);
  const rec = pendingLog([{ ...item, rev: item.rev }], useLogStore.getState().entries, feel, syncedRec)[0];
  if (!rec) return;
  useLibrarySettle.setState({ log: { ...log, [item.id]: { ...foldLog(old && !old.deleted ? old : undefined, rec, item.patch), sentAt: Date.now() } } });
});

useMeOutbox.addSentListener((item, result, owner) => {
  if (currentUserKey() !== owner) return;
  if (item.op === 'love') {
    // Refresh the shared love override to the send time (unless a newer, different answer is already showing).
    const cur = useLovedOverrides.getState().byKey[item.song_key];
    if (!cur || cur.loved === item.loved) useLovedOverrides.getState().set(item, item.loved, cur?.hold);
    return;
  }
  const rec = pendingSetlists([item])[0];
  if (rec) useLibrarySettle.setState({ setlists: { ...useLibrarySettle.getState().setlists, [rec.id]: { ...rec, sentAt: Date.now() } } });
  // `onSetlistSent` (run first) applied it to the cache when there is one; with none, keep it here until a fetch lands.
  const { setlistsSent } = useLibrarySettle.getState();
  if (item.op !== 'dismiss' && (!hasSetlistsCache(owner) || item.id in setlistsSent)) {
    useLibrarySettle.setState({ setlistsSent: { ...setlistsSent, [item.id]: { item, result, sentAt: Date.now() } } });
  }
});

// A love the server refused for good (permanent error): take the optimistic heart back (unless a newer answer shows).
useMeOutbox.addDroppedListener((item, _error, owner) => {
  if (currentUserKey() !== owner || item.op !== 'love' || !item.loved) return;
  const cur = useLovedOverrides.getState().byKey[item.song_key];
  if (cur?.loved) useLovedOverrides.getState().unset(item.song_key);
});
