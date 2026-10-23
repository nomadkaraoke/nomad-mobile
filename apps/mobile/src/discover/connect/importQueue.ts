import { ApiError, uploadExportChunk, type ExportImportResponse } from '@nomad/api-decide';
import type { ExportUploadChunk } from '@nomad/core';
import { Directory, File, Paths } from 'expo-file-system';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { create } from 'zustand';

import { useAuth } from '../../auth/store';
import { useOffline } from '../../net/useOffline';
import { appStorage } from '../../storage';
import { userKeyFor } from '../../auth/userKey';
import { useInvalidateAfterImport } from './queries';

/**
 * The upload queue for privacy exports parsed on the phone (Phase 3b spec §5.4): a picked file is parsed offline,
 * and its decide upload chunks wait here until there is a connection and a signed-in user. FIFO, one upload at a
 * time. Metadata lives in MMKV (`connect.importQueue`); each chunk body (up to 20,000 tracks, a few MB) lives in its
 * own file under `Paths.document/imports/<id>.json`, read only when it is sent. Each item belongs to the account
 * that parsed it and is only ever sent as that account. decide ingests idempotently per chunk, so a retry after a
 * lost response is harmless.
 *
 * Retries (5xx, 429, network, and 401 while the session refreshes): 5, 15, 30, then every 60 s, or the server's
 * `Retry-After` (never under 1 s). Any other 4xx is final: the chunk is dropped and `lastError` set. After
 * `MAX_CONSECUTIVE_401` 401s in a row sending pauses (payloads kept) until the next sign-in or app foreground.
 *
 * Privacy: signing in as a DIFFERENT account purges every other account's queued items, payload files, batches and
 * error, so one person's listening history never sits on a phone someone else signed in to.
 */
export type ImportLabel = 'spotify' | 'apple';

export interface PendingUpload {
  id: string;
  /** The import this chunk belongs to (one `enqueue` call). */
  batch: string;
  /** `userKeyFor(email)` of the account that parsed it. */
  owner: string;
  /** Which decide endpoint; the body is in the payload file. */
  endpoint: ExportUploadChunk['endpoint'];
  attempts: number;
  /** Not sent before this time (ms epoch); 0 = now. */
  nextAt: number;
  label: ImportLabel;
}

/** One import's progress, for the import screen's result ("Added N artists and M songs"). */
export interface ImportBatch {
  label: ImportLabel;
  owner: string;
  chunks: number;
  sent: number;
  failed: number;
  /** decide's totals are cumulative over an export's chunks, so these keep the largest seen (never a sum). */
  artistsAdded: number;
  songsAdded: number;
  /** Chunks decide had already ingested (`duplicate: true`); all of them = this export was imported before. */
  duplicates?: number;
  /** When the last chunk finished (ms epoch); finished batches are pruned after a day. */
  finishedAt?: number;
}

/** The last chunk the queue gave up on (`status: null` = its payload file was missing). Feed it to importErrorKey. */
export interface ImportQueueError {
  /** Account the failed import belonged to: the error is only shown to that account. */
  owner: string;
  batch: string;
  label: ImportLabel;
  status: number | null;
  detail: unknown;
  at: number;
}

const KEY = 'connect.importQueue';
const DIR = 'imports';

export const RETRY_DELAYS_MS = [5_000, 15_000, 30_000, 60_000] as const;
const MIN_RETRY_AFTER_MS = 1_000;
const MAX_CONSECUTIVE_401 = 3;
const BATCH_TTL_MS = 24 * 60 * 60 * 1000;

/** Delay before retry number `attempts` (1-based): the server's Retry-After (seconds) when it sent one. */
export function retryDelayMs(attempts: number, retryAfter: number | null): number {
  if (retryAfter !== null) return Math.max(MIN_RETRY_AFTER_MS, retryAfter * 1000);
  return RETRY_DELAYS_MS[Math.min(Math.max(attempts, 1), RETRY_DELAYS_MS.length) - 1] ?? 60_000;
}

/** Worth trying again: no connection, decide busy or down, rate-limited, or the session briefly not accepted. */
const isRetryable = (e: unknown): boolean =>
  !(e instanceof ApiError) || e.status === 0 || e.status === 401 || e.status === 429 || e.status >= 500;

let seq = 0;
/** Unique on this phone (time + counter + random); also a safe file name. */
const newId = () => `${Date.now().toString(36)}-${(seq++).toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const payloadDir = () => new Directory(Paths.document, DIR);
const payloadFile = (id: string) => new File(Paths.document, DIR, `${id}.json`);

function deletePayload(id: string): void {
  try {
    const f = payloadFile(id);
    if (f.exists) f.delete();
  } catch {
    // Best effort: an orphan is swept on the next launch.
  }
}

const isDone = (b: ImportBatch | undefined) => !!b && b.sent + b.failed >= b.chunks;
/** Every chunk of the batch came back `duplicate: true`: the same export was imported before, nothing new. */
export const isAlreadyImported = (b: ImportBatch | undefined) => !!b && b.chunks > 0 && (b.duplicates ?? 0) >= b.chunks;

/** Drops finished batches older than a day (their result screen is long gone). */
function pruneBatches(batches: Record<string, ImportBatch>, now = Date.now()): Record<string, ImportBatch> {
  return Object.fromEntries(
    Object.entries(batches).filter(([, b]) => !(isDone(b) && b.finishedAt !== undefined && now - b.finishedAt > BATCH_TTL_MS)),
  );
}

type Persisted = { pending: PendingUpload[]; batches: Record<string, ImportBatch>; lastError: ImportQueueError | null };

function load(): Persisted {
  try {
    const raw = appStorage.getString(KEY);
    const v = (raw ? JSON.parse(raw) : {}) as Partial<Persisted>;
    const pending = Array.isArray(v.pending)
      ? v.pending.filter(
          (p): p is PendingUpload =>
            !!p && typeof p.id === 'string' && typeof p.owner === 'string' && typeof p.batch === 'string',
        )
      : [];
    const batches = pruneBatches(v.batches && typeof v.batches === 'object' ? v.batches : {});
    return { pending, batches, lastError: v.lastError ?? null };
  } catch {
    return { pending: [], batches: {}, lastError: null };
  }
}

type ImportQueueStore = Persisted & {
  /** Queues an import's chunks (bodies to files) and tries to send. Returns the batch id, or null when signed out. */
  enqueue(chunks: ExportUploadChunk[], label: ImportLabel): string | null;
  remove(id: string): void;
  clearBatch(batch: string): void;
  clearError(): void;
  /** Re-reads MMKV (what a restart sees). */
  rehydrate(): void;
};

const currentOwner = (): string | null => {
  const s = useAuth.getState().state;
  return s.status === 'signedIn' ? userKeyFor(s.session.email) : null;
};

/** Applies a change to the store and writes the metadata to MMKV. */
function save(patch: Partial<Persisted>): void {
  useImportQueue.setState(patch);
  const { pending, batches, lastError } = useImportQueue.getState();
  appStorage.set(KEY, JSON.stringify({ pending, batches, lastError }));
}

export const useImportQueue = create<ImportQueueStore>((set, get) => {
  return {
    ...load(),

    enqueue(chunks, label) {
      const owner = currentOwner();
      if (!owner) return null;
      const batch = newId();
      if (chunks.length === 0) return batch;
      const dir = payloadDir();
      if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
      const items: PendingUpload[] = chunks.map((chunk) => {
        const id = newId();
        // The file first: a crash before MMKV is saved only leaves an orphan (swept), never an item with no body.
        const f = payloadFile(id);
        f.create({ overwrite: true });
        f.write(JSON.stringify(chunk));
        return { id, batch, owner, endpoint: chunk.endpoint, attempts: 0, nextAt: 0, label };
      });
      save({
        pending: [...get().pending, ...items],
        batches: {
          ...pruneBatches(get().batches),
          [batch]: { label, owner, chunks: chunks.length, sent: 0, failed: 0, artistsAdded: 0, songsAdded: 0 },
        },
      });
      kick();
      return batch;
    },

    remove(id) {
      deletePayload(id);
      save({ pending: get().pending.filter((p) => p.id !== id) });
    },

    clearBatch(batch) {
      const { [batch]: _gone, ...rest } = get().batches;
      save({ batches: rest });
    },

    clearError() {
      save({ lastError: null });
    },

    rehydrate() {
      clearTimer();
      unauthorized = 0;
      set(load());
    },
  };
});

// ---- The sender -------------------------------------------------------------------------------------------------

let online = false;
let running: Promise<void> | null = null;
let kickAgain = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let swept = false;
/** Consecutive 401s; at MAX_CONSECUTIVE_401 sending pauses until a sign-in or app foreground. */
let unauthorized = 0;

function clearTimer(): void {
  if (timer) clearTimeout(timer);
  timer = null;
}

function wakeAt(at: number): void {
  clearTimer();
  timer = setTimeout(
    () => {
      timer = null;
      kick();
    },
    Math.max(0, at - Date.now()),
  );
}

/** Deletes payload files no queued item refers to (left by a crash between writing a file and saving MMKV). */
function sweepOrphans(): void {
  if (swept) return;
  swept = true;
  try {
    const dir = payloadDir();
    if (!dir.exists) return;
    const live = new Set(useImportQueue.getState().pending.map((p) => `${p.id}.json`));
    for (const entry of dir.list()) {
      const name = entry.uri.slice(entry.uri.lastIndexOf('/') + 1);
      if (entry instanceof File && !live.has(name)) entry.delete();
    }
  } catch {
    // Best effort.
  }
}

function patchBatch(batch: string, patch: (b: ImportBatch) => Partial<ImportBatch>): Record<string, ImportBatch> {
  const { batches } = useImportQueue.getState();
  const b = batches[batch];
  return b ? { ...batches, [batch]: { ...b, ...patch(b) } } : batches;
}

function finish(item: PendingUpload, outcome: { ok: ExportImportResponse } | { error: ImportQueueError }): void {
  deletePayload(item.id);
  const pending = useImportQueue.getState().pending.filter((p) => p.id !== item.id);
  if ('ok' in outcome) {
    const r = outcome.ok;
    save({
      pending,
      batches: patchBatch(item.batch, (b) => ({
        sent: b.sent + 1,
        artistsAdded: Math.max(b.artistsAdded, r.artists_added),
        songsAdded: Math.max(b.songsAdded, r.songs_added),
        duplicates: (b.duplicates ?? 0) + (r.duplicate ? 1 : 0),
        ...(b.sent + 1 + b.failed >= b.chunks ? { finishedAt: Date.now() } : {}),
      })),
    });
  } else {
    console.warn(`[import-queue] dropped ${item.label} chunk ${item.id}: ${outcome.error.status} ${String(outcome.error.detail)}`);
    save({
      pending,
      batches: patchBatch(item.batch, (b) => ({
        failed: b.failed + 1,
        ...(b.sent + b.failed + 1 >= b.chunks ? { finishedAt: Date.now() } : {}),
      })),
      lastError: outcome.error,
    });
  }
}

function retryLater(item: PendingUpload, e: unknown): number {
  const attempts = item.attempts + 1;
  const nextAt = Date.now() + retryDelayMs(attempts, e instanceof ApiError ? e.retryAfter : null);
  save({ pending: useImportQueue.getState().pending.map((p) => (p.id === item.id ? { ...p, attempts, nextAt } : p)) });
  return nextAt;
}

async function run(): Promise<void> {
  sweepOrphans();
  for (;;) {
    const owner = currentOwner();
    if (!online || !owner || unauthorized >= MAX_CONSECUTIVE_401) return;
    const head = useImportQueue.getState().pending.find((p) => p.owner === owner);
    if (!head) return;
    if (head.nextAt > Date.now()) {
      wakeAt(head.nextAt);
      return;
    }
    let chunk: ExportUploadChunk;
    try {
      chunk = JSON.parse(await payloadFile(head.id).text()) as ExportUploadChunk;
    } catch (e) {
      finish(head, { error: { owner: head.owner, batch: head.batch, label: head.label, status: null, detail: String(e), at: Date.now() } });
      continue;
    }
    // The file read can take a while: the account may have changed meanwhile, and the request carries the CURRENT token.
    if (currentOwner() !== head.owner) continue;
    try {
      const res = await uploadExportChunk(chunk);
      unauthorized = 0;
      finish(head, { ok: res });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) unauthorized += 1;
      if (isRetryable(e)) {
        const at = retryLater(head, e);
        if (unauthorized < MAX_CONSECUTIVE_401) wakeAt(at);
        return;
      }
      const err = e as ApiError;
      finish(head, { error: { owner: head.owner, batch: head.batch, label: head.label, status: err.status, detail: err.detail, at: Date.now() } });
    }
  }
}

/** Starts a send pass unless one is running (it re-checks the queue, connection and account as it goes). */
function kick(): void {
  if (running) {
    kickAgain = true; // the running pass may already be past its checks: run once more after it
    return;
  }
  kickAgain = false;
  running = run().finally(() => {
    running = null;
    if (kickAgain) kick();
  });
}

/** Set by useImportQueueRunner from useOffline(); exported for tests. */
export function setImportQueueOnline(value: boolean): void {
  online = value;
  if (!value) clearTimer();
  else kick();
}

/** Test hook: waits for the running send pass (if any). */
export async function importQueueIdle(): Promise<void> {
  while (running) await running;
}

/** Removes every item, payload file, batch and error that is not the given account's (null = nobody's). */
function purgeOthers(owner: string | null): void {
  const { pending, batches, lastError } = useImportQueue.getState();
  const foreign = pending.filter((p) => p.owner !== owner);
  if (foreign.length === 0 && Object.values(batches).every((b) => b.owner === owner) && (!lastError || lastError.owner === owner)) {
    return;
  }
  for (const p of foreign) deletePayload(p.id);
  save({
    pending: pending.filter((p) => p.owner === owner),
    batches: Object.fromEntries(Object.entries(batches).filter(([, b]) => b.owner === owner)),
    lastError: lastError && lastError.owner === owner ? lastError : null,
  });
}

// Signing in (or switching account) may unblock that account's uploads. A DIFFERENT account than the queue's owner
// purges the owner's leftovers; sign-out keeps the queue (the same person signing back in still gets it sent) but
// hides the error.
useAuth.subscribe((s, prev) => {
  if (s.state === prev.state) return;
  if (s.state.status === 'signedIn') {
    unauthorized = 0;
    purgeOthers(currentOwner());
    kick();
  } else if (useImportQueue.getState().lastError) {
    save({ lastError: null });
  }
});

AppState.addEventListener('change', (next) => {
  if (next === 'active' && unauthorized >= MAX_CONSECUTIVE_401) {
    unauthorized = 0;
    kick();
  }
});

/**
 * Drives the queue: sends when online and signed in (a pending retry's timer fires again on return to the
 * foreground), and refreshes the Connect summary, picks and music profile when an import has finished. Mounted once,
 * in the root layout.
 */
export function useImportQueueRunner(): void {
  const offline = useOffline();
  const invalidate = useInvalidateAfterImport();

  useEffect(() => {
    setImportQueueOnline(!offline);
  }, [offline]);

  useEffect(
    () =>
      useImportQueue.subscribe((s, prev) => {
        if (s.batches === prev.batches) return;
        const finished = Object.entries(s.batches).some(([id, b]) => isDone(b) && !isDone(prev.batches[id]));
        if (finished) invalidate();
      }),
    [invalidate],
  );
}
