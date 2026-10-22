import * as decide from '@nomad/api-decide';

import { useAuth } from '../../../auth/store';
import { appStorage } from '../../../storage';
import { useLogStore } from '../../../tonight/log/logStore';
import { outboxBackoffMs, outboxIdle, useOutbox } from '../../../tonight/log/outbox';
import { userKeyFor } from '../../../tonight/nightStore';

jest.mock('@nomad/api-decide', () => ({
  ...jest.requireActual('@nomad/api-decide'),
  putKaraokeLog: jest.fn(),
  deleteKaraokeLog: jest.fn(),
}));

const api = decide as jest.Mocked<typeof decide>;
const { ApiError } = jest.requireActual<typeof decide>('@nomad/api-decide');

const signIn = (email: string) =>
  useAuth.setState({ state: { status: 'signedIn', session: { token: 't', email, createdAt: 0 } } });
const signOut = () => useAuth.setState({ state: { status: 'signedOut' } });
const entry = { id: 'x', user_id: 'u', source: 'app' as const };

/** Pauses PUTs until released, so items can queue up. */
function gate() {
  let open!: () => void;
  const p = new Promise<void>((r) => (open = r));
  api.putKaraokeLog.mockImplementation(async () => {
    await p;
    return entry;
  });
  return open;
}

beforeEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
  appStorage.clearAll();
  signOut();
  signIn('a@example.com');
  useOutbox.getState().rehydrate('a@example.com');
  useLogStore.getState().rehydrate('a@example.com');
  api.putKaraokeLog.mockResolvedValue(entry);
  api.deleteKaraokeLog.mockResolvedValue({ ...entry, deleted: true });
});

afterEach(async () => {
  await outboxIdle();
});

it('outbox coalesces and retries', async () => {
  jest.useFakeTimers({ now: 1_000_000 });
  const release = gate();
  const ob = useOutbox.getState();
  ob.enqueue('app_1', 'put', { state: 'planned', artist: 'A', title: 'T' });
  // app_1 is in flight; these queue behind it and coalesce per id, field-wise.
  ob.enqueue('app_2', 'put', { state: 'requested', artist: 'B', title: 'U' });
  ob.enqueue('app_2', 'put', { state: 'sung', sung_at: 'S' });
  ob.enqueue('app_2', 'put', { survey: { feel: 'great' } });
  ob.enqueue('app_2', 'put', { survey: { key: 'right' } });
  expect(useOutbox.getState().items.map((i) => i.id)).toEqual(['app_1', 'app_2']);

  // The first send of app_2 fails (5xx): backoff 5 s, nothing dropped.
  api.putKaraokeLog.mockRejectedValueOnce(new ApiError(503, 'boom')).mockResolvedValue(entry);
  release();
  await jest.advanceTimersByTimeAsync(0);
  await outboxIdle();
  expect(api.putKaraokeLog).toHaveBeenCalledTimes(2);
  expect(api.putKaraokeLog).toHaveBeenLastCalledWith('app_2', {
    state: 'sung',
    artist: 'B',
    title: 'U',
    sung_at: 'S',
    survey: { feel: 'great', key: 'right' },
  });
  expect(useOutbox.getState().items.map((i) => i.id)).toEqual(['app_2']);
  expect(useOutbox.getState().attempts).toBe(1);
  expect(useOutbox.getState().retryAt).toBe(1_000_000 + 5_000);

  await jest.advanceTimersByTimeAsync(4_999);
  expect(api.putKaraokeLog).toHaveBeenCalledTimes(2);
  await jest.advanceTimersByTimeAsync(1);
  await outboxIdle();
  expect(api.putKaraokeLog).toHaveBeenCalledTimes(3);
  expect(useOutbox.getState().items).toEqual([]);
  expect(useOutbox.getState().attempts).toBe(0);
  jest.useRealTimers();
});

it('backoff doubles from 5 s and caps at 5 min', () => {
  expect([1, 2, 3, 4, 5, 6, 7, 20].map(outboxBackoffMs)).toEqual([5_000, 10_000, 20_000, 40_000, 80_000, 160_000, 300_000, 300_000]);
});

it('a write made while its id is in flight is sent again, merged', async () => {
  const release = gate();
  useOutbox.getState().enqueue('app_1', 'put', { state: 'planned', artist: 'A', title: 'T' });
  useOutbox.getState().enqueue('app_1', 'put', { state: 'sung' });
  api.putKaraokeLog.mockResolvedValue(entry);
  release();
  await outboxIdle();
  await outboxIdle();
  expect(api.putKaraokeLog).toHaveBeenLastCalledWith('app_1', { state: 'sung', artist: 'A', title: 'T' });
  expect(useOutbox.getState().items).toEqual([]);
});

it('delete replaces a queued put for the same id', async () => {
  const release = gate();
  useOutbox.getState().enqueue('app_0', 'put', { state: 'planned', artist: 'Z', title: 'Z' });
  useOutbox.getState().enqueue('app_1', 'put', { state: 'planned', artist: 'A', title: 'T' });
  useOutbox.getState().enqueue('app_1', 'delete');
  expect(useOutbox.getState().items.map((i) => [i.id, i.op])).toEqual([
    ['app_0', 'put'],
    ['app_1', 'delete'],
  ]);
  release();
  await outboxIdle();
  expect(api.deleteKaraokeLog).toHaveBeenCalledWith('app_1');
  expect(api.putKaraokeLog).not.toHaveBeenCalledWith('app_1', expect.anything());
});

it('permanent errors drop the item and log a warning (E8-R4: 403 not_owner)', async () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  api.putKaraokeLog.mockRejectedValueOnce(new ApiError(403, 'not_owner'));
  useOutbox.getState().enqueue('kj_abc', 'put', { survey: { feel: 'ok' } });
  useOutbox.getState().enqueue('app_2', 'put', { state: 'sung', artist: 'B', title: 'U' });
  await outboxIdle();
  await outboxIdle();
  expect(useOutbox.getState().items).toEqual([]);
  expect(api.putKaraokeLog).toHaveBeenCalledWith('app_2', expect.anything());
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('kj_abc'));
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('403 not_owner'));
  warn.mockRestore();
});

it.each([400, 404, 422])('%i is permanent', async (status) => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  api.deleteKaraokeLog.mockRejectedValueOnce(new ApiError(status, 'x'));
  useOutbox.getState().enqueue('app_9', 'delete');
  await outboxIdle();
  expect(useOutbox.getState().items).toEqual([]);
  expect(useOutbox.getState().retryAt).toBeNull();
  warn.mockRestore();
});

it('401 keeps the item without a backoff timer; the next trigger retries', async () => {
  api.putKaraokeLog.mockRejectedValueOnce(new ApiError(401, 'Not authenticated'));
  useOutbox.getState().enqueue('app_1', 'put', { state: 'sung', artist: 'A', title: 'T' });
  await outboxIdle();
  expect(useOutbox.getState().items).toHaveLength(1);
  expect(useOutbox.getState().retryAt).toBeNull();
  await useOutbox.getState().flush();
  expect(useOutbox.getState().items).toEqual([]);
});

it('a network failure (no response) is transient', async () => {
  api.putKaraokeLog.mockRejectedValueOnce(new TypeError('Network request failed'));
  useOutbox.getState().enqueue('app_1', 'put', { state: 'sung', artist: 'A', title: 'T' });
  await outboxIdle();
  expect(useOutbox.getState().items).toHaveLength(1);
  expect(useOutbox.getState().retryAt).not.toBeNull();
  useOutbox.getState().rehydrate('a@example.com'); // clears the timer
});

it('log outbox is per user (Review Focus 1)', async () => {
  // A's writes queue while offline (every send fails).
  api.putKaraokeLog.mockRejectedValue(new TypeError('offline'));
  const aId = useLogStore.getState().addOther({ artist: 'Muse', title: 'Starlight' }, 'sung')!;
  await outboxIdle();
  expect(useLogStore.getState().entries[aId]).toBeTruthy();
  expect(useOutbox.getState().items.map((i) => i.id)).toEqual([aId]);
  expect(appStorage.getString(`tonight.outbox.v1.${userKeyFor('a@example.com')}`)).toContain(aId);
  expect(appStorage.getString(`tonight.log.v1.${userKeyFor('a@example.com')}`)).toContain(aId);

  // B signs in on the same phone: none of A's log or outbox shows or syncs.
  api.putKaraokeLog.mockReset();
  api.putKaraokeLog.mockResolvedValue(entry);
  signIn('b@example.com');
  await outboxIdle();
  expect(useLogStore.getState().entries).toEqual({});
  expect(useOutbox.getState().items).toEqual([]);
  expect(api.putKaraokeLog).not.toHaveBeenCalled();
  const bId = useLogStore.getState().addOther({ artist: 'Adele', title: 'Hello' }, 'planned')!;
  await outboxIdle();
  expect(api.putKaraokeLog).toHaveBeenCalledTimes(1);
  expect(api.putKaraokeLog).toHaveBeenCalledWith(bId, expect.objectContaining({ artist: 'Adele' }));

  // A comes back: A's queue (still pending) is restored and sent under A.
  signIn('a@example.com');
  await outboxIdle();
  await outboxIdle();
  expect(useLogStore.getState().entries[aId]).toBeTruthy();
  expect(useLogStore.getState().entries[bId]).toBeUndefined();
  expect(api.putKaraokeLog).toHaveBeenCalledWith(aId, expect.objectContaining({ artist: 'Muse' }));
  expect(useOutbox.getState().items).toEqual([]);
});

it('a flush in flight when the account changes never touches the new account\'s queue', async () => {
  const release = gate();
  useOutbox.getState().enqueue('app_a', 'put', { state: 'sung', artist: 'A', title: 'T' });
  signIn('b@example.com');
  useOutbox.getState().enqueue('app_b', 'put', { state: 'sung', artist: 'B', title: 'U' });
  release();
  await outboxIdle();
  await outboxIdle();
  // A's in-flight send finished, then B's queue got its own flush.
  expect(api.putKaraokeLog.mock.calls.map((c) => c[0])).toEqual(['app_a', 'app_b']);
  expect(useOutbox.getState().items).toEqual([]);
  // A's queue still holds app_a (its success landed after the swap: sent again later, an idempotent PUT).
  expect(appStorage.getString(`tonight.outbox.v1.${userKeyFor('a@example.com')}`)).toContain('app_a');
});

it('signed out: nothing is queued', () => {
  signOut();
  useOutbox.getState().enqueue('app_1', 'put', { state: 'sung', artist: 'A', title: 'T' });
  expect(useOutbox.getState().items).toEqual([]);
  expect(useLogStore.getState().addOther({ artist: 'A', title: 'T' }, 'sung')).toBeNull();
});

it('item revs stay unique across restarts: a write coalesced onto a stored item in flight is still sent', async () => {
  // Learn the rev this launch's counter would hand out next (on a cold start that is 1).
  api.putKaraokeLog.mockRejectedValueOnce(new ApiError(400, 'invalid'));
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  useOutbox.getState().enqueue('probe', 'put', {});
  const nextRev = useOutbox.getState().items[0]!.rev + 1;
  await outboxIdle();
  warn.mockRestore();
  // A previous launch left an item queued with exactly that rev: loading it must move the counter past it.
  appStorage.set(
    `tonight.outbox.v1.${userKeyFor('a@example.com')}`,
    JSON.stringify([{ id: 'app_1', op: 'put', patch: { state: 'planned', artist: 'A', title: 'T' }, rev: nextRev }]),
  );
  useOutbox.getState().rehydrate('a@example.com');
  const release = gate();
  void useOutbox.getState().flush();
  useOutbox.getState().enqueue('app_1', 'put', { state: 'sung' });
  expect(useOutbox.getState().items[0]!.rev).toBeGreaterThan(nextRev);
  api.putKaraokeLog.mockResolvedValue(entry);
  release();
  await outboxIdle();
  await outboxIdle();
  expect(api.putKaraokeLog).toHaveBeenLastCalledWith('app_1', { state: 'sung', artist: 'A', title: 'T' });
  expect(useOutbox.getState().items).toEqual([]);
});

it('a put after a queued delete for the same id keeps the delete', async () => {
  const release = gate();
  useOutbox.getState().enqueue('app_0', 'put', { state: 'planned', artist: 'Z', title: 'Z' });
  useOutbox.getState().enqueue('app_1', 'delete');
  useOutbox.getState().enqueue('app_1', 'put', { survey: { feel: 'ok' } });
  expect(useOutbox.getState().items.map((i) => [i.id, i.op])).toEqual([
    ['app_0', 'put'],
    ['app_1', 'delete'],
  ]);
  release();
  await outboxIdle();
  expect(api.deleteKaraokeLog).toHaveBeenCalledWith('app_1');
  expect(api.putKaraokeLog).not.toHaveBeenCalledWith('app_1', expect.anything());
});
