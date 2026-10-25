import * as decide from '@nomad/api-decide';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { useSetlists } from '../../me/useSetlists';
import { useMeOutbox } from '../../me/meOutbox';
import { resetMe, wrapperFor } from './helpers';

jest.mock('@nomad/api-decide', () => ({
  ...jest.requireActual('@nomad/api-decide'),
  listSetlists: jest.fn(),
  createSetlist: jest.fn(),
  putSetlistItems: jest.fn(),
  renameSetlist: jest.fn(),
  deleteSetlist: jest.fn(),
}));
const api = decide as jest.Mocked<typeof decide>;
const { ApiError } = jest.requireActual<typeof decide>('@nomad/api-decide');

beforeEach(() => {
  jest.clearAllMocks();
});

it('creating offline shows the setlist at once with a pl_ id', async () => {
  const client = resetMe();
  api.listSetlists.mockRejectedValue(new ApiError(0, 'offline'));
  api.createSetlist.mockRejectedValue(new ApiError(0, 'offline'));
  const { result } = renderHook(() => useSetlists(), { wrapper: wrapperFor(client) });
  let id = '';
  act(() => {
    id = result.current.createSetlist('Friday');
  });
  expect(id).toMatch(/^pl_[A-Za-z0-9-]{8,64}$/);
  expect(result.current.setlists.map((s) => [s.id, s.name])).toEqual([[id, 'Friday']]);
  await waitFor(() => expect(result.current.offline).toBe(true));
  expect(result.current.setlists).toHaveLength(1);
  expect(useMeOutbox.getState().items).toHaveLength(1);
});

it('adds, removes and deletes optimistically', async () => {
  const client = resetMe();
  api.listSetlists.mockResolvedValue([]);
  api.createSetlist.mockRejectedValue(new ApiError(0, 'offline'));
  const { result } = renderHook(() => useSetlists(), { wrapper: wrapperFor(client) });
  let id = '';
  act(() => {
    id = result.current.createSetlist('Mix');
  });
  act(() => result.current.addSongs([id], { artist: 'A', title: 'One', song_key: 'k1' }));
  expect(result.current.setlists[0]!.items).toHaveLength(1);
  act(() => result.current.addSongs([id], { artist: 'A', title: 'One', song_key: 'k1' }));
  expect(result.current.setlists[0]!.items).toHaveLength(1);
  const itemId = result.current.setlists[0]!.items![0]!.item_id;
  act(() => result.current.removeItem(id, itemId));
  expect(result.current.setlists[0]!.items).toHaveLength(0);
  act(() => result.current.deleteSetlist(id));
  expect(result.current.setlists).toHaveLength(0);
});

it('refuses (does not truncate) past 500 songs', async () => {
  const client = resetMe();
  api.listSetlists.mockResolvedValue([]);
  api.createSetlist.mockRejectedValue(new ApiError(0, 'offline'));
  const { result } = renderHook(() => useSetlists(), { wrapper: wrapperFor(client) });
  let id = '';
  act(() => {
    id = result.current.createSetlist('Big');
  });
  const many = Array.from({ length: 500 }, (_, n) => ({ song_key: `k${n}`, artist: 'A', title: `T${n}` }));
  act(() => {
    expect(result.current.setItems(id, many)).toBe(true);
  });
  let res: { added: string[]; full: string[] } = { added: [], full: [] };
  act(() => {
    res = result.current.addSongs([id], { artist: 'A', title: 'One more', song_key: 'kx' });
  });
  expect(res).toEqual({ added: [], full: [id] });
  expect(result.current.setlists[0]!.items).toHaveLength(500);
});
