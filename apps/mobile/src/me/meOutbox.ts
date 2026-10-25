import {
  ApiError,
  createSetlist,
  deleteSetlist,
  loveSong,
  putSetlistItems,
  renameSetlist,
  unloveSong,
  type SetlistItemIn,
} from '@nomad/api-decide';

import { createOutbox } from '../sync/createOutbox';
import { isPermanent, outboxBackoffMs } from '../tonight/log/outbox';

/**
 * The Me outbox: setlist writes and loves queued on the phone, so they work offline and sync later. One item per
 * setlist / song (`key`); see `meMerge` for how a later write folds into a queued one.
 */
export type MeOutboxItem =
  | {
      key: `setlist:${string}`;
      op: 'save';
      id: string;
      name: string;
      items: SetlistItemIn[];
      create: boolean;
      baseRev: number | null;
      /** The name changed (set by callers that rename): `renameSetlist` runs after the items are put. */
      rename?: boolean;
    }
  | { key: `setlist:${string}`; op: 'delete'; id: string }
  | { key: `love:${string}`; op: 'love'; song_key: string; artist: string; title: string; loved: boolean };

export function meMerge(queued: MeOutboxItem, next: MeOutboxItem): MeOutboxItem | null {
  if (queued.op === 'save' && next.op === 'save') {
    return {
      ...next,
      create: queued.create || next.create,
      rename: queued.rename || next.rename || undefined,
      baseRev: queued.baseRev, // the rev the first queued edit started from
    };
  }
  if (next.op === 'delete' && queued.op === 'save') return queued.create ? null : next; // never created: nothing to do
  return next; // love after love, delete after delete, save after delete: the newer wins
}

export async function sendMe(item: MeOutboxItem): Promise<void> {
  switch (item.op) {
    case 'save':
      if (item.create) {
        await createSetlist({ id: item.id, name: item.name, items: item.items }); // idempotent on the client id
        return;
      }
      await putSetlistItems(item.id, item.items, item.baseRev);
      if (item.rename) await renameSetlist(item.id, item.name);
      return;
    case 'delete':
      try {
        await deleteSetlist(item.id);
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return; // already gone: done
        throw e;
      }
      return;
    case 'love':
      if (item.loved) await loveSong(item.song_key, { artist: item.artist, title: item.title });
      else await unloveSong(item.song_key);
  }
}

export const useMeOutbox = createOutbox<MeOutboxItem>({
  storageKey: (userKey) => `me.outbox.v1.${userKey}`,
  send: sendMe,
  merge: meMerge,
  isPermanent,
  backoff: outboxBackoffMs,
});
