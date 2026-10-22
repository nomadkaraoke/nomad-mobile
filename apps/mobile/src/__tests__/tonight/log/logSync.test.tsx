import * as decide from '@nomad/api-decide';
import { act, render } from '@testing-library/react-native';
import { AppState } from 'react-native';

import { useAuth } from '../../../auth/store';
import { useOffline } from '../../../net/useOffline';
import { appStorage } from '../../../storage';
import { useLogStore } from '../../../tonight/log/logStore';
import { outboxIdle, useOutbox } from '../../../tonight/log/outbox';
import { useLogSync } from '../../../tonight/log/useLogSync';

jest.mock('@nomad/api-decide', () => ({
  ...jest.requireActual('@nomad/api-decide'),
  putKaraokeLog: jest.fn(),
  deleteKaraokeLog: jest.fn(),
}));
jest.mock('../../../net/useOffline', () => ({ useOffline: jest.fn(() => false) }));

const api = decide as jest.Mocked<typeof decide>;
const offline = useOffline as jest.Mock;

function Sync() {
  useLogSync();
  return null;
}

beforeEach(() => {
  jest.clearAllMocks();
  appStorage.clearAll();
  useAuth.setState({ state: { status: 'signedIn', session: { token: 't', email: 'sam@example.com', createdAt: 0 } } });
  useOutbox.getState().rehydrate('sam@example.com');
  useLogStore.getState().rehydrate('sam@example.com');
});
afterEach(async () => {
  await outboxIdle();
  useOutbox.getState().rehydrate('sam@example.com');
});

it('offline then online flushes', async () => {
  offline.mockReturnValue(true);
  api.putKaraokeLog.mockRejectedValue(new TypeError('Network request failed'));
  const view = render(<Sync />);
  const id = useLogStore.getState().addOther({ artist: 'Adele', title: 'Hello' }, 'sung')!;
  await act(outboxIdle);
  expect(useOutbox.getState().items.map((i) => i.id)).toEqual([id]);
  const calls = api.putKaraokeLog.mock.calls.length;

  // Connection back: sent at once, without waiting for the backoff timer.
  api.putKaraokeLog.mockResolvedValue({ id, user_id: 'u', source: 'app' });
  offline.mockReturnValue(false);
  view.rerender(<Sync />);
  await act(outboxIdle);
  expect(api.putKaraokeLog.mock.calls.length).toBe(calls + 1);
  expect(useOutbox.getState().items).toEqual([]);
});

it('flushes on mount and when the app returns to the foreground', async () => {
  const listeners: ((s: string) => void)[] = [];
  const spy = jest.spyOn(AppState, 'addEventListener').mockImplementation((_e, fn) => {
    listeners.push(fn as (s: string) => void);
    return { remove: jest.fn() } as never;
  });
  // A queued write from an earlier session (persisted), never sent.
  api.putKaraokeLog.mockRejectedValueOnce(new TypeError('offline')).mockResolvedValue({ id: 'x', user_id: 'u', source: 'app' });
  useOutbox.getState().enqueue('app_old', 'put', { state: 'sung', artist: 'A', title: 'T' });
  await outboxIdle();
  useOutbox.getState().rehydrate('sam@example.com'); // as after a restart: queue reloaded, no timer
  expect(useOutbox.getState().items).toHaveLength(1);

  render(<Sync />);
  await act(outboxIdle);
  expect(useOutbox.getState().items).toEqual([]);

  api.putKaraokeLog.mockClear();
  useOutbox.setState({ items: [{ id: 'app_n', op: 'put', patch: { state: 'planned', artist: 'B', title: 'U' }, rev: 0 }] });
  act(() => listeners.forEach((l) => l('active')));
  await act(outboxIdle);
  expect(api.putKaraokeLog).toHaveBeenCalledWith('app_n', expect.anything());
  spy.mockRestore();
});
