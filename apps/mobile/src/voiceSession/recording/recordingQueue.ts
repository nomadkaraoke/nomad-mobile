// The voice-session upload queue (Phase 3d): recorded takes waiting for decide's `POST /api/voice/recordings`,
// persisted in MMKV so they survive an app kill. decide API.md "App upload queue rules": drop on a refusal the server
// will never change its mind about (isTerminalUploadError), keep and back off on 5xx / network errors, and clear the
// queue BEFORE `DELETE /api/voice/recordings`. Only the upload's own fields are stored: never a token.
import {
  deleteVoiceRecordings,
  isTerminalUploadError,
  uploadVoiceRecording,
  type RecordingsDeleted,
  type VoiceRecordingContentType,
} from '@nomad/api-decide';
import { File } from 'expo-file-system';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { create } from 'zustand';

import { appStorage } from '../../storage';
import { deleteFileQuietly } from './files';

export const RECORDING_QUEUE_KEY = 'voiceSession.uploads.v1';

export type QueuedRecording = {
  /** `<sessionId>:<attemptN>`: one upload per attempt. */
  id: string;
  sessionId: string;
  /** decide's attempt number (1-based). */
  attemptN: number;
  /** The local take (`file://`). */
  uri: string;
  contentType: VoiceRecordingContentType;
  durationS: number;
  device: string | null;
  /** Failed attempts so far. */
  tries: number;
  /** Not sent before this time (ms epoch); 0 = now. */
  nextAt: number;
};
export type RecordingUploadInput = Pick<
  QueuedRecording,
  'sessionId' | 'attemptN' | 'uri' | 'contentType' | 'durationS' | 'device'
>;

const BACKOFF_BASE_MS = 30_000;
const BACKOFF_MAX_MS = 6 * 3600_000;

/** Wait after a failed upload that had failed `tries` times before: 30 s × 2^tries, at most 6 h. */
export const uploadBackoffMs = (tries: number): number => Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** tries);

const fileExists = (uri: string) => {
  try {
    return new File(uri).exists;
  } catch {
    return false;
  }
};

/** Only the queue's own fields, so nothing else (a token, say) is ever persisted. */
const toItem = (i: QueuedRecording): QueuedRecording => ({
  id: i.id,
  sessionId: i.sessionId,
  attemptN: i.attemptN,
  uri: i.uri,
  contentType: i.contentType,
  durationS: i.durationS,
  device: i.device,
  tries: i.tries,
  nextAt: i.nextAt,
});

const isItem = (v: unknown): v is QueuedRecording => {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  const num = (x: unknown) => typeof x === 'number' && Number.isFinite(x);
  return (
    typeof o.id === 'string' &&
    typeof o.sessionId === 'string' &&
    Number.isInteger(o.attemptN) &&
    typeof o.uri === 'string' &&
    (o.contentType === 'audio/mp4' || o.contentType === 'audio/wav') &&
    num(o.durationS) &&
    (o.device === null || typeof o.device === 'string') &&
    Number.isInteger(o.tries) &&
    num(o.nextAt)
  );
};

/** The stored queue; anything unreadable is dropped (its files, if any, are orphaned in documents/). */
function loadQueue(): QueuedRecording[] {
  try {
    const raw = appStorage.getString(RECORDING_QUEUE_KEY);
    if (raw === undefined) return [];
    const v = JSON.parse(raw) as { items?: unknown };
    if (Array.isArray(v?.items)) return v.items.filter(isItem).map(toItem);
  } catch {
    // fall through: unreadable
  }
  appStorage.remove(RECORDING_QUEUE_KEY);
  return [];
}

type RecordingQueue = {
  items: QueuedRecording[];
  /** Queues an attempt's take (replacing, and deleting the file of, an earlier take for the same attempt). */
  enqueue(input: RecordingUploadInput): void;
  /**
   * Uploads every due item, one at a time. Call on mount, on foreground and after each attempt. Items whose file is
   * gone are dropped. Concurrent calls share the running flush.
   */
  flush(): Promise<void>;
  /** Consent turned off: drops that session's queued takes and deletes their files. */
  dropSession(sessionId: string): void;
  /** Drops every queued take and deletes the files ("Delete my recordings" runs this first). */
  clearAll(): void;
};

let flushing: Promise<void> | null = null;

const uploadedListeners = new Set<() => void>();
/** Calls `fn` after a flush that uploaded at least one recording (the Me recordings count is then stale). */
export function onRecordingsUploaded(fn: () => void): () => void {
  uploadedListeners.add(fn);
  return () => void uploadedListeners.delete(fn);
}

export const useRecordingQueue = create<RecordingQueue>((set, get) => {
  const save = (items: QueuedRecording[]) => {
    if (items.length) appStorage.set(RECORDING_QUEUE_KEY, JSON.stringify({ items: items.map(toItem) }));
    else appStorage.remove(RECORDING_QUEUE_KEY);
    set({ items });
  };
  /** Applies `fn` to the item if it is still queued (it may have been dropped while its upload was in flight). */
  const update = (id: string, fn: (i: QueuedRecording) => QueuedRecording | null) => {
    const items = get().items;
    const at = items.findIndex((i) => i.id === id);
    if (at < 0) return;
    const next = fn(items[at]!);
    save(next ? items.map((i, k) => (k === at ? next : i)) : items.filter((_, k) => k !== at));
  };
  /** Drops the item only if it is still this take (a newer take for the same attempt stays), and deletes the file. */
  const remove = (id: string, uri: string) => {
    update(id, (i) => (i.uri === uri ? null : i));
    deleteFileQuietly(uri);
  };

  async function run(): Promise<void> {
    const tried = new Set<string>();
    let uploaded = false;
    const done = () => {
      if (uploaded) for (const fn of uploadedListeners) fn();
    };
    for (;;) {
      const now = Date.now();
      const item = get().items.find((i) => !tried.has(i.id) && i.nextAt <= now);
      if (!item) return done();
      tried.add(item.id);
      if (!fileExists(item.uri)) {
        update(item.id, () => null);
        continue;
      }
      try {
        await uploadVoiceRecording({
          sessionId: item.sessionId,
          attemptN: item.attemptN,
          durationS: item.durationS,
          device: item.device,
          // expo/fetch reads the part's bytes() (React Native's { uri } parts fail there before anything is sent).
          file: new File(item.uri),
          contentType: item.contentType,
        });
        uploaded = true;
        remove(item.id, item.uri);
      } catch (e) {
        if (isTerminalUploadError(e)) {
          console.warn(`[voice upload] dropped ${item.id}: ${String(e)}`);
          remove(item.id, item.uri);
        } else {
          // Only if it is still the same take (not dropped or replaced while the upload ran).
          update(item.id, (i) =>
            i.uri === item.uri ? { ...i, tries: i.tries + 1, nextAt: Date.now() + uploadBackoffMs(i.tries) } : i,
          );
        }
      }
    }
  }

  return {
    items: loadQueue(),
    enqueue(input) {
      const id = `${input.sessionId}:${input.attemptN}`;
      const prev = get().items.find((i) => i.id === id);
      if (prev && prev.uri !== input.uri) deleteFileQuietly(prev.uri);
      const item = toItem({ ...input, device: input.device ?? null, id, tries: 0, nextAt: 0 });
      save([...get().items.filter((i) => i.id !== id), item]);
    },
    flush() {
      flushing ??= run().finally(() => {
        flushing = null;
      });
      return flushing;
    },
    dropSession(sessionId) {
      const [gone, kept] = partition(get().items, (i) => i.sessionId === sessionId);
      save(kept);
      for (const i of gone) deleteFileQuietly(i.uri);
    },
    clearAll() {
      const gone = get().items;
      save([]);
      for (const i of gone) deleteFileQuietly(i.uri);
    },
  };
});

function partition<T>(xs: T[], pred: (x: T) => boolean): [T[], T[]] {
  const yes: T[] = [];
  const no: T[] = [];
  for (const x of xs) (pred(x) ? yes : no).push(x);
  return [yes, no];
}

/**
 * "Delete my recordings": clears the queue (files included) BEFORE asking decide to erase everything, so nothing
 * recorded before the delete is uploaded after it (decide API.md).
 */
export async function deleteMyRecordings(): Promise<RecordingsDeleted> {
  useRecordingQueue.getState().clearAll();
  return deleteVoiceRecordings();
}

/** Flushes the queue on mount and whenever the app comes back to the foreground. */
export function useFlushRecordingQueue(): void {
  useEffect(() => {
    void useRecordingQueue.getState().flush();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void useRecordingQueue.getState().flush();
    });
    return () => sub?.remove(); // jest-expo's AppState mock returns no subscription
  }, []);
}
