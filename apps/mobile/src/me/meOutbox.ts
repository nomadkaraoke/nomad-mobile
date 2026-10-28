import {
  ApiError,
  createSetlist,
  deleteSetlist,
  dismissGetMade,
  loveSong,
  putSetlistItems,
  renameSetlist,
  undismissGetMade,
  unloveSong,
  type Setlist,
  type SetlistItemIn,
} from '@nomad/api-decide';

import { createOutbox } from '../sync/createOutbox';
import { isPermanent, outboxBackoffMs } from '../sync/outboxPolicy';
import { onSetlistSent } from './setlistsCache';

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
  | { key: `love:${string}`; op: 'love'; song_key: string; artist: string; title: string; loved: boolean }
  /** Get this made: hide (or, on undo, show again) a song by its get-made `key` (a song_key or a `u:` key). */
  | { key: `dismiss:${string}`; op: 'dismiss'; dismissKey: string; dismissed: boolean };

export function meMerge(queued: MeOutboxItem & { attempted?: boolean }, next: MeOutboxItem): MeOutboxItem | null {
  if (queued.op === 'save' && next.op === 'save') {
    return {
      ...next,
      create: queued.create || next.create,
      rename: queued.rename || next.rename || undefined,
      baseRev: queued.baseRev, // the rev the first queued edit started from
    };
  }
  // A delete after a create that was never attempted: nothing to do. Once a create has been attempted (in flight, or
  // timed out but maybe committed) the delete must still go out (404 = done).
  if (next.op === 'delete' && queued.op === 'save') return queued.create && !queued.attempted ? null : next;
  return next; // love after love, dismiss after dismiss, delete after delete, save after delete: the newer wins
}

const sig = (x: { song_key?: string | null; artist?: string; title?: string }) =>
  x.song_key ? `k:${x.song_key}` : `u:${x.artist ?? ''}|${x.title ?? ''}`;
const sameItems = (server: { song_key?: string | null; artist?: string; title?: string }[] | undefined, mine: SetlistItemIn[]) =>
  (server ?? []).length === mine.length && mine.every((m, i) => sig(m) === sig(server![i]!));

/** Sends one write; a setlist save resolves to the server's setlist after the last call (for `onSetlistSent`). */
export async function sendMe(item: MeOutboxItem): Promise<Setlist | void> {
  switch (item.op) {
    case 'save': {
      if (item.create) {
        // Idempotent on the client id, but a repeat create returns the existing doc UNCHANGED (an edit made while the
        // first create was in flight, or after a timed-out-but-committed one, would be lost): reconcile with the result.
        const made = await createSetlist({ id: item.id, name: item.name, items: item.items });
        let out = made;
        if (!sameItems(made.items, item.items)) out = await putSetlistItems(item.id, item.items, made.rev ?? null);
        if (made.name !== item.name) out = await renameSetlist(item.id, item.name);
        return out;
      }
      let out = await putSetlistItems(item.id, item.items, item.baseRev);
      if (item.rename) out = await renameSetlist(item.id, item.name);
      return out;
    }
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
      return;
    case 'dismiss':
      // Both are idempotent on decide, so a retry after a timed-out send is safe.
      if (item.dismissed) await dismissGetMade(item.dismissKey);
      else await undismissGetMade(item.dismissKey);
  }
}

export const useMeOutbox = createOutbox<MeOutboxItem>({
  storageKey: (userKey) => `me.outbox.v1.${userKey}`,
  send: sendMe,
  onSent: onSetlistSent,
  merge: meMerge,
  isPermanent,
  backoff: outboxBackoffMs,
});
