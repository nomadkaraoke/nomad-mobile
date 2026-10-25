import { ApiError } from '@nomad/api-decide';

import { useAuth } from '../../auth/store';
import { createOutbox } from '../../sync/createOutbox';
import { appStorage } from '../../storage';

type Item = { key: string; v: number };

const signIn = (email: string) =>
  useAuth.setState({ state: { status: 'signedIn', session: { token: 't', email, createdAt: 0 } } });

const send = jest.fn<Promise<void>, [Item]>();
const make = () =>
  createOutbox<Item>({
    storageKey: (u) => `test.outbox.${u}`,
    send,
    merge: (_q, n) => n,
    isPermanent: (e) => e instanceof ApiError && e.status === 422,
    backoff: (n) => 1000 * n,
  });

let useBox: ReturnType<typeof make>;
beforeEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
  appStorage.clearAll();
  signIn('a@example.com');
  send.mockResolvedValue(undefined);
  useBox = make();
  useBox.getState().rehydrate('a@example.com');
});
afterEach(() => useBox.idle());

const hold = () => {
  let open!: () => void;
  const p = new Promise<void>((r) => (open = r));
  send.mockImplementationOnce(() => p);
  return open;
};

it('coalesces per key keeping the first position', async () => {
  const open = hold();
  const b = useBox.getState();
  b.enqueue({ key: 'a', v: 1 }); // in flight
  b.enqueue({ key: 'b', v: 1 });
  b.enqueue({ key: 'c', v: 1 });
  b.enqueue({ key: 'b', v: 2 });
  expect(useBox.getState().items.map((i) => [i.key, i.v])).toEqual([['a', 1], ['b', 2], ['c', 1]]);
  open();
  await useBox.idle();
  expect(send.mock.calls.map((c) => [c[0].key, c[0].v])).toEqual([['a', 1], ['b', 2], ['c', 1]]);
  expect(useBox.getState().items).toEqual([]);
  expect(useBox.getState().synced).toBe(3);
});

it('keeps a write coalesced while its send was in flight', async () => {
  const open = hold();
  useBox.getState().enqueue({ key: 'a', v: 1 });
  useBox.getState().enqueue({ key: 'a', v: 2 });
  open();
  await useBox.idle();
  expect(send.mock.calls.map((c) => c[0].v)).toEqual([1, 2]);
});

it('a 401 stops the flush and keeps items', async () => {
  send.mockRejectedValue(new ApiError(401, 'no'));
  useBox.getState().enqueue({ key: 'a', v: 1 });
  useBox.getState().enqueue({ key: 'b', v: 1 });
  await useBox.idle();
  expect(send).toHaveBeenCalledTimes(1);
  expect(useBox.getState().items).toHaveLength(2);
  expect(useBox.getState().retryAt).toBeNull();
});

it('a permanent error drops the item and carries on', async () => {
  send.mockRejectedValueOnce(new ApiError(422, 'bad'));
  useBox.getState().enqueue({ key: 'a', v: 1 });
  useBox.getState().enqueue({ key: 'b', v: 1 });
  await useBox.idle();
  expect(send).toHaveBeenCalledTimes(2);
  expect(useBox.getState().items).toEqual([]);
  expect(useBox.getState().synced).toBe(1);
});

it('a transient error backs off and schedules retryAt', async () => {
  jest.useFakeTimers({ now: 5_000 });
  send.mockRejectedValueOnce(new Error('net'));
  useBox.getState().enqueue({ key: 'a', v: 1 });
  await useBox.idle();
  expect(useBox.getState().attempts).toBe(1);
  expect(useBox.getState().retryAt).toBe(6_000);
  expect(useBox.getState().items).toHaveLength(1);
  await jest.advanceTimersByTimeAsync(1000);
  await useBox.idle();
  expect(useBox.getState().items).toEqual([]);
  expect(useBox.getState().attempts).toBe(0);
});

it('merge null drops the queued item without sending', async () => {
  const box = createOutbox<Item>({
    storageKey: (u) => `test2.outbox.${u}`,
    send,
    merge: () => null,
    isPermanent: () => false,
    backoff: () => 1000,
  });
  box.getState().rehydrate('a@example.com');
  const open = hold();
  box.getState().enqueue({ key: 'x', v: 1 }); // in flight
  box.getState().enqueue({ key: 'y', v: 1 });
  box.getState().enqueue({ key: 'y', v: 2 });
  expect(box.getState().items.map((i) => i.key)).toEqual(['x']);
  open();
  await box.idle();
  expect(send).toHaveBeenCalledTimes(1);
});

it('persists per user and clear() empties', async () => {
  send.mockRejectedValue(new ApiError(401, 'no'));
  useBox.getState().enqueue({ key: 'a', v: 1 });
  await useBox.idle();
  useBox.getState().rehydrate('b@example.com');
  expect(useBox.getState().items).toEqual([]);
  useBox.getState().rehydrate('a@example.com');
  expect(useBox.getState().items).toHaveLength(1);
  useBox.getState().clear();
  expect(useBox.getState().items).toEqual([]);
});

it('a null merge for an in-flight key keeps a follow-up, even after an earlier coalesce', async () => {
  const box = createOutbox<Item>({
    storageKey: (u) => `test3.outbox.${u}`,
    send,
    merge: () => null,
    isPermanent: () => false,
    backoff: () => 1000,
  });
  box.getState().rehydrate('a@example.com');
  const open = hold();
  box.getState().enqueue({ key: 'x', v: 1 }); // in flight
  box.getState().enqueue({ key: 'x', v: 2 });
  box.getState().enqueue({ key: 'x', v: 3 });
  expect(box.getState().items.map((i) => i.v)).toEqual([3]);
  open();
  await box.idle();
  expect(send.mock.calls.map((c) => c[0].v)).toEqual([1, 3]);
});

it('merge sees attempted once a send of the key has started, and purge removes a user queue', async () => {
  const seen: (boolean | undefined)[] = [];
  const box = createOutbox<Item>({
    storageKey: (u) => `test4.outbox.${u}`,
    send,
    merge: (q, n) => {
      seen.push(q.attempted);
      return n;
    },
    isPermanent: () => false,
    backoff: () => 1000,
  });
  box.getState().rehydrate('a@example.com');
  send.mockRejectedValue(new ApiError(401, 'no'));
  box.getState().enqueue({ key: 'x', v: 1 });
  await box.idle();
  box.getState().enqueue({ key: 'x', v: 2 });
  await box.idle();
  expect(seen).toEqual([true]);
  expect(appStorage.getString(box.storageKeyFor(box.getState().userKey!))).toBeDefined();
  box.getState().purge(box.getState().userKey!);
  expect(box.getState().items).toEqual([]);
  expect(appStorage.getString(box.storageKeyFor(box.getState().userKey!))).toBeUndefined();
});
