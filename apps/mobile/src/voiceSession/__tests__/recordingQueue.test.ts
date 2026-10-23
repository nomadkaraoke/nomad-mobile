import { ApiError } from '@nomad/api-decide';
import { renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import { appStorage } from '../../storage';
import { fsState } from '../../test-utils/memoryFs';
import {
  deleteMyRecordings,
  RECORDING_QUEUE_KEY,
  uploadBackoffMs,
  useFlushRecordingQueue,
  useRecordingQueue,
  type RecordingUploadInput,
} from '../recording/recordingQueue';

// One file system and one api mock shared with the "relaunched" module copies below (isolateModules gives them a
// fresh registry, which would otherwise build a second, empty memory fs).
jest.mock('expo-file-system', () => {
  const g = globalThis as { __vsFs?: unknown };
  return (g.__vsFs ??= jest.requireActual('../../test-utils/memoryFs'));
});
const mockUpload = jest.fn();
const mockDelete = jest.fn();
jest.mock('@nomad/api-decide', () => ({
  ...jest.requireActual('@nomad/api-decide'),
  uploadVoiceRecording: (...a: unknown[]) => mockUpload(...a),
  deleteVoiceRecordings: (...a: unknown[]) => mockDelete(...a),
}));

const T0 = 1_800_000_000_000;
const DIR = 'file:///document/voice-recordings';

/** A recorded take on disk and its queue input. */
const take = (sessionId: string, attemptN: number, over: Partial<RecordingUploadInput> = {}): RecordingUploadInput => {
  const uri = `${DIR}/${sessionId}-${attemptN}.m4a`;
  fsState.files.set(uri, new Uint8Array(100));
  return { sessionId, attemptN, uri, contentType: 'audio/mp4', durationS: 180, device: 'iPad15,7', ...over };
};

const relaunch = () => {
  let mod!: typeof import('../recording/recordingQueue');
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require('../recording/recordingQueue');
  });
  return mod.useRecordingQueue;
};

const q = () => useRecordingQueue.getState();
const network = () => new TypeError('Network request failed');

beforeEach(() => {
  jest.useFakeTimers({ now: T0 });
  mockUpload.mockReset().mockResolvedValue({ recording_id: 'r1' });
  mockDelete.mockReset().mockResolvedValue({ deleted: 0 });
  q().clearAll();
  fsState.reset();
  appStorage.remove(RECORDING_QUEUE_KEY);
});
afterEach(() => jest.useRealTimers());

describe('recordingQueue', () => {
  it('backoff is 30 s × 2^tries, capped at 6 h', () => {
    expect(uploadBackoffMs(0)).toBe(30_000);
    expect(uploadBackoffMs(1)).toBe(60_000);
    expect(uploadBackoffMs(5)).toBe(960_000);
    expect(uploadBackoffMs(20)).toBe(6 * 3600_000);
  });

  it('uploads a queued take, then deletes the file and the item', async () => {
    const t = take('s1', 1);
    q().enqueue(t);
    await q().flush();
    expect(mockUpload).toHaveBeenCalledWith({
      sessionId: 's1',
      attemptN: 1,
      durationS: 180,
      device: 'iPad15,7',
      fileUri: t.uri,
      contentType: 'audio/mp4',
    });
    expect(q().items).toEqual([]);
    expect(fsState.files.has(t.uri)).toBe(false);
    expect(appStorage.getString(RECORDING_QUEUE_KEY)).toBeUndefined();
  });

  it('queue survives restart and retries', async () => {
    const t = take('s1', 2);
    mockUpload.mockRejectedValueOnce(network());
    q().enqueue(t);
    await q().flush();
    expect(q().items).toEqual([
      expect.objectContaining({ sessionId: 's1', attemptN: 2, tries: 1, nextAt: T0 + 30_000, uri: t.uri }),
    ]);
    expect(fsState.files.has(t.uri)).toBe(true);

    // The app is killed and relaunched: the queue comes back from MMKV.
    const after = relaunch();
    expect(after.getState().items).toEqual(q().items);
    // Not due yet: nothing is sent.
    await after.getState().flush();
    expect(mockUpload).toHaveBeenCalledTimes(1);
    // A 5xx is kept too, with a longer wait.
    jest.setSystemTime(T0 + 30_000);
    mockUpload.mockRejectedValueOnce(new ApiError(503, 'unavailable'));
    await after.getState().flush();
    expect(after.getState().items[0]).toEqual(expect.objectContaining({ tries: 2, nextAt: T0 + 30_000 + 60_000 }));
    jest.setSystemTime(T0 + 90_000);
    await after.getState().flush();
    expect(mockUpload).toHaveBeenCalledTimes(3);
    expect(after.getState().items).toEqual([]);
    expect(fsState.files.has(t.uri)).toBe(false);
  });

  it.each([
    ['403 recording_not_consented', new ApiError(403, 'recording_not_consented')],
    ['409 recordings_deleted', new ApiError(409, 'recordings_deleted')],
    ['404 attempt_not_found', new ApiError(404, 'attempt_not_found')],
    ['413 recording_too_large', new ApiError(413, 'recording_too_large')],
  ])('a terminal %s drops the item and deletes its file', async (_name, err) => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const t = take('s1', 1);
    mockUpload.mockRejectedValueOnce(err);
    q().enqueue(t);
    await q().flush();
    expect(q().items).toEqual([]);
    expect(fsState.files.has(t.uri)).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('dropped s1:1'));
    warn.mockRestore();
  });

  it('a 401 is kept for a later retry', async () => {
    const t = take('s1', 1);
    mockUpload.mockRejectedValueOnce(new ApiError(401, 'unauthorized'));
    q().enqueue(t);
    await q().flush();
    expect(q().items).toHaveLength(1);
    expect(fsState.files.has(t.uri)).toBe(true);
  });

  it('drops an item whose file is gone without uploading it', async () => {
    const t = take('s1', 1);
    q().enqueue(t);
    fsState.files.delete(t.uri);
    await q().flush();
    expect(mockUpload).not.toHaveBeenCalled();
    expect(q().items).toEqual([]);
  });

  it('one failing item does not hold back the others', async () => {
    const a = take('s1', 1);
    const b = take('s1', 2);
    mockUpload.mockRejectedValueOnce(network());
    q().enqueue(a);
    q().enqueue(b);
    await q().flush();
    expect(mockUpload).toHaveBeenCalledTimes(2);
    expect(q().items.map((i) => i.attemptN)).toEqual([1]);
  });

  it('re-enqueueing the same attempt replaces it (and its old file)', async () => {
    const a = take('s1', 1);
    const b = take('s1', 1, { uri: `${DIR}/s1-1-again.m4a` });
    fsState.files.set(b.uri, new Uint8Array(5));
    q().enqueue(a);
    q().enqueue(b);
    expect(q().items).toHaveLength(1);
    expect(q().items[0]!.uri).toBe(b.uri);
    expect(fsState.files.has(a.uri)).toBe(false);
  });

  it.each([
    ['succeeds', (r: { ok: (v: unknown) => void }) => r.ok({ recording_id: 'old' })],
    ['is refused for good', (r: { fail: (e: unknown) => void }) => r.fail(new ApiError(404, 'attempt_not_found'))],
  ])('an old take whose upload %s after a newer take was queued for the same attempt leaves the newer one', async (_n, settle) => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const a = take('s1', 1);
    const ctl = {} as { ok: (v: unknown) => void; fail: (e: unknown) => void };
    mockUpload.mockImplementationOnce(() => new Promise((ok, fail) => Object.assign(ctl, { ok, fail })));
    q().enqueue(a);
    const running = q().flush();
    await Promise.resolve();
    const b = take('s1', 1, { uri: `${DIR}/s1-1-newer.m4a` });
    fsState.files.set(b.uri, new Uint8Array(7));
    q().enqueue(b);
    (settle as (r: typeof ctl) => void)(ctl);
    await running;
    expect(q().items).toEqual([expect.objectContaining({ id: 's1:1', uri: b.uri, tries: 0 })]);
    expect(fsState.files.has(b.uri)).toBe(true);
    expect(fsState.files.has(a.uri)).toBe(false);
    warn.mockRestore();
  });

  it('concurrent flushes share one run (no double upload)', async () => {
    q().enqueue(take('s1', 1));
    await Promise.all([q().flush(), q().flush()]);
    expect(mockUpload).toHaveBeenCalledTimes(1);
  });

  it('consent off drops queued: dropSession deletes that session\'s files and items only', () => {
    const a = take('s1', 1);
    const b = take('s1', 2);
    const c = take('s2', 1);
    q().enqueue(a);
    q().enqueue(b);
    q().enqueue(c);
    q().dropSession('s1');
    expect(q().items.map((i) => i.sessionId)).toEqual(['s2']);
    expect(fsState.files.has(a.uri)).toBe(false);
    expect(fsState.files.has(b.uri)).toBe(false);
    expect(fsState.files.has(c.uri)).toBe(true);
    expect(relaunch().getState().items.map((i) => i.sessionId)).toEqual(['s2']);
  });

  it('an item dropped while its upload is in flight is not put back', async () => {
    const t = take('s1', 1);
    let fail!: (e: unknown) => void;
    mockUpload.mockImplementationOnce(() => new Promise((_r, rej) => (fail = rej)));
    q().enqueue(t);
    const running = q().flush();
    await Promise.resolve();
    q().dropSession('s1');
    fail(network());
    await running;
    expect(q().items).toEqual([]);
  });

  it('clearAll deletes every file and item', () => {
    const a = take('s1', 1);
    const c = take('s2', 1);
    q().enqueue(a);
    q().enqueue(c);
    q().clearAll();
    expect(q().items).toEqual([]);
    expect(fsState.files.size).toBe(0);
    expect(appStorage.getString(RECORDING_QUEUE_KEY)).toBeUndefined();
  });

  it('delete clears queue first: clearAll runs before deleteVoiceRecordings', async () => {
    const order: string[] = [];
    const t = take('s1', 1);
    q().enqueue(t);
    const realClearAll = q().clearAll;
    useRecordingQueue.setState({
      clearAll: () => {
        order.push('clearAll');
        realClearAll();
      },
    });
    mockDelete.mockImplementationOnce(async () => {
      order.push('deleteVoiceRecordings');
      // Nothing recorded before the delete may still be queued when decide is called.
      expect(q().items).toEqual([]);
      expect(fsState.files.has(t.uri)).toBe(false);
      return { deleted: 3 };
    });
    await expect(deleteMyRecordings()).resolves.toEqual({ deleted: 3 });
    expect(order).toEqual(['clearAll', 'deleteVoiceRecordings']);
    useRecordingQueue.setState({ clearAll: realClearAll });
  });

  it('a failing delete call still leaves the queue cleared (and rethrows)', async () => {
    const t = take('s1', 1);
    q().enqueue(t);
    mockDelete.mockRejectedValueOnce(network());
    await expect(deleteMyRecordings()).rejects.toThrow('Network request failed');
    expect(q().items).toEqual([]);
  });

  it('stores only the upload fields (no token or other keys) and ignores unreadable storage', () => {
    q().enqueue({ ...take('s1', 1), token: 'secret' } as RecordingUploadInput);
    const raw = JSON.parse(appStorage.getString(RECORDING_QUEUE_KEY)!) as { items: Record<string, unknown>[] };
    expect(Object.keys(raw.items[0]!).sort()).toEqual(
      ['attemptN', 'contentType', 'device', 'durationS', 'id', 'nextAt', 'sessionId', 'tries', 'uri'].sort(),
    );
    appStorage.set(RECORDING_QUEUE_KEY, '{not json');
    expect(relaunch().getState().items).toEqual([]);
    appStorage.set(RECORDING_QUEUE_KEY, JSON.stringify({ items: [{ id: 'x', uri: 5 }] }));
    expect(relaunch().getState().items).toEqual([]);
  });

  it('useFlushRecordingQueue flushes on mount and when the app returns to the foreground', async () => {
    let listener!: (s: AppStateStatus) => void;
    const remove = jest.fn();
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, l) => {
      listener = l as (s: AppStateStatus) => void;
      return { remove };
    });
    const flush = jest.fn(async () => {});
    useRecordingQueue.setState({ flush });
    const { unmount } = renderHook(() => useFlushRecordingQueue());
    expect(flush).toHaveBeenCalledTimes(1);
    listener('background');
    expect(flush).toHaveBeenCalledTimes(1);
    listener('active');
    expect(flush).toHaveBeenCalledTimes(2);
    unmount();
    expect(remove).toHaveBeenCalled();
    useRecordingQueue.setState({ flush: useRecordingQueue.getInitialState().flush });
  });
});
