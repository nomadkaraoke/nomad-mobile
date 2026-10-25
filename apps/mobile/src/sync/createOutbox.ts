import { ApiError } from '@nomad/api-decide';
import { create, type StoreApi, type UseBoundStore } from 'zustand';

import { useAuth } from '../auth/store';
import { userKeyFor } from '../auth/userKey';
import { appStorage } from '../storage';

/**
 * A generic per-account write outbox: FIFO, one item per `key` (a later write is merged into the queued one, keeping
 * the first insertion's position), persisted in MMKV per user, one flush at a time. A transient failure backs off, a
 * 401 stops the flush (retried after sign-in or on the next trigger), a permanent error drops the item.
 * A write coalesced while its predecessor is in flight is never lost: items carry a rev, and a successful send
 * removes the item only if its rev is unchanged.
 */
export type OutboxConfig<I extends { key: string }> = {
  storageKey: (userKey: string) => string;
  send: (item: I) => Promise<void>;
  /** Merge `next` into the `queued` item for the same key. `null` drops the queued item (nothing to send). */
  merge: (queued: I, next: I) => I | null;
  isPermanent: (e: unknown) => boolean;
  backoff: (attempts: number) => number;
  /** Optional: validate / upgrade a persisted raw item (return null to discard it). */
  parse?: (raw: unknown) => I | null;
};

type Stored<I> = I & { rev: number };

export type OutboxStore<I extends { key: string }> = {
  userKey: string | null;
  items: Stored<I>[];
  /** Consecutive transient failures (drives the backoff). */
  attempts: number;
  /** When the next backoff retry fires (ms epoch), or null. */
  retryAt: number | null;
  /** Writes the server has accepted this session. */
  synced: number;
  enqueue(item: I): void;
  /** Sends the queue in order; resolves when it is empty, blocked (401 / transient error) or the user changed. */
  flush(): Promise<void>;
  rehydrate(email: string | null): void;
  /** Empties the current user's queue (memory and storage). */
  clear(): void;
};

export type OutboxHook<I extends { key: string }> = UseBoundStore<StoreApi<OutboxStore<I>>> & {
  /** Test hook: waits for the running flush (if any). */
  idle(): Promise<void>;
};

const emailOf = (): string | null => {
  const s = useAuth.getState().state;
  return s.status === 'signedIn' ? s.session.email : null;
};

export function createOutbox<I extends { key: string }>(cfg: OutboxConfig<I>): OutboxHook<I> {
  let rev = 0;
  let flushing: Promise<void> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: { key: string; rev: number } | null = null;
  const clearTimer = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  const load = (userKey: string | null): Stored<I>[] => {
    if (!userKey) return [];
    let out: Stored<I>[] = [];
    try {
      const raw = appStorage.getString(cfg.storageKey(userKey));
      const v: unknown = raw ? JSON.parse(raw) : [];
      if (Array.isArray(v)) {
        for (const x of v) {
          if (!x || typeof x !== 'object') continue;
          const parsed = cfg.parse ? cfg.parse(x) : (x as I);
          if (!parsed || typeof parsed.key !== 'string') continue;
          const r = (x as { rev?: unknown }).rev;
          out.push({ ...parsed, rev: typeof r === 'number' ? r : 0 });
        }
      }
    } catch {
      out = [];
    }
    // The counter must stay above every stored rev, so a persisted item and a write coalesced onto it never share one.
    for (const i of out) if (i.rev > rev) rev = i.rev;
    return out;
  };

  const store = create<OutboxStore<I>>((set, get) => {
    const persist = (items: Stored<I>[]) => {
      const { userKey } = get();
      if (!userKey) return;
      if (items.length) appStorage.set(cfg.storageKey(userKey), JSON.stringify(items));
      else appStorage.remove(cfg.storageKey(userKey));
      set({ items });
    };
    const without = (head: Stored<I>) => get().items.filter((i) => !(i.key === head.key && i.rev === head.rev));

    async function run(owner: string): Promise<void> {
      for (;;) {
        if (get().userKey !== owner) return; // account changed mid-flush: never send or touch the other queue
        const head = get().items[0];
        if (!head) return;
        inFlight = { key: head.key, rev: head.rev };
        try {
          await cfg.send(head);
        } catch (e) {
          inFlight = null;
          if (get().userKey !== owner) return;
          if (cfg.isPermanent(e)) {
            const detail = e instanceof ApiError ? `${e.status} ${String(e.detail)}` : String(e);
            console.warn(`[outbox] dropped ${head.key}: ${detail}`);
            persist(without(head));
            continue;
          }
          if (e instanceof ApiError && e.status === 401) return;
          const attempts = get().attempts + 1;
          const delay = cfg.backoff(attempts);
          clearTimer();
          timer = setTimeout(() => {
            timer = null;
            void get().flush();
          }, delay);
          set({ attempts, retryAt: Date.now() + delay });
          return;
        }
        inFlight = null;
        if (get().userKey !== owner) return;
        set({ attempts: 0, retryAt: null, synced: get().synced + 1 });
        // Coalesced while in flight (a newer rev): kept, sent again with the merged value.
        persist(without(head));
      }
    }

    const initialKey = emailOf() ? userKeyFor(emailOf()!) : null;
    return {
      userKey: initialKey,
      items: load(initialKey),
      attempts: 0,
      retryAt: null,
      synced: 0,

      enqueue(item) {
        if (!get().userKey) return;
        const items = [...get().items];
        const i = items.findIndex((x) => x.key === item.key);
        const prev = i >= 0 ? items[i] : undefined;
        if (prev) {
          const { rev: _r, ...queued } = prev;
          const merged = cfg.merge(queued as unknown as I, item);
          if ((merged as unknown) === (queued as unknown)) return; // nothing changed (the write was dropped)
          const sending = inFlight?.key === item.key && inFlight.rev === prev.rev;
          if (merged === null && !sending) {
            items.splice(i, 1);
          } else {
            // A send already in flight cannot be recalled: replace it so the follow-up reaches the server.
            items[i] = { ...(merged ?? item), rev: ++rev };
          }
        } else {
          items.push({ ...item, rev: ++rev });
        }
        persist(items);
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

      clear() {
        clearTimer();
        const { userKey } = get();
        if (userKey) appStorage.remove(cfg.storageKey(userKey));
        set({ items: [], attempts: 0, retryAt: null });
      },
    };
  });

  // Account switch: the new user's queue (or none), never the previous one's; then try to send it.
  useAuth.subscribe((s) => {
    const email = s.state.status === 'signedIn' ? s.state.session.email : null;
    const want = email ? userKeyFor(email) : null;
    if (want !== store.getState().userKey) {
      store.getState().rehydrate(email);
      if (want) void store.getState().flush();
    }
  });

  return Object.assign(store, { idle: (): Promise<void> => flushing ?? Promise.resolve() });
}
