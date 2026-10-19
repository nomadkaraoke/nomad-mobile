import { NORMALIZER_VERSION, OFFLINE_SCHEMA_VERSION } from '@nomad/core';
import { create } from 'zustand';

import { appStorage } from '../storage';

/**
 * `none`: no usable offline song list. `downloading`: a download, check or swap is running (`progress` 0–1).
 * `ready`: a list is on the phone. `error`: the last download failed; any earlier list is still in place
 * (its `run`/`downloadedAt` stay set).
 *
 * `none` with `run` set means a list the user opted into is on disk but unusable (built for other versions):
 * the background refresh replaces it.
 */
export type OfflineIndexStatus = 'none' | 'downloading' | 'ready' | 'error';

/** The list on the phone (`offline/current.db`): the build it came from and its size on disk. */
export type OfflineIndexFile = {
  run: string;
  /** Size of the unpacked database on disk. */
  bytes: number;
  downloadedAt: number;
  /** The manifest's offline schema and normaliser versions (a refresh is due when the app's differ). */
  schema: number;
  normalizer: number;
};

type Nullable<T> = { [K in keyof T]: T[K] | null };

export type OfflineIndexState = Nullable<OfflineIndexFile> & {
  status: OfflineIndexStatus;
  progress: number | null;
  /** When the background refresh last fetched the manifest (it checks at most daily). */
  checkedAt: number | null;
  started(): void;
  setProgress(fraction: number): void;
  /** A new list was swapped in. */
  downloaded(file: OfflineIndexFile): void;
  failed(): void;
  /** Back to `ready` or `none` without a change (an incompatible or cancelled download). */
  settled(): void;
  /** The list on disk can't be used by this app (kept for the refresh to replace). */
  unusable(): void;
  /** The background refresh fetched the manifest. */
  checked(at: number): void;
  /** The list is gone (removed, purged or corrupt). */
  cleared(): void;
};

// Only the file's description (+ checkedAt) is persisted: a download in flight when the app dies is simply not
// finished.
const KEY = 'offline.index.v1';
type Persisted = Nullable<OfflineIndexFile> & { checkedAt: number | null };
const EMPTY: Persisted = { run: null, bytes: null, downloadedAt: null, schema: null, normalizer: null, checkedAt: null };

function load(): Persisted {
  try {
    const raw = appStorage.getString(KEY);
    if (raw) {
      const v = JSON.parse(raw) as (Partial<OfflineIndexFile> & { checkedAt?: unknown }) | null;
      if (
        v &&
        typeof v.run === 'string' &&
        typeof v.bytes === 'number' &&
        typeof v.downloadedAt === 'number' &&
        typeof v.schema === 'number' &&
        typeof v.normalizer === 'number'
      ) {
        return {
          run: v.run,
          bytes: v.bytes,
          downloadedAt: v.downloadedAt,
          schema: v.schema,
          normalizer: v.normalizer,
          checkedAt: typeof v.checkedAt === 'number' ? v.checkedAt : null,
        };
      }
    }
  } catch {
    // Corrupt: treated as no list.
  }
  appStorage.remove(KEY);
  return EMPTY;
}

const persisted = (s: Persisted): Persisted => ({
  run: s.run,
  bytes: s.bytes,
  downloadedAt: s.downloadedAt,
  schema: s.schema,
  normalizer: s.normalizer,
  checkedAt: s.checkedAt,
});

/** `ready` only for a list built for this app's offline schema and normaliser. */
const restingStatus = (s: Persisted): OfflineIndexStatus =>
  s.run !== null && s.schema === OFFLINE_SCHEMA_VERSION && s.normalizer === NORMALIZER_VERSION ? 'ready' : 'none';

const initial = load();

export const useOfflineIndexStore = create<OfflineIndexState>((set, get) => ({
  ...initial,
  status: restingStatus(initial),
  progress: null,

  started: () => set({ status: 'downloading', progress: 0 }),
  setProgress: (fraction) => set({ progress: Math.max(0, Math.min(1, fraction)) }),
  downloaded(file) {
    const next = { ...file, checkedAt: get().checkedAt };
    appStorage.set(KEY, JSON.stringify(next));
    set({ ...next, status: 'ready', progress: null });
  },
  failed: () => set({ status: 'error', progress: null }),
  settled: () => set({ status: restingStatus(get()), progress: null }),
  unusable: () => set({ status: 'none', progress: null }),
  checked(at) {
    if (get().run === null) return;
    const next = { ...persisted(get()), checkedAt: at };
    appStorage.set(KEY, JSON.stringify(next));
    set({ checkedAt: at });
  },
  cleared() {
    appStorage.remove(KEY);
    set({ ...EMPTY, status: 'none', progress: null });
  },
}));
