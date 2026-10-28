import type { Setlist } from '@nomad/api-decide';

import { currentUserKey, setlistsStorageKey, writeCacheFor } from './account';
import { isObj, readCache } from './cache';
import type { MeOutboxItem } from './meOutbox';
import { overlaySetlists } from './pending';
import { meQueryClient } from './queryClientRef';

export type SetlistsCache = { setlists: Setlist[]; savedAt: number };
export const isSetlistsCache = (v: unknown): v is SetlistsCache =>
  isObj(v) && Array.isArray(v.setlists) && typeof v.savedAt === 'number';
export const setlistsKeyFor = (userKey: string | null) => ['decide', userKey, 'setlists'] as const;

const isSetlist = (v: unknown, id: string): v is Setlist => isObj(v) && v.id === id && typeof v.name === 'string';

/** `base` with one sent write applied: the server's answer when it is a setlist, else the write itself. */
export function applySent(base: Setlist[], item: MeOutboxItem, result: unknown): Setlist[] {
  if (item.op === 'love' || item.op === 'dismiss') return base;
  if (item.op === 'delete') return base.filter((s) => s.id !== item.id);
  const local = overlaySetlists(base, [item]).find((s) => s.id === item.id)!;
  const next: Setlist = isSetlist(result, item.id) ? { ...local, ...result, items: result.items ?? local.items } : local;
  const i = base.findIndex((s) => s.id === item.id);
  return i >= 0 ? base.map((s, n) => (n === i ? next : s)) : [...base, next];
}

/**
 * A setlist write the server accepted goes into the setlists query cache and the MMKV cache before it leaves the
 * outbox, so the overlay never falls back to the pre-write list while the refetch is pending or fails.
 */
export function onSetlistSent(item: MeOutboxItem, result: unknown, userKey: string): void {
  if (item.op === 'love' || item.op === 'dismiss' || currentUserKey() !== userKey) return;
  const client = meQueryClient();
  const queryKey = setlistsKeyFor(userKey);
  const inQuery = client?.getQueryData<SetlistsCache>(queryKey);
  const prev = inQuery ?? readCache(setlistsStorageKey(userKey), isSetlistsCache);
  // Nothing cached yet: leave it to the first fetch (a cache holding only this list would hide the others).
  if (!prev) return;
  const next: SetlistsCache = { setlists: applySent(prev.setlists, item, result), savedAt: Date.now() };
  writeCacheFor(userKey, setlistsStorageKey(userKey), next);
  if (inQuery) client?.setQueryData(queryKey, next);
}
