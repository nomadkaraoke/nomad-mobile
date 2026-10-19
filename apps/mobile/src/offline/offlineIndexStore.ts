import { create } from 'zustand';

import { appStorage } from '../storage';

/**
 * `none`: no offline song list. `downloading`: a download, check or swap is running (`progress` 0–1).
 * `ready`: a list is on the phone. `error`: the last download failed; any earlier list is still in place
 * (its `run`/`downloadedAt` stay set).
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
  started(): void;
  setProgress(fraction: number): void;
  /** A new list was swapped in. */
  downloaded(file: OfflineIndexFile): void;
  failed(): void;
  /** Back to `ready` or `none` without a change (an incompatible or cancelled download). */
  settled(): void;
  /** The list is gone (removed, purged or corrupt). */
  cleared(): void;
};

// Only the file's description is persisted: a download in flight when the app dies is simply not finished.
const KEY = 'offline.index.v1';
const EMPTY: Nullable<OfflineIndexFile> = { run: null, bytes: null, downloadedAt: null, schema: null, normalizer: null };

function load(): Nullable<OfflineIndexFile> {
  try {
    const raw = appStorage.getString(KEY);
    if (raw) {
      const v = JSON.parse(raw) as Partial<OfflineIndexFile> | null;
      if (
        v &&
        typeof v.run === 'string' &&
        typeof v.bytes === 'number' &&
        typeof v.downloadedAt === 'number' &&
        typeof v.schema === 'number' &&
        typeof v.normalizer === 'number'
      ) {
        return { run: v.run, bytes: v.bytes, downloadedAt: v.downloadedAt, schema: v.schema, normalizer: v.normalizer };
      }
    }
  } catch {
    // Corrupt: treated as no list.
  }
  appStorage.remove(KEY);
  return EMPTY;
}

const initial = load();

export const useOfflineIndexStore = create<OfflineIndexState>((set, get) => ({
  ...initial,
  status: initial.run ? 'ready' : 'none',
  progress: null,

  started: () => set({ status: 'downloading', progress: 0 }),
  setProgress: (fraction) => set({ progress: Math.max(0, Math.min(1, fraction)) }),
  downloaded(file) {
    appStorage.set(KEY, JSON.stringify(file));
    set({ ...file, status: 'ready', progress: null });
  },
  failed: () => set({ status: 'error', progress: null }),
  settled: () => set({ status: get().run ? 'ready' : 'none', progress: null }),
  cleared() {
    appStorage.remove(KEY);
    set({ ...EMPTY, status: 'none', progress: null });
  },
}));
