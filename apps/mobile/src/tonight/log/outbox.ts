import { ApiError, deleteKaraokeLog, putKaraokeLog, type KaraokeLogPatch } from '@nomad/api-decide';
import { create } from 'zustand';

import { useAuth } from '../../auth/store';
import { appStorage } from '../../storage';
import { userKeyFor } from '../nightStore';

/**
 * The karaoke-log outbox (spec §6.1): writes to decide's `/api/my/karaoke-log` queued on the phone, so a log works
 * offline and syncs later. FIFO, one item per record id (ruling E8-R2: a later write coalesces into the queued one,
 * field-wise, the latest value winning), per user (MMKV `tonight.outbox.v1.<userKey>`, swapped on account change,
 * Review Focus 1). One flush at a time; a transient failure backs off 5 s → 5 min.
 */
export type OutboxItem =
  | { id: string; op: 'put'; patch: KaraokeLogPatch; rev: number }
  | { id: string; op: 'delete'; rev: number };

export const OUTBOX_BACKOFF_BASE_MS = 5_000;
export const OUTBOX_BACKOFF_MAX_MS = 5 * 60_000;

const keyFor = (userKey: string) => `tonight.outbox.v1.${userKey}`;

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

function load(userKey: string | null): OutboxItem[] {
  if (!userKey) return [];
  try {
    const raw = appStorage.getString(keyFor(userKey));
    const v: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(v)
      ? v.filter(
          (x): x is OutboxItem =>
            !!x && typeof x === 'object' && typeof x.id === 'string' && (x.op === 'delete' || (x.op === 'put' && !!x.patch)),
        )
      : [];
  } catch {
    return [];
  }
}

type OutboxStore = {
  userKey: string | null;
  items: OutboxItem[];
  /** Consecutive transient failures (drives the backoff). */
  attempts: number;
  /** When the next backoff retry fires (ms epoch), or null. */
  retryAt: number | null;
  enqueue(id: string, op: 'put', patch: KaraokeLogPatch): void;
  enqueue(id: string, op: 'delete'): void;
  /** Sends the queue in order; resolves when it is empty, blocked (401 / transient error) or the user changed. */
  flush(): Promise<void>;
  rehydrate(email: string | null): void;
};

const emailOf = (): string | null => {
  const s = useAuth.getState().state;
  return s.status === 'signedIn' ? s.session.email : null;
};

let rev = 0;
let flushing: Promise<void> | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
const clearTimer = () => {
  if (timer) clearTimeout(timer);
  timer = null;
};

export const useOutbox = create<OutboxStore>((set, get) => {
  const save = (items: OutboxItem[]) => {
    const { userKey } = get();
    if (!userKey) return;
    if (items.length) appStorage.set(keyFor(userKey), JSON.stringify(items));
    else appStorage.remove(keyFor(userKey));
    set({ items });
  };

  async function run(owner: string): Promise<void> {
    for (;;) {
      if (get().userKey !== owner) return; // account changed mid-flush: never send or touch the other queue
      const head = get().items[0];
      if (!head) return;
      try {
        if (head.op === 'put') await putKaraokeLog(head.id, head.patch);
        else await deleteKaraokeLog(head.id);
      } catch (e) {
        if (get().userKey !== owner) return;
        if (isPermanent(e)) {
          const detail = e instanceof ApiError ? `${e.status} ${String(e.detail)}` : String(e);
          // E8-R4: a 403 not_owner on a kj_ id (kjbox hasn't delivered; decide made a placeholder) lands here too.
          console.warn(`[karaoke-log] dropped ${head.op} ${head.id}: ${detail}`);
          save(get().items.filter((i) => !(i.id === head.id && i.rev === head.rev)));
          continue;
        }
        if (e instanceof ApiError && e.status === 401) return; // retried after sign-in (or the next trigger)
        const attempts = get().attempts + 1;
        const delay = outboxBackoffMs(attempts);
        clearTimer();
        timer = setTimeout(() => {
          timer = null;
          void get().flush();
        }, delay);
        set({ attempts, retryAt: Date.now() + delay });
        return;
      }
      if (get().userKey !== owner) return;
      set({ attempts: 0, retryAt: null });
      // Coalesced while in flight (a newer rev): keep it, it is sent again with the merged patch.
      save(get().items.filter((i) => !(i.id === head.id && i.rev === head.rev)));
    }
  }

  const initialKey = emailOf() ? userKeyFor(emailOf()!) : null;
  return {
    userKey: initialKey,
    items: load(initialKey),
    attempts: 0,
    retryAt: null,

    enqueue(id: string, op: 'put' | 'delete', patch?: KaraokeLogPatch) {
      if (!get().userKey) return;
      const items = [...get().items];
      const i = items.findIndex((x) => x.id === id);
      const prev = i >= 0 ? items[i] : undefined;
      const next: OutboxItem =
        op === 'delete'
          ? { id, op, rev: ++rev }
          : { id, op, patch: prev?.op === 'put' ? mergePatch(prev.patch, patch ?? {}) : (patch ?? {}), rev: ++rev };
      if (i >= 0) items[i] = next;
      else items.push(next);
      save(items);
      void get().flush();
    },

    flush() {
      const owner = get().userKey;
      if (!owner || flushing) return flushing ?? Promise.resolve();
      clearTimer();
      set({ retryAt: null });
      flushing = run(owner).finally(() => {
        flushing = null;
        // The account changed mid-flush: the new user's queue gets its own flush.
        const now = get().userKey;
        if (now && now !== owner) void get().flush();
      });
      return flushing;
    },

    rehydrate(email) {
      clearTimer();
      const userKey = email ? userKeyFor(email) : null;
      set({ userKey, items: load(userKey), attempts: 0, retryAt: null });
    },
  } as OutboxStore;
});

/** Test hook: waits for the running flush (if any). */
export const outboxIdle = (): Promise<void> => flushing ?? Promise.resolve();

// Account switch: the new user's queue (or none), never the previous one's; then try to send it.
useAuth.subscribe((s) => {
  const email = s.state.status === 'signedIn' ? s.state.session.email : null;
  const want = email ? userKeyFor(email) : null;
  if (want !== useOutbox.getState().userKey) {
    useOutbox.getState().rehydrate(email);
    if (want) void useOutbox.getState().flush();
  }
});
