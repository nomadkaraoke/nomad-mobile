import { ApiError, deleteKaraokeLog, putKaraokeLog, type KaraokeLogPatch } from '@nomad/api-decide';

import { createOutbox } from '../../sync/createOutbox';

/**
 * The karaoke-log outbox (spec §6.1): writes to decide's `/api/my/karaoke-log` queued on the phone, so a log works
 * offline and syncs later. FIFO, one item per record id (ruling E8-R2: a later write coalesces into the queued one,
 * field-wise, the latest value winning), per user (MMKV `tonight.outbox.v1.<userKey>`, swapped on account change,
 * Review Focus 1). One flush at a time; a transient failure backs off 5 s → 5 min.
 */
export type OutboxItem =
  | { key?: string; id: string; op: 'put'; patch: KaraokeLogPatch; rev: number }
  | { key?: string; id: string; op: 'delete'; rev: number };

/** What the generic outbox is fed (it assigns `rev`). `key` is the record id. */
type Queued = { key: string; id: string } & ({ op: 'put'; patch: KaraokeLogPatch } | { op: 'delete' });

export const OUTBOX_BACKOFF_BASE_MS = 5_000;
export const OUTBOX_BACKOFF_MAX_MS = 5 * 60_000;

/** Backoff after `attempts` consecutive transient failures (1 → 5 s, doubling, capped at 5 min). */
export const outboxBackoffMs = (attempts: number): number =>
  Math.min(OUTBOX_BACKOFF_MAX_MS, OUTBOX_BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1));

/** decide answers that will never succeed on retry: drop the item (400 invalid, 403 not_owner, 404 not_found, 422). */
export const isPermanent = (e: unknown): boolean => e instanceof ApiError && [400, 403, 404, 422].includes(e.status);

const NESTED = new Set(['survey', 'night', 'media']);

/** Field-wise merge: later top-level fields win; survey/night/media merge one level down. */
export function mergePatch(a: KaraokeLogPatch, b: KaraokeLogPatch): KaraokeLogPatch {
  const out: Record<string, unknown> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    const prev = out[k];
    out[k] =
      NESTED.has(k) && prev && v && typeof prev === 'object' && typeof v === 'object'
        ? { ...(prev as object), ...(v as object) }
        : v;
  }
  return out as KaraokeLogPatch;
}


const hook = createOutbox<Queued>({
  storageKey: (userKey) => `tonight.outbox.v1.${userKey}`,
  // Items persisted before the generic outbox have no `key`: it is the record id.
  parse: (raw) => {
    const x = raw as { id?: unknown; op?: unknown; patch?: unknown };
    if (typeof x.id !== 'string') return null;
    if (x.op === 'delete') return { key: x.id, id: x.id, op: 'delete' };
    if (x.op === 'put' && x.patch) return { key: x.id, id: x.id, op: 'put', patch: x.patch as KaraokeLogPatch };
    return null;
  },
  send: async (item) => {
    if (item.op === 'put') await putKaraokeLog(item.id, item.patch);
    else await deleteKaraokeLog(item.id);
  },
  // A put after a queued delete for the same id:
  // - app_ ids: the delete wins and the put is dropped (returned unchanged = no-op). The record is gone (decide's
  //   `deleted: false` would not reliably revive it), and a song logged again always gets a new id.
  // - kj_ ids: last write wins (the put replaces the delete). The id is kjbox's, fixed per performance, so a later
  //   survey or re-add for that performance must reach decide.
  merge: (queued, next) => {
    if (next.op === 'put' && queued.op === 'delete' && !next.id.startsWith('kj_')) return queued;
    if (next.op === 'put' && queued.op === 'put') return { ...next, patch: mergePatch(queued.patch, next.patch) };
    return next;
  },
  isPermanent,
  backoff: outboxBackoffMs,
});

type TonightStore = Omit<ReturnType<typeof hook.getState>, 'items' | 'enqueue'> & {
  items: OutboxItem[];
  enqueue(id: string, op: 'put', patch: KaraokeLogPatch): void;
  enqueue(id: string, op: 'delete'): void;
};

function enqueue(id: string, op: 'put' | 'delete', patch?: KaraokeLogPatch) {
  hook.getState().enqueue(op === 'delete' ? { key: id, id, op } : { key: id, id, op, patch: patch ?? {} });
}

type TonightState = Omit<ReturnType<typeof hook.getState>, 'items' | 'enqueue'> & { items: OutboxItem[]; enqueue: TonightStore['enqueue'] };

/** Same store as before (`getState().enqueue(id, op, patch)`), now backed by the generic outbox. */
function useOutboxImpl<T>(selector: (s: TonightStore) => T): T {
  return hook((s) => selector({ ...s, enqueue } as unknown as TonightStore));
}
export const useOutbox = Object.assign(useOutboxImpl, {
  getState: (): TonightStore => ({ ...hook.getState(), enqueue }) as unknown as TonightStore,
  /** Items given without a `key` (older shapes) are keyed by their id. */
  setState: (partial: Partial<Omit<TonightState, 'enqueue'>>) =>
    hook.setState({
      ...partial,
      ...(partial.items ? { items: partial.items.map((i) => ({ ...i, key: i.key ?? i.id })) } : {}),
    } as never),
  subscribe: hook.subscribe,
});

/** Test hook: waits for the running flush (if any). */
export const outboxIdle = (): Promise<void> => hook.idle();
