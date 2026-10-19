// The opt-in offline song list (spec §7.1): download decide's offline.db.gz, verify its sha256, gunzip it,
// check it with SQLite, swap it in, and hand the matcher one SqlReader over it.
import { getOfflineIndexManifest, type OfflineIndexManifest } from '@nomad/api-decide';
import { NORMALIZER_VERSION, OFFLINE_SCHEMA_VERSION, type SqlReader } from '@nomad/core';
import NetInfo from '@react-native-community/netinfo';
import { CryptoDigestAlgorithm, digest } from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { openDatabaseSync, type SQLiteBindValue, type SQLiteDatabase } from 'expo-sqlite';
import { Inflate } from 'pako';
import { useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { useOfflineIndexStore, type OfflineIndexFile } from './offlineIndexStore';

/** A background refresh is due after a week (or sooner when the app's schema/normaliser changed). */
export const REFRESH_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
/** Once a refresh is due, the manifest is fetched at most this often (no new run → nothing to download). */
export const RECHECK_AFTER_MS = 24 * 60 * 60 * 1000;

// The list lives in the cache directory: it can always be downloaded again, so it stays out of iCloud and
// Android backups. If the OS purges it, openOfflineReader() notices and the store goes back to `none`.
const DIR_NAME = 'offline';
const CURRENT = 'current.db';
const PREVIOUS = 'previous.db';
const SQLITE_SIDECARS = ['-journal', '-wal', '-shm'];
/** pako input slice and output chunk: small enough that each slice is a short JS stall. */
const SLICE = 256 << 10;
/** Share of the progress bar the network download takes; the rest is verify + unpack. */
const DOWNLOAD_SHARE = 0.75;

const offlineDir = () => new Directory(Paths.cache, DIR_NAME);
const fileIn = (name: string) => new File(offlineDir(), name);

const isCompatible = (v: { schema: number | null; normalizer: number | null }) =>
  v.schema === OFFLINE_SCHEMA_VERSION && v.normalizer === NORMALIZER_VERSION;

function deleteQuietly(name: string): void {
  for (const suffix of ['', ...SQLITE_SIDECARS]) {
    try {
      const f = fileIn(name + suffix);
      if (f.exists) f.delete();
    } catch {
      // Already gone.
    }
  }
}

// ---------------------------------------------------------------------------------------------------------
// Reader

/** The open connection behind the reader. The matcher caches vocab per reader object, so it is kept per file. */
let opened: { db: SQLiteDatabase; reader: SqlReader } | null = null;
/** A run whose file doesn't match this app's versions: not reopened on every keystroke. */
let rejectedRun: string | null = null;

function closeReader(): void {
  if (!opened) return;
  try {
    opened.db.closeSync();
  } catch {
    // Already closed.
  }
  opened = null;
}

/** Test hook: forget the open reader and the launch check (simulates an app restart). */
export function resetOfflineReaderForTests(): void {
  closeReader();
  rejectedRun = null;
  launchChecked = false;
}

/** A swap interrupted between its two renames leaves only previous.db: put it back. */
function restoreInterruptedSwap(): void {
  const current = fileIn(CURRENT);
  const previous = fileIn(PREVIOUS);
  if (!current.exists && previous.exists) previous.moveSync(current);
}

/**
 * Deletes what a download, unpack or swap the app died in left behind (run-named `.part` files, previous.db,
 * an orphaned current.db). Keeps current.db and its SQLite sidecars while a list is recorded. Never touches the
 * open reader's file, so it is safe at any time no download is running.
 */
function sweepLeftovers(): void {
  try {
    const dir = offlineDir();
    if (!dir.exists) return;
    if (useOfflineIndexStore.getState().run === null) {
      closeReader();
      dir.delete(); // Nothing recorded: everything in it is an orphan.
      return;
    }
    restoreInterruptedSwap();
    for (const entry of dir.list()) {
      if (entry.name === CURRENT || entry.name.startsWith(`${CURRENT}-`)) continue;
      try {
        entry.delete();
      } catch {
        // Already gone.
      }
    }
  } catch {
    // Best effort: the next launch tries again.
  }
}

let launchChecked = false;

/**
 * Once per launch, on first use (the Me/offline UI mounting, or the background refresh): sweep leftovers, and
 * reconcile the store with the disk (an OS cache purge deletes the file; a list for other versions is unusable).
 */
function checkOnLaunch(): void {
  if (launchChecked || inFlight) return;
  launchChecked = true;
  sweepLeftovers();
  const s = useOfflineIndexStore.getState();
  if (s.run === null) return;
  if (!fileIn(CURRENT).exists) s.cleared();
  else if (s.run === rejectedRun) s.unusable();
}

type Verdict = 'ok' | 'corrupt' | 'incompatible';

/** PRAGMA quick_check, then the file's own schema and normaliser versions. */
function checkDatabase(db: SQLiteDatabase): Verdict {
  const check = db.getFirstSync<Record<string, unknown>>('PRAGMA quick_check', []);
  if (!check || Object.values(check)[0] !== 'ok') return 'corrupt';
  const meta = new Map(
    db
      .getAllSync<{ key: string; value: string }>(
        "SELECT key, value FROM meta WHERE key IN ('offline_schema_version', 'normalizer_version')",
        [],
      )
      .map((r) => [r.key, Number(r.value)]),
  );
  return isCompatible({ schema: meta.get('offline_schema_version') ?? null, normalizer: meta.get('normalizer_version') ?? null })
    ? 'ok'
    : 'incompatible';
}

/**
 * expo-sqlite 57's close finalizes every statement on the connection, FTS5's internal ones included, and FTS5
 * then finalizes them again: SIGSEGV on closeSync() (seen on the iOS simulator). getAllSync/getFirstSync
 * finalize their own statements, so skipping that sweep leaks nothing. expo-sqlite is pinned exactly in
 * package.json because this option is @hidden: re-check it (and the crash) before upgrading.
 */
const OPEN_OPTIONS = { useNewConnection: true, finalizeUnusedStatementsBeforeClosing: false } as const;

function verdictOf(name: string): { verdict: Verdict; db: SQLiteDatabase | null } {
  let db: SQLiteDatabase | null = null;
  try {
    db = openDatabaseSync(name, OPEN_OPTIONS, offlineDir().uri);
    return { verdict: checkDatabase(db), db };
  } catch {
    try {
      db?.closeSync();
    } catch {
      // Never opened.
    }
    return { verdict: 'corrupt', db: null };
  }
}

/**
 * The reader over the downloaded list, or null when there is none, or it is missing, corrupt or built for
 * other versions (search then uses the cloud only). The same object is returned until the file is swapped
 * or removed. A corrupt or vanished file is forgotten so the app offers the download again.
 */
export function openOfflineReader(): SqlReader | null {
  if (opened) return opened.reader;
  const { run } = useOfflineIndexStore.getState();
  if (run === null || run === rejectedRun) return null;
  restoreInterruptedSwap();
  if (!fileIn(CURRENT).exists) {
    useOfflineIndexStore.getState().cleared();
    return null;
  }
  const { verdict, db } = verdictOf(CURRENT);
  if (verdict !== 'ok' || !db) {
    try {
      db?.closeSync();
    } catch {
      // Already closed.
    }
    if (verdict === 'incompatible') {
      rejectedRun = run; // Kept: maybeRefreshOfflineIndex() replaces it.
      useOfflineIndexStore.getState().unusable();
    } else {
      deleteQuietly(CURRENT);
      useOfflineIndexStore.getState().cleared();
    }
    return null;
  }
  const reader: SqlReader = { all: <T,>(sql: string, params: unknown[] = []) => db.getAllSync<T>(sql, params as SQLiteBindValue[]) };
  opened = { db, reader };
  return reader;
}

// ---------------------------------------------------------------------------------------------------------
// Download

let inFlight: Promise<void> | null = null;
let abort: AbortController | null = null;

const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

class Cancelled extends Error {}

const toHex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');

/**
 * Checks the .gz's sha256 (native: a pure-JS hash ran at ~1 MB/s under Hermes), then gunzips it into `dest`
 * in chunks, yielding to the UI between them.
 */
async function verifyAndUnpack(
  src: File,
  dest: File,
  expectedSha256: string,
  signal: AbortSignal,
  onProgress: (fraction: number) => void,
): Promise<void> {
  const compressed = await src.bytes();
  if (toHex(await digest(CryptoDigestAlgorithm.SHA256, compressed)) !== expectedSha256.toLowerCase()) {
    throw new Error('sha256 mismatch');
  }
  dest.create({ overwrite: true });
  const output = dest.open();
  try {
    const inflate = new Inflate({ chunkSize: SLICE });
    inflate.onData = (chunk) => output.writeBytes(chunk);
    const total = compressed.length;
    for (let read = 0; read < total; ) {
      const next = Math.min(total, read + SLICE);
      inflate.push(compressed.subarray(read, next), next >= total);
      read = next;
      if (inflate.err) throw new Error(`gunzip: ${inflate.msg}`);
      onProgress(read / total);
      await yieldToUi();
      if (signal.aborted) throw new Cancelled();
    }
    // A stream cut off mid-way never reaches its end (pako also checks the gzip CRC and length).
    if (!inflate.ended || inflate.err) throw new Error('gunzip: truncated');
  } finally {
    output.close();
  }
}

/** Closes the old reader, renames the old file aside, renames the new one in, then deletes the old one. */
function swapIn(candidate: File): void {
  closeReader();
  rejectedRun = null;
  restoreInterruptedSwap(); // Never delete previous.db while it is the only copy.
  deleteQuietly(PREVIOUS);
  const current = fileIn(CURRENT);
  if (current.exists) current.moveSync(fileIn(PREVIOUS));
  deleteQuietly(CURRENT); // current.db itself is aside now: this clears stale -journal/-wal/-shm files.
  candidate.moveSync(fileIn(CURRENT));
  deleteQuietly(PREVIOUS);
}

async function runDownload(given: OfflineIndexManifest | undefined, signal: AbortSignal): Promise<void> {
  const store = useOfflineIndexStore.getState();
  launchChecked = true;
  sweepLeftovers(); // Single-flight: no other download's parts can be in use.
  store.started();
  let partNames: string[] = [];
  try {
    const m = given ?? (await getOfflineIndexManifest());
    if (!isCompatible(m)) {
      // A newer schema than this app reads: no download. Keep an earlier list only if this app can read it.
      if (!isCompatible(useOfflineIndexStore.getState())) {
        closeReader();
        deleteQuietly(CURRENT);
        useOfflineIndexStore.getState().cleared();
      } else {
        useOfflineIndexStore.getState().settled();
      }
      return;
    }
    // Run ids come from the server: keep them to one safe path segment.
    const base = m.run.replace(/[^\w.-]/g, '_');
    const gzName = `${base}.db.gz.part`;
    const dbName = `${base}.db.part`;
    partNames = [gzName, dbName];
    const dir = offlineDir();
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });

    const gz = fileIn(gzName);
    await File.downloadFileAsync(m.url, gz, {
      idempotent: true,
      signal,
      onProgress: ({ bytesWritten, totalBytes }) => {
        const total = totalBytes > 0 ? totalBytes : m.bytes;
        if (total > 0) store.setProgress(DOWNLOAD_SHARE * Math.min(1, bytesWritten / total));
      },
    });
    if (signal.aborted) throw new Cancelled();
    if (gz.size !== m.bytes) throw new Error(`size ${gz.size} != ${m.bytes}`);

    const candidate = fileIn(dbName);
    await verifyAndUnpack(gz, candidate, m.sha256, signal, (f) =>
      store.setProgress(DOWNLOAD_SHARE + (1 - DOWNLOAD_SHARE) * f),
    );
    const { verdict, db } = verdictOf(dbName);
    db?.closeSync();
    if (verdict !== 'ok') throw new Error(`offline index check: ${verdict}`);
    if (signal.aborted) throw new Cancelled();

    swapIn(candidate);
    const file: OfflineIndexFile = {
      run: m.run,
      bytes: fileIn(CURRENT).size,
      downloadedAt: Date.now(),
      schema: m.schema,
      normalizer: m.normalizer,
    };
    useOfflineIndexStore.getState().downloaded(file);
  } catch (e) {
    if (e instanceof Cancelled || signal.aborted) useOfflineIndexStore.getState().settled();
    else useOfflineIndexStore.getState().failed();
  } finally {
    for (const name of partNames) deleteQuietly(name);
  }
}

/**
 * Downloads the current offline list and swaps it in. Never throws: the outcome is in the store
 * (`ready`, or `error` with any earlier list kept). Concurrent calls share one download.
 */
export function downloadOfflineIndex(manifest?: OfflineIndexManifest): Promise<void> {
  if (inFlight) return inFlight;
  const controller = new AbortController();
  abort = controller;
  inFlight = runDownload(manifest, controller.signal).finally(() => {
    inFlight = null;
    abort = null;
  });
  return inFlight;
}

/** Deletes the list (cancelling a download in progress) and resets the store. */
export async function removeOfflineIndex(): Promise<void> {
  abort?.abort();
  if (inFlight) await inFlight;
  closeReader();
  rejectedRun = null;
  try {
    const dir = offlineDir();
    if (dir.exists) dir.delete();
  } catch {
    // Nothing to delete.
  }
  useOfflineIndexStore.getState().cleared();
}

async function isUnmetered(): Promise<boolean> {
  try {
    const net = await NetInfo.fetch();
    if (net.isConnected !== true || !net.details || !('isConnectionExpensive' in net.details)) return false;
    return net.details.isConnectionExpensive === false;
  } catch {
    return false;
  }
}

/**
 * Background refresh of a list the user already downloaded: at most weekly, sooner when this app's schema or
 * normaliser differs from the file's, and only on an unmetered connection. Never makes the first download.
 */
export async function maybeRefreshOfflineIndex(now = Date.now()): Promise<void> {
  checkOnLaunch();
  const s = useOfflineIndexStore.getState();
  if (s.run === null || s.status === 'downloading') return;
  const usable = isCompatible(s) && s.run !== rejectedRun;
  const recent = s.downloadedAt !== null && now - s.downloadedAt < REFRESH_AFTER_MS;
  if (recent && usable) return;
  const checkedRecently = s.checkedAt !== null && now - s.checkedAt < RECHECK_AFTER_MS;
  if (checkedRecently && usable) return;
  if (!(await isUnmetered())) return;
  let manifest: OfflineIndexManifest;
  try {
    manifest = await getOfflineIndexManifest();
  } catch {
    return; // Try again next time.
  }
  useOfflineIndexStore.getState().checked(now);
  if (manifest.run === s.run && usable) return;
  await downloadOfflineIndex(manifest);
}

/** The offline list for UI: state plus the two actions. The first mount per launch runs the launch check. */
export function useOfflineIndex() {
  useEffect(checkOnLaunch, []);
  const state = useOfflineIndexStore(
    useShallow((s) => ({ status: s.status, downloadedAt: s.downloadedAt, bytes: s.bytes, progress: s.progress })),
  );
  return { ...state, download: () => downloadOfflineIndex(), remove: removeOfflineIndex };
}
