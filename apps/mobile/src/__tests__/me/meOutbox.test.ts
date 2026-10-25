import * as decide from '@nomad/api-decide';

import { useAuth } from '../../auth/store';
import { meMerge, useMeOutbox, type MeOutboxItem } from '../../me/meOutbox';
import { appStorage } from '../../storage';

jest.mock('@nomad/api-decide', () => ({
  ...jest.requireActual('@nomad/api-decide'),
  createSetlist: jest.fn(),
  putSetlistItems: jest.fn(),
  renameSetlist: jest.fn(),
  deleteSetlist: jest.fn(),
  loveSong: jest.fn(),
  unloveSong: jest.fn(),
}));
const api = decide as jest.Mocked<typeof decide>;
const { ApiError } = jest.requireActual<typeof decide>('@nomad/api-decide');

const it1 = (n: number) => ({ song_key: `k${n}`, artist: 'A', title: `T${n}` }) as decide.SetlistItemIn;
const save = (o: Partial<Extract<MeOutboxItem, { op: 'save' }>> = {}): MeOutboxItem => ({
  key: 'setlist:pl_12345678',
  op: 'save',
  id: 'pl_12345678',
  name: 'N',
  items: [],
  create: false,
  baseRev: null,
  ...o,
});

beforeEach(() => {
  jest.clearAllMocks();
  appStorage.clearAll();
  useAuth.setState({ state: { status: 'signedIn', session: { token: 't', email: 'a@example.com', createdAt: 0 } } });
  useMeOutbox.getState().rehydrate('a@example.com');
  api.createSetlist.mockResolvedValue({} as never);
  api.putSetlistItems.mockResolvedValue({} as never);
  api.renameSetlist.mockResolvedValue({} as never);
  api.deleteSetlist.mockResolvedValue();
  api.loveSong.mockResolvedValue();
  api.unloveSong.mockResolvedValue();
});
afterEach(() => useMeOutbox.idle());

/** Every send answers 401 (parks the queue), as when the session is lapsed or the phone is offline. */
const goOffline = () => {
  const e = new ApiError(401, 'x');
  for (const f of [api.createSetlist, api.putSetlistItems, api.renameSetlist, api.deleteSetlist, api.loveSong, api.unloveSong])
    (f as jest.Mock).mockRejectedValue(e);
};
const goOnline = () => {
  for (const f of [api.createSetlist, api.putSetlistItems, api.renameSetlist, api.deleteSetlist, api.loveSong, api.unloveSong])
    (f as jest.Mock).mockResolvedValue(undefined);
  jest.clearAllMocks();
};

it('merge rules', () => {
  const c = save({ create: true, name: 'a', items: [it1(1)] });
  const m = meMerge(c, save({ name: 'b', items: [it1(2)], rename: true }));
  expect(m).toMatchObject({ op: 'save', create: true, name: 'b', rename: true, items: [it1(2)] });
  expect(meMerge(c, { key: 'setlist:pl_12345678', op: 'delete', id: 'pl_12345678' })).toBeNull();
  expect(meMerge(save(), { key: 'setlist:pl_12345678', op: 'delete', id: 'pl_12345678' })).toMatchObject({ op: 'delete' });
});

it('create then edits offline sends one createSetlist with the final items', async () => {
  goOffline();
  const b = useMeOutbox.getState();
  b.enqueue(save({ create: true, items: [it1(1)] }));
  b.enqueue(save({ items: [it1(1), it1(2)] }));
  b.enqueue(save({ items: [it1(3)] }));
  await useMeOutbox.idle();
  expect(useMeOutbox.getState().items).toHaveLength(1);
  goOnline();
  await useMeOutbox.getState().flush();
  expect(api.createSetlist).toHaveBeenCalledTimes(1);
  expect(api.createSetlist).toHaveBeenCalledWith({ id: 'pl_12345678', name: 'N', items: [it1(3)] });
  expect(api.putSetlistItems).not.toHaveBeenCalled();
  expect(useMeOutbox.getState().items).toEqual([]);
});

it('create then delete makes no network call', async () => {
  goOffline();
  const b = useMeOutbox.getState();
  b.enqueue(save({ create: true }));
  await useMeOutbox.idle();
  b.enqueue({ key: 'setlist:pl_12345678', op: 'delete', id: 'pl_12345678' });
  expect(useMeOutbox.getState().items).toEqual([]);
  goOnline();
  await useMeOutbox.getState().flush();
  expect(api.deleteSetlist).not.toHaveBeenCalled();
  expect(api.createSetlist).not.toHaveBeenCalled();
});

it('delete 404 counts as done', async () => {
  const before = useMeOutbox.getState().synced;
  api.deleteSetlist.mockRejectedValueOnce(new ApiError(404, 'nf'));
  useMeOutbox.getState().enqueue({ key: 'setlist:pl_zzzzzzzz', op: 'delete', id: 'pl_zzzzzzzz' });
  await useMeOutbox.idle();
  expect(useMeOutbox.getState().items).toEqual([]);
  expect(useMeOutbox.getState().synced).toBe(before + 1);
});

it('save puts items and renames only when flagged', async () => {
  const b = useMeOutbox.getState();
  b.enqueue(save({ items: [it1(1)], baseRev: 4 }));
  await useMeOutbox.idle();
  expect(api.putSetlistItems).toHaveBeenCalledWith('pl_12345678', [it1(1)], 4);
  expect(api.renameSetlist).not.toHaveBeenCalled();
  b.enqueue(save({ name: 'New', rename: true }));
  await useMeOutbox.idle();
  expect(api.renameSetlist).toHaveBeenCalledWith('pl_12345678', 'New');
});

it('love then unlove coalesce to the last', async () => {
  goOffline();
  const b = useMeOutbox.getState();
  const love = (loved: boolean): MeOutboxItem => ({ key: 'love:k1', op: 'love', song_key: 'k1', artist: 'A', title: 'T', loved });
  b.enqueue(love(true));
  await useMeOutbox.idle();
  b.enqueue(love(false));
  await useMeOutbox.idle();
  expect(useMeOutbox.getState().items).toHaveLength(1);
  goOnline();
  await useMeOutbox.getState().flush();
  expect(api.unloveSong).toHaveBeenCalledWith('k1');
  expect(api.loveSong).not.toHaveBeenCalled();
});
