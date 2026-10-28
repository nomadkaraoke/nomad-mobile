import { ApiError, listSetlists, type Setlist, type SetlistItemIn } from '@nomad/api-decide';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef } from 'react';

import { newUuid } from '../tonight/nightStore';
import { setlistsStorageKey, useUserKey, writeCacheFor } from './account';
import { readCache } from './cache';
import { useLibrarySettle } from './librarySettle';
import { useInvalidateOnSynced } from './useLibrary';
import { useMeOutbox } from './meOutbox';
import { overlaySetlists } from './pending';
import { useBindMeQueryClient } from './queryClientRef';
import { isSetlistsCache as isCache, setlistsKeyFor, withSentSetlists, type SetlistsCache } from './setlistsCache';

export { setlistsKeyFor };

/** At most this many songs in a setlist. */
export const MAX_SETLIST_ITEMS = 500;
type SongRef = { artist: string; title: string; song_key?: string | null };
const sameSong = (a: SetlistItemIn, b: SongRef) =>
  a.song_key && b.song_key ? a.song_key === b.song_key : (a.artist ?? '') === b.artist && (a.title ?? '') === b.title;

/** Setlists: server copy cached on the phone, with queued creates, edits and deletes applied at once. */
export function useSetlists() {
  const queryClient = useQueryClient();
  useBindMeQueryClient(queryClient);
  const userKey = useUserKey();
  const queryKey = useMemo(() => setlistsKeyFor(userKey), [userKey]);
  const cached = useMemo(() => readCache(userKey && setlistsStorageKey(userKey), isCache), [userKey]);
  const q = useQuery<SetlistsCache>({
    queryKey,
    enabled: userKey !== null,
    initialData: cached,
    initialDataUpdatedAt: cached?.savedAt,
    staleTime: 60_000,
    retry: false,
    queryFn: async ({ signal }) => {
      const startedAt = Date.now();
      const next = { setlists: await listSetlists(), savedAt: Date.now() };
      // Cancelled (account change, unmount): its result is discarded, so it must not write the cache or settle.
      if (signal?.aborted) return next;
      if (userKey) writeCacheFor(userKey, setlistsStorageKey(userKey), next);
      useLibrarySettle.getState().settleSetlists(startedAt);
      return next;
    },
  });
  useInvalidateOnSynced([queryKey]);

  const pending = useMeOutbox((s) => s.items);
  // Sent writes not yet seen by a fetch, when there was no cache to put them in (see librarySettle.setlistsSent).
  const sent = useLibrarySettle((s) => s.setlistsSent);
  const setlists = useMemo(() => overlaySetlists(withSentSetlists(q.data?.setlists ?? [], sent), pending), [q.data, sent, pending]);
  const offline = q.isError && q.error instanceof ApiError && q.error.status === 0;
  // Every setlist this hook has shown, so an edit from an open screen never loses its list if the cache briefly
  // lacks it (save() would otherwise have nothing to build on).
  const lastKnown = useRef({ userKey, byId: new Map<string, Setlist>() });
  useEffect(() => {
    if (lastKnown.current.userKey !== userKey) lastKnown.current = { userKey, byId: new Map() }; // per account
    for (const s of setlists) lastKnown.current.byId.set(s.id, s);
  }, [setlists, userKey]);

  const find = useCallback(
    (id: string) => {
      const base = withSentSetlists(queryClient.getQueryData<SetlistsCache>(queryKey)?.setlists ?? [], useLibrarySettle.getState().setlistsSent);
      return overlaySetlists(base, useMeOutbox.getState().items).find((s) => s.id === id);
    },
    [queryClient, queryKey],
  );
  // What an edit builds on: the cache and queue, else the last list this hook showed (like save()).
  const current = useCallback((id: string) => find(id) ?? lastKnown.current.byId.get(id), [find]);
  const save = useCallback(
    (id: string, patch: { name?: string; items?: SetlistItemIn[]; create?: boolean }): boolean => {
      const queued = useMeOutbox.getState().items.find((i) => i.key === `setlist:${id}`);
      if (!patch.create && queued?.op === 'delete') return false; // deleted: nothing to edit
      const cur = find(id) ?? (patch.create ? undefined : lastKnown.current.byId.get(id));
      // Never create from an edit: a list we know nothing about would be created nameless (decide 422s and the edit
      // is dropped for good). Refuse instead.
      if (!cur && !patch.create) return false;
      if ((patch.items ?? cur?.items ?? []).length > MAX_SETLIST_ITEMS) return false; // never silently truncate
      const items = (patch.items ?? cur?.items ?? []).map((x) => ({
        item_id: x.item_id?.startsWith('local-') ? undefined : x.item_id, song_key: x.song_key, artist: x.artist, title: x.title,
      }));
      const queuedCreate = queued?.op === 'save' && queued.create;
      useMeOutbox.getState().enqueue({
        key: `setlist:${id}`,
        op: 'save',
        id,
        name: patch.name ?? cur?.name ?? '',
        items,
        create: patch.create ?? (!cur || queuedCreate === true),
        baseRev: cur?.rev ?? null,
        ...(patch.name !== undefined && cur && patch.name !== cur.name ? { rename: true } : {}),
      });
      return true;
    },
    [find],
  );

  return {
    setlists,
    loading: userKey !== null && q.data === undefined && q.isFetching,
    offline,
    createSetlist(name: string): string {
      const id = `pl_${newUuid()}`;
      save(id, { name, items: [], create: true });
      return id;
    },
    renameSetlist: (id: string, name: string) => save(id, { name }),
    /** false when the list would pass 500 songs (nothing is changed). */
    setItems: (id: string, items: SetlistItemIn[]): boolean => save(id, { items }),
    /** Which setlists got the song, and which were full (500 songs) so the UI can say so. */
    addSongs(ids: string[], song: SongRef): { added: string[]; full: string[] } {
      const out = { added: [] as string[], full: [] as string[] };
      for (const id of ids) {
        const cur = current(id);
        if (!cur) continue;
        const items = cur.items ?? [];
        if (items.some((x) => sameSong(x, song))) continue;
        const ok = save(id, { items: [...items, { artist: song.artist, title: song.title, song_key: song.song_key ?? null }] });
        (ok ? out.added : out.full).push(id);
      }
      return out;
    },
    removeItem(id: string, itemId: string) {
      const cur = current(id);
      if (cur) save(id, { items: (cur.items ?? []).filter((x) => x.item_id !== itemId) });
    },
    deleteSetlist(id: string) {
      lastKnown.current.byId.delete(id);
      useMeOutbox.getState().enqueue({ key: `setlist:${id}`, op: 'delete', id });
    },
  };
}
