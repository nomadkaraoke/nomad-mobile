import { ApiError, listSetlists, type Setlist, type SetlistItemIn } from '@nomad/api-decide';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import { newUuid } from '../tonight/nightStore';
import { setlistsStorageKey, useUserKey } from './account';
import { isObj, readCache, writeCache } from './cache';
import { useInvalidateOnSynced } from './useLibrary';
import { useMeOutbox } from './meOutbox';
import { overlaySetlists } from './pending';

type SetlistsCache = { setlists: Setlist[]; savedAt: number };
const isCache = (v: unknown): v is SetlistsCache => isObj(v) && Array.isArray(v.setlists) && typeof v.savedAt === 'number';
export const setlistsKeyFor = (userKey: string | null) => ['decide', userKey, 'setlists'] as const;

const MAX_ITEMS = 500;
type SongRef = { artist: string; title: string; song_key?: string | null };
const sameSong = (a: SetlistItemIn, b: SongRef) =>
  a.song_key && b.song_key ? a.song_key === b.song_key : (a.artist ?? '') === b.artist && (a.title ?? '') === b.title;

/** Setlists: server copy cached on the phone, with queued creates, edits and deletes applied at once. */
export function useSetlists() {
  const queryClient = useQueryClient();
  const userKey = useUserKey();
  const queryKey = setlistsKeyFor(userKey);
  const cached = useMemo(() => readCache(userKey && setlistsStorageKey(userKey), isCache), [userKey]);
  const q = useQuery<SetlistsCache>({
    queryKey,
    enabled: userKey !== null,
    initialData: cached,
    initialDataUpdatedAt: cached?.savedAt,
    staleTime: 60_000,
    retry: false,
    queryFn: async () => {
      const next = { setlists: await listSetlists(), savedAt: Date.now() };
      if (userKey) writeCache(setlistsStorageKey(userKey), next);
      return next;
    },
  });
  useInvalidateOnSynced([queryKey]);

  const pending = useMeOutbox((s) => s.items);
  const setlists = useMemo(() => overlaySetlists(q.data?.setlists ?? [], pending), [q.data, pending]);
  const offline = q.isError && q.error instanceof ApiError && q.error.status === 0;

  const find = useCallback(
    (id: string) => overlaySetlists(queryClient.getQueryData<SetlistsCache>(queryKey)?.setlists ?? [], useMeOutbox.getState().items).find((s) => s.id === id),
    [queryClient, queryKey],
  );
  const save = useCallback(
    (id: string, patch: { name?: string; items?: SetlistItemIn[]; create?: boolean }) => {
      const cur = find(id);
      const items = (patch.items ?? cur?.items ?? []).slice(0, MAX_ITEMS).map((x) => ({
        item_id: x.item_id?.startsWith('local-') ? undefined : x.item_id, song_key: x.song_key, artist: x.artist, title: x.title,
      }));
      const queued = useMeOutbox.getState().items.find((i) => i.key === `setlist:${id}`);
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
    setItems: (id: string, items: SetlistItemIn[]) => save(id, { items }),
    addSongs(ids: string[], song: SongRef) {
      for (const id of ids) {
        const cur = find(id);
        if (!cur) continue;
        const items = cur.items ?? [];
        if (items.some((x) => sameSong(x, song))) continue;
        save(id, { items: [...items, { artist: song.artist, title: song.title, song_key: song.song_key ?? null }] });
      }
    },
    removeItem(id: string, itemId: string) {
      const cur = find(id);
      if (cur) save(id, { items: (cur.items ?? []).filter((x) => x.item_id !== itemId) });
    },
    deleteSetlist(id: string) {
      useMeOutbox.getState().enqueue({ key: `setlist:${id}`, op: 'delete', id });
    },
  };
}
