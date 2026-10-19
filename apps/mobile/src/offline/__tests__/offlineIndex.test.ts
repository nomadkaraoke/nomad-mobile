import { getOfflineIndexManifest, type OfflineIndexManifest } from '@nomad/api-decide';
import NetInfo from '@react-native-community/netinfo';
import { act, renderHook } from '@testing-library/react-native';
import { gzip } from 'pako';

import { dbJson, File, fsState, openDatabaseSync } from '../../test-utils/memoryFs';
import {
  downloadOfflineIndex,
  maybeRefreshOfflineIndex,
  openOfflineReader,
  REFRESH_AFTER_MS,
  removeOfflineIndex,
  resetOfflineReaderForTests,
  useOfflineIndex,
} from '../offlineIndex';
import { useOfflineIndexStore } from '../offlineIndexStore';

/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories can't use imports */
jest.mock('expo-file-system', () => require('../../test-utils/memoryFs'));
jest.mock('expo-sqlite', () => ({ openDatabaseSync: require('../../test-utils/memoryFs').openDatabaseSync }));
// Native SHA-256 stand-in: Node's crypto.
jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digest: jest.fn(async (_alg: string, data: Uint8Array) => {
    const h: Uint8Array = require('crypto').createHash('sha256').update(data).digest();
    return h.buffer.slice(h.byteOffset, h.byteOffset + h.length);
  }),
}));
/* eslint-enable @typescript-eslint/no-require-imports */
jest.mock('@react-native-community/netinfo', () => ({ __esModule: true, default: { fetch: jest.fn() } }));
jest.mock('@nomad/api-decide', () => ({ getOfflineIndexManifest: jest.fn() }));

const manifestMock = getOfflineIndexManifest as jest.MockedFunction<typeof getOfflineIndexManifest>;
const netMock = NetInfo.fetch as jest.Mock;

const DIR = 'file:///cache/offline';
const CURRENT = `${DIR}/current.db`;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createHash } = require('crypto') as {
  createHash(alg: 'sha256'): { update(b: Uint8Array): { digest(enc: 'hex'): string } };
};
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const text = (uri: string) => new TextDecoder().decode(fsState.files.get(uri));
const partFiles = () => [...fsState.files.keys()].filter((k) => k.endsWith('.part'));

/** Publishes `body` (default: a gzipped valid offline.db for `run`) and returns its manifest. */
function publish(run: string, over: Partial<OfflineIndexManifest> = {}, body?: Uint8Array): OfflineIndexManifest {
  const gz = body ?? gzip(new TextEncoder().encode(dbJson(run)));
  const url = `https://decide.example/offline-index/${run}/offline.db.gz`;
  fsState.remote.set(url, gz);
  return { run, schema: 1, normalizer: 3, url, bytes: gz.length, sha256: sha(gz), ...over };
}

async function install(run: string) {
  manifestMock.mockResolvedValueOnce(publish(run));
  await downloadOfflineIndex();
  expect(useOfflineIndexStore.getState().status).toBe('ready');
}

const wifi = { isConnected: true, type: 'wifi', details: { isConnectionExpensive: false } };
const cellular = { isConnected: true, type: 'cellular', details: { isConnectionExpensive: true } };

beforeEach(() => {
  fsState.reset();
  jest.clearAllMocks();
  resetOfflineReaderForTests();
  useOfflineIndexStore.getState().cleared();
});

describe('downloadOfflineIndex', () => {
  it('downloads to <run>.db.gz.part, gunzips to <run>.db.part, verifies, then swaps in current.db', async () => {
    const m = publish('20261018-abc');
    manifestMock.mockResolvedValueOnce(m);
    const before = Date.now();

    await downloadOfflineIndex();

    expect(File.downloadFileAsync).toHaveBeenCalledWith(
      m.url,
      expect.objectContaining({ uri: `${DIR}/20261018-abc.db.gz.part` }),
      expect.objectContaining({ idempotent: true }),
    );
    expect(fsState.log).toEqual(
      expect.arrayContaining([
        `create ${DIR}/20261018-abc.db.part`,
        `move ${DIR}/20261018-abc.db.part -> ${CURRENT}`,
      ]),
    );
    expect(text(CURRENT)).toBe(dbJson('20261018-abc'));
    expect(partFiles()).toEqual([]);
    const s = useOfflineIndexStore.getState();
    expect(s).toMatchObject({ status: 'ready', run: '20261018-abc', schema: 1, normalizer: 3, progress: null });
    expect(s.bytes).toBe(dbJson('20261018-abc').length);
    expect(s.downloadedAt).toBeGreaterThanOrEqual(before);
    expect(openOfflineReader()?.all('SELECT run FROM x')).toEqual([{ run: '20261018-abc' }]);
  });

  it('reports progress while downloading', async () => {
    manifestMock.mockResolvedValueOnce(publish('r1'));
    const seen: (number | null)[] = [];
    const unsub = useOfflineIndexStore.subscribe((s) => seen.push(s.progress));
    await downloadOfflineIndex();
    unsub();
    const fractions = seen.filter((p): p is number => p !== null);
    expect(fractions.length).toBeGreaterThan(2);
    expect(fractions).toEqual([...fractions].sort((a, b) => a - b));
    expect(fractions.at(-1)).toBe(1);
  });

  it('sha256 mismatch: deletes the part files, keeps the old file and reader, status error', async () => {
    await install('old');
    const reader = openOfflineReader();
    manifestMock.mockResolvedValueOnce(publish('new', { sha256: 'f'.repeat(64) }));

    await downloadOfflineIndex();

    expect(useOfflineIndexStore.getState()).toMatchObject({ status: 'error', run: 'old', progress: null });
    expect(text(CURRENT)).toBe(dbJson('old'));
    expect(partFiles()).toEqual([]);
    expect(openOfflineReader()).toBe(reader);
  });

  it('success swaps atomically: closes the old reader, deletes the previous file, new reader object', async () => {
    await install('old');
    const oldReader = openOfflineReader();
    const oldDb = fsState.openDbs.at(-1)!;
    manifestMock.mockResolvedValueOnce(publish('new'));

    await downloadOfflineIndex();

    expect(oldDb.closed).toBe(true);
    const swap = fsState.log.slice(fsState.log.indexOf(`move ${DIR}/new.db.part -> ${CURRENT}`) - 1);
    expect(swap.slice(0, 3)).toEqual([
      `move ${CURRENT} -> ${DIR}/previous.db`,
      `move ${DIR}/new.db.part -> ${CURRENT}`,
      `delete ${DIR}/previous.db`,
    ]);
    const reader = openOfflineReader();
    expect(reader).not.toBe(oldReader);
    expect(reader?.all('SELECT run FROM x')).toEqual([{ run: 'new' }]);
    expect(fsState.files.has(`${DIR}/previous.db`)).toBe(false);
  });

  it('truncated gzip (with a matching sha256): error, the old file stays', async () => {
    await install('old');
    const full = gzip(new TextEncoder().encode(dbJson('new') + ' '.repeat(5000)));
    const cut = full.slice(0, full.length - 12);
    manifestMock.mockResolvedValueOnce(publish('new', {}, cut));

    await downloadOfflineIndex();

    expect(useOfflineIndexStore.getState()).toMatchObject({ status: 'error', run: 'old' });
    expect(text(CURRENT)).toBe(dbJson('old'));
    expect(partFiles()).toEqual([]);
  });

  it('an empty file (matching an empty manifest) is not a gzip stream', async () => {
    manifestMock.mockResolvedValueOnce(publish('r1', {}, new Uint8Array()));
    await downloadOfflineIndex();
    expect(useOfflineIndexStore.getState().status).toBe('error');
    expect(fsState.files.has(CURRENT)).toBe(false);
  });

  it('a download whose size differs from the manifest is rejected', async () => {
    manifestMock.mockResolvedValueOnce(publish('r1', { bytes: 3 }));
    await downloadOfflineIndex();
    expect(useOfflineIndexStore.getState().status).toBe('error');
    expect(fsState.files.has(CURRENT)).toBe(false);
    expect(partFiles()).toEqual([]);
  });

  it('a gunzipped file that fails its SQLite check is never swapped in', async () => {
    await install('old');
    const gz = gzip(new TextEncoder().encode(dbJson('new', { check: '*** in database main ***' })));
    manifestMock.mockResolvedValueOnce(publish('new', {}, gz));
    await downloadOfflineIndex();
    expect(useOfflineIndexStore.getState()).toMatchObject({ status: 'error', run: 'old' });
    expect(text(CURRENT)).toBe(dbJson('old'));
    expect(partFiles()).toEqual([]);
  });

  it('manifest or network failure: status error, nothing written', async () => {
    manifestMock.mockRejectedValueOnce(new Error('HTTP 503'));
    await downloadOfflineIndex();
    expect(useOfflineIndexStore.getState().status).toBe('error');

    const m = publish('r1');
    fsState.remote.set(m.url, new Error('Unable to download a file: response has status: 403'));
    manifestMock.mockResolvedValueOnce(m);
    await downloadOfflineIndex();
    expect(useOfflineIndexStore.getState().status).toBe('error');
    expect(fsState.files.size).toBe(0);
  });

  it('a schema newer than the app supports: status none, no download, no reader', async () => {
    manifestMock.mockResolvedValueOnce(publish('r2', { schema: 2 }));
    await downloadOfflineIndex();
    expect(File.downloadFileAsync).not.toHaveBeenCalled();
    expect(useOfflineIndexStore.getState().status).toBe('none');
    expect(openOfflineReader()).toBeNull();
  });

  it('a different normaliser version is incompatible too', async () => {
    manifestMock.mockResolvedValueOnce(publish('r2', { normalizer: 4 }));
    await downloadOfflineIndex();
    expect(File.downloadFileAsync).not.toHaveBeenCalled();
    expect(useOfflineIndexStore.getState().status).toBe('none');
  });

  it('an incompatible manifest keeps a previously downloaded compatible file', async () => {
    await install('old');
    manifestMock.mockResolvedValueOnce(publish('r2', { schema: 2 }));
    await downloadOfflineIndex();
    expect(File.downloadFileAsync).toHaveBeenCalledTimes(1);
    expect(useOfflineIndexStore.getState()).toMatchObject({ status: 'ready', run: 'old' });
    expect(openOfflineReader()?.all('SELECT run FROM x')).toEqual([{ run: 'old' }]);
  });

  it('concurrent calls share one download', async () => {
    manifestMock.mockResolvedValue(publish('r1'));
    await Promise.all([downloadOfflineIndex(), downloadOfflineIndex()]);
    expect(File.downloadFileAsync).toHaveBeenCalledTimes(1);
    expect(useOfflineIndexStore.getState().status).toBe('ready');
  });

  it('a run id with path characters cannot escape the offline directory', async () => {
    manifestMock.mockResolvedValueOnce(publish('../../evil'));
    await downloadOfflineIndex();
    const [, dest] = (File.downloadFileAsync as jest.Mock).mock.calls[0];
    expect(dest.uri).toBe(`${DIR}/.._.._evil.db.gz.part`);
    expect(useOfflineIndexStore.getState()).toMatchObject({ status: 'ready', run: '../../evil' });
  });
});

describe('openOfflineReader', () => {
  it('returns null when no file has been downloaded', () => {
    expect(openOfflineReader()).toBeNull();
    expect(openDatabaseSync).not.toHaveBeenCalled();
  });

  it('returns the same reader object for the same opened file (one connection)', async () => {
    await install('r1');
    const a = openOfflineReader();
    expect(openOfflineReader()).toBe(a);
    expect(openDatabaseSync).toHaveBeenCalledTimes(2); // the candidate check during download + this open
    // Own connection, and no close-time statement sweep (it double-finalizes FTS5's statements: SIGSEGV).
    expect(openDatabaseSync).toHaveBeenLastCalledWith(
      'current.db',
      { useNewConnection: true, finalizeUnusedStatementsBeforeClosing: false },
      'file:///cache/offline',
    );
  });

  it('returns null and forgets the list when PRAGMA quick_check fails', async () => {
    await install('r1');
    resetOfflineReaderForTests();
    fsState.files.set(CURRENT, new TextEncoder().encode(dbJson('r1', { check: 'row 7 missing from index' })));

    expect(openOfflineReader()).toBeNull();
    expect(fsState.openDbs.at(-1)!.closed).toBe(true);
    expect(fsState.files.has(CURRENT)).toBe(false);
    expect(useOfflineIndexStore.getState()).toMatchObject({ status: 'none', run: null });
  });

  it('returns null when the file is not a database at all', async () => {
    await install('r1');
    resetOfflineReaderForTests();
    fsState.files.set(CURRENT, new Uint8Array([0x1f, 0x8b, 0, 1]));
    expect(openOfflineReader()).toBeNull();
    expect(useOfflineIndexStore.getState().status).toBe('none');
  });

  it('returns null (without deleting) for a file built for another schema or normaliser', async () => {
    await install('r1');
    resetOfflineReaderForTests();
    fsState.files.set(CURRENT, new TextEncoder().encode(dbJson('r1', { normalizer: 4 })));
    expect(openOfflineReader()).toBeNull();
    expect(fsState.files.has(CURRENT)).toBe(true);
    expect(useOfflineIndexStore.getState().run).toBe('r1');
    // Not re-checked on every keystroke.
    const opens = (openDatabaseSync as jest.Mock).mock.calls.length;
    expect(openOfflineReader()).toBeNull();
    expect(openDatabaseSync).toHaveBeenCalledTimes(opens);
  });

  it('a file the OS purged from the cache resets the store to none', async () => {
    await install('r1');
    resetOfflineReaderForTests();
    fsState.files.delete(CURRENT);
    expect(openOfflineReader()).toBeNull();
    expect(useOfflineIndexStore.getState()).toMatchObject({ status: 'none', run: null });
  });

  it('recovers a swap interrupted between its two renames', async () => {
    await install('r1');
    resetOfflineReaderForTests();
    new File(CURRENT).moveSync(new File(`${DIR}/previous.db`));
    expect(openOfflineReader()?.all('SELECT run FROM x')).toEqual([{ run: 'r1' }]);
    expect(fsState.files.has(CURRENT)).toBe(true);
  });
});

describe('maybeRefreshOfflineIndex', () => {
  const daysAgo = (d: number) => Date.now() - d * 24 * 3600 * 1000;

  it('never makes the first download (opt-in)', async () => {
    netMock.mockResolvedValue(wifi);
    await maybeRefreshOfflineIndex();
    expect(manifestMock).not.toHaveBeenCalled();
  });

  it('does not refresh on a metered connection', async () => {
    await install('r1');
    useOfflineIndexStore.setState({ downloadedAt: daysAgo(30) });
    netMock.mockResolvedValue(cellular);
    await maybeRefreshOfflineIndex();
    expect(manifestMock).toHaveBeenCalledTimes(1); // only install's
    expect(File.downloadFileAsync).toHaveBeenCalledTimes(1);
  });

  it('does not refresh within 7 days when the schema and normaliser match', async () => {
    await install('r1');
    useOfflineIndexStore.setState({ downloadedAt: daysAgo(6) });
    netMock.mockResolvedValue(wifi);
    await maybeRefreshOfflineIndex();
    expect(manifestMock).toHaveBeenCalledTimes(1);
  });

  it('refreshes after 7 days on an unmetered connection', async () => {
    await install('r1');
    useOfflineIndexStore.setState({ downloadedAt: Date.now() - REFRESH_AFTER_MS - 1 });
    netMock.mockResolvedValue(wifi);
    manifestMock.mockResolvedValueOnce(publish('r2'));
    await maybeRefreshOfflineIndex();
    expect(useOfflineIndexStore.getState()).toMatchObject({ status: 'ready', run: 'r2' });
  });

  it('refreshes early when the stored file was built for another normaliser (app update)', async () => {
    await install('r1');
    useOfflineIndexStore.setState({ normalizer: 2 });
    netMock.mockResolvedValue(wifi);
    manifestMock.mockResolvedValueOnce(publish('r2'));
    await maybeRefreshOfflineIndex();
    expect(useOfflineIndexStore.getState().run).toBe('r2');
  });

  it('skips the download when the server still has the same run', async () => {
    await install('r1');
    useOfflineIndexStore.setState({ downloadedAt: daysAgo(8) });
    netMock.mockResolvedValue(wifi);
    manifestMock.mockResolvedValueOnce(publish('r1'));
    await maybeRefreshOfflineIndex();
    expect(File.downloadFileAsync).toHaveBeenCalledTimes(1);
    expect(useOfflineIndexStore.getState().status).toBe('ready');
  });

  it('a failed manifest check in the background stays quiet', async () => {
    await install('r1');
    useOfflineIndexStore.setState({ downloadedAt: daysAgo(8) });
    netMock.mockResolvedValue(wifi);
    manifestMock.mockRejectedValueOnce(new Error('offline'));
    await maybeRefreshOfflineIndex();
    expect(useOfflineIndexStore.getState().status).toBe('ready');
  });

  it('NetInfo failing counts as metered', async () => {
    await install('r1');
    useOfflineIndexStore.setState({ downloadedAt: daysAgo(8) });
    netMock.mockRejectedValue(new Error('no module'));
    await maybeRefreshOfflineIndex();
    expect(manifestMock).toHaveBeenCalledTimes(1);
  });
});

describe('removeOfflineIndex', () => {
  it('deletes the file, closes the reader and resets the store', async () => {
    await install('r1');
    openOfflineReader();
    const db = fsState.openDbs.at(-1)!;

    await removeOfflineIndex();

    expect(db.closed).toBe(true);
    expect([...fsState.files.keys()]).toEqual([]);
    expect(openOfflineReader()).toBeNull();
    expect(useOfflineIndexStore.getState()).toMatchObject({
      status: 'none',
      run: null,
      bytes: null,
      downloadedAt: null,
      progress: null,
    });
  });

  it('during a download: the download is cancelled and nothing is kept', async () => {
    manifestMock.mockResolvedValueOnce(publish('r1'));
    let removing: Promise<void> | undefined;
    fsState.afterDownload = () => {
      removing = removeOfflineIndex();
    };
    await downloadOfflineIndex();
    await removing;
    expect(fsState.files.size).toBe(0);
    expect(useOfflineIndexStore.getState()).toMatchObject({ status: 'none', run: null });
  });
});

describe('persistence and the hook', () => {
  const relaunch = () => {
    let mod!: typeof import('../offlineIndexStore');
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      mod = require('../offlineIndexStore');
    });
    return mod.useOfflineIndexStore.getState();
  };

  it('the downloaded file survives an app restart; a half-finished download does not', async () => {
    await install('r1');
    expect(relaunch()).toMatchObject({ status: 'ready', run: 'r1', schema: 1, normalizer: 3, progress: null });

    useOfflineIndexStore.getState().started();
    expect(relaunch()).toMatchObject({ status: 'ready', run: 'r1', progress: null });

    await removeOfflineIndex();
    expect(relaunch()).toMatchObject({ status: 'none', run: null });
  });

  it('useOfflineIndex exposes status, size, date, progress, download() and remove()', async () => {
    manifestMock.mockResolvedValueOnce(publish('r1'));
    const { result } = renderHook(() => useOfflineIndex());
    expect(result.current).toMatchObject({ status: 'none', bytes: null, downloadedAt: null, progress: null });

    await act(() => result.current.download());
    expect(result.current.status).toBe('ready');
    expect(result.current.bytes).toBeGreaterThan(0);
    expect(result.current.downloadedAt).not.toBeNull();

    await act(() => result.current.remove());
    expect(result.current.status).toBe('none');
  });
});
