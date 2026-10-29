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

/** A setlist write the server accepted, kept by `librarySettle` until a setlists fetch that started after it lands. */
export type SentSetlist = { item: MeOutboxItem; result: unknown; sentAt: number };

/** `base` with the settling sent writes applied, oldest first (each write carries the whole list, so later wins). */
export function withSentSetlists(base: Setlist[], sent: Record<string, SentSetlist>): Setlist[] {
  const writes = Object.values(sent);
  if (writes.length === 0) return base;
  return writes.sort((a, b) => a.sentAt - b.sentAt).reduce((acc, w) => applySent(acc, w.item, w.result), base);
}

/** Whether this account has any setlists cache (query or MMKV) to apply a sent write to. */
export function hasSetlistsCache(userKey: string): boolean {
  return (meQueryClient()?.getQueryData<SetlistsCache>(setlistsKeyFor(userKey)) ?? readCache(setlistsStorageKey(userKey), isSetlistsCache)) != null;
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
  // Nothing cached yet: never seed a cache holding only this list (it would hide the others); `librarySettle` keeps
  // the write in its settling overlay until a fetch that started after the send lands.
  if (!prev) return;
  const next: SetlistsCache = { setlists: applySent(prev.setlists, item, result), savedAt: Date.now() };
  writeCacheFor(userKey, setlistsStorageKey(userKey), next);
  if (inQuery) client?.setQueryData(queryKey, next);
}
