import { ApiError, uploadExportChunk, type ExportImportResponse } from '@nomad/api-decide';
import type { ExportUploadChunk } from '@nomad/core';
import { Directory, File, Paths } from 'expo-file-system';
import { useEffect } from 'react';
import { create } from 'zustand';

import { useAuth } from '../../auth/store';
import { useOffline } from '../../net/useOffline';
import { appStorage } from '../../storage';
import { userKeyFor } from '../../tonight/nightStore';
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
 * `Retry-After`. Any other 4xx is final: the chunk is dropped and `lastError` set.
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
  artistsAdded: number;
  songsAdded: number;
}

/** The last chunk the queue gave up on (`status: null` = its payload file was missing). Feed it to importErrorKey. */
export interface ImportQueueError {
  batch: string;
  label: ImportLabel;
  status: number | null;
  detail: unknown;
  at: number;
}

const KEY = 'connect.importQueue';
const DIR = 'imports';

export const RETRY_DELAYS_MS = [5_000, 15_000, 30_000, 60_000] as const;

/** Delay before retry number `attempts` (1-based): the server's Retry-After (seconds) when it sent one. */
export function retryDelayMs(attempts: number, retryAfter: number | null): number {
  if (retryAfter !== null) return retryAfter * 1000;
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
    const batches = v.batches && typeof v.batches === 'object' ? v.batches : {};
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
          ...get().batches,
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
        artistsAdded: b.artistsAdded + r.artists_added,
        songsAdded: b.songsAdded + r.songs_added,
      })),
    });
  } else {
    console.warn(`[import-queue] dropped ${item.label} chunk ${item.id}: ${outcome.error.status} ${String(outcome.error.detail)}`);
    save({
      pending,
      batches: patchBatch(item.batch, (b) => ({ failed: b.failed + 1 })),
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
    if (!online || !owner) return;
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
      finish(head, { error: { batch: head.batch, label: head.label, status: null, detail: String(e), at: Date.now() } });
      continue;
    }
    try {
      const res = await uploadExportChunk(chunk);
      finish(head, { ok: res });
    } catch (e) {
      if (isRetryable(e)) {
        wakeAt(retryLater(head, e));
        return;
      }
      const err = e as ApiError;
      finish(head, { error: { batch: head.batch, label: head.label, status: err.status, detail: err.detail, at: Date.now() } });
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

const isDone = (b: ImportBatch | undefined) => !!b && b.sent + b.failed >= b.chunks;

// Signing in (or switching account) may unblock that account's uploads.
useAuth.subscribe((s, prev) => {
  if (s.state !== prev.state && s.state.status === 'signedIn') kick();
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
