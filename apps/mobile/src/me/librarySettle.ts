import type { PendingLog, PendingSetlist } from '@nomad/core';
import { create } from 'zustand';

import { useLogStore } from '../tonight/log/logStore';
import { useOutbox } from '../tonight/log/outbox';
import { currentUserKey } from './account';
import { useLovedOverrides } from './lovedOverrides';
import { useMeOutbox } from './meOutbox';
import { foldLog, pendingLog, pendingSetlists } from './pending';
import { meQueryClient } from './queryClientRef';
import { syncedFeels } from './useLogMirror';

type Sent<T> = T & { sentAt: number };

/**
 * Writes the server has accepted that the cached library may not show yet. A send removes its item from the outbox
 * at once, but the library only learns of it from a later fetch (which may be pending or fail), so the overlay keeps
 * applying the sent record until a fetch that STARTED after the send lands (`settle`), like `lovedOverrides`.
 */
type Store = {
  log: Record<string, Sent<PendingLog>>;
  setlists: Record<string, Sent<PendingSetlist>>;
  /** Drops everything sent before `before` (a library fetch started at `before` has landed). */
  settle(before: number): void;
  clear(): void;
};

export const useLibrarySettle = create<Store>((set, get) => ({
  log: {},
  setlists: {},
  settle: (before) => {
    const keep = <T extends { sentAt: number }>(r: Record<string, T>) => Object.fromEntries(Object.entries(r).filter(([, v]) => v.sentAt > before));
    set({ log: keep(get().log), setlists: keep(get().setlists) });
  },
  clear: () => set({ log: {}, setlists: {} }),
}));

useOutbox.addSentListener((item, _result, owner) => {
  if (currentUserKey() !== owner) return;
  const { log } = useLibrarySettle.getState();
  if (item.op === 'delete') {
    const { [item.id]: _gone, ...rest } = log;
    useLibrarySettle.setState({ log: rest });
    return;
  }
  const old = log[item.id];
  const feel = (id: string) => old?.survey?.feel ?? syncedFeels(owner, meQueryClient()).get(id);
  const rec = pendingLog([{ ...item, rev: item.rev }], useLogStore.getState().entries, feel)[0];
  if (!rec) return;
  useLibrarySettle.setState({ log: { ...log, [item.id]: { ...foldLog(old, rec, item.patch), sentAt: Date.now() } } });
});

useMeOutbox.addSentListener((item, _result, owner) => {
  if (currentUserKey() !== owner) return;
  if (item.op === 'love') {
    // Refresh the shared love override to the send time (unless a newer, different answer is already showing).
    const cur = useLovedOverrides.getState().byKey[item.song_key];
    if (!cur || cur.loved === item.loved) useLovedOverrides.getState().set(item, item.loved, cur?.hold);
    return;
  }
  const rec = pendingSetlists([item])[0];
  if (rec) useLibrarySettle.setState({ setlists: { ...useLibrarySettle.getState().setlists, [rec.id]: { ...rec, sentAt: Date.now() } } });
});
