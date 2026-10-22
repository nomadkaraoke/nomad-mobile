import * as decide from '@nomad/api-decide';

import { useAuth } from '../../../auth/store';
import { appStorage } from '../../../storage';
import { setLogClock, useLogStore } from '../../../tonight/log/logStore';
import { outboxIdle, useOutbox } from '../../../tonight/log/outbox';
import { setNightClock, useNightStore, userKeyFor } from '../../../tonight/nightStore';

jest.mock('@nomad/api-decide', () => ({
  ...jest.requireActual('@nomad/api-decide'),
  putKaraokeLog: jest.fn(),
  deleteKaraokeLog: jest.fn(),
}));

const api = decide as jest.Mocked<typeof decide>;
const NOW = Date.UTC(2026, 9, 21, 21, 30);

beforeEach(() => {
  jest.clearAllMocks();
  appStorage.clearAll();
  setLogClock(() => NOW);
  setNightClock(() => NOW);
  useAuth.setState({ state: { status: 'signedIn', session: { token: 't', email: 'sam@example.com', createdAt: 0 } } });
  useNightStore.getState().rehydrate('sam@example.com');
  useOutbox.getState().rehydrate('sam@example.com');
  useLogStore.getState().rehydrate('sam@example.com');
  // Offline: everything stays queued so the patches can be inspected.
  api.putKaraokeLog.mockRejectedValue(new TypeError('offline'));
  api.deleteKaraokeLog.mockRejectedValue(new TypeError('offline'));
});

afterEach(async () => {
  await outboxIdle();
  useOutbox.getState().rehydrate('sam@example.com'); // drop backoff timers
});
afterAll(() => {
  setLogClock();
  setNightClock();
});

const queued = () => useOutbox.getState().items.map((i) => (i.op === 'put' ? { id: i.id, patch: i.patch } : { id: i.id, op: i.op }));

it('survey save writes to outbox with survey only for kj_ ids', async () => {
  useLogStore.getState().noteNomad('kj_0123456789abcdef01234567', { artist: 'Muse', title: 'Starlight', nightId: 'n1' });
  useLogStore.getState().saveSurvey('kj_0123456789abcdef01234567', { feel: 'great', key: 'right', crowd_pleaser: true, notes: 'again!' });
  await outboxIdle();
  expect(queued()).toEqual([
    {
      id: 'kj_0123456789abcdef01234567',
      patch: {
        survey: { feel: 'great', key: 'right', crowd_pleaser: true, notes: 'again!', answered_at: new Date(NOW).toISOString() },
      },
    },
  ]);
  expect(api.putKaraokeLog).toHaveBeenCalledWith('kj_0123456789abcdef01234567', {
    survey: expect.objectContaining({ feel: 'great' }),
  });
  // Mirrored locally and marked surveyed (never asked again).
  expect(useLogStore.getState().entries['kj_0123456789abcdef01234567']).toMatchObject({ source: 'kjbox', state: 'sung', survey: { feel: 'great' } });
  expect(useLogStore.getState().surveyed['kj_0123456789abcdef01234567']).toBe(true);
});

it('a partial survey sends only the answered fields', async () => {
  useLogStore.getState().saveSurvey('kj_x', { feel: 'bad', notes: '' });
  await outboxIdle();
  expect(queued()).toEqual([{ id: 'kj_x', patch: { survey: { feel: 'bad', answered_at: new Date(NOW).toISOString() } } }]);
});

it('kjbox owns Nomad state: setState on a kj_ id does nothing', async () => {
  useLogStore.getState().noteNomad('kj_y', { artist: 'A', title: 'T' });
  useLogStore.getState().setState('kj_y', 'skipped');
  await outboxIdle();
  expect(useLogStore.getState().entries.kj_y?.state).toBe('sung');
  expect(queued()).toEqual([]);
});

it('addOther logs an app_ entry with the Other night and sends the facts', async () => {
  useNightStore.getState().startOther('The Pub');
  const night = useNightStore.getState().active!;
  const id = useLogStore.getState().addOther({ song_key: 'sk1', artist: 'Adele', title: 'Hello' }, 'requested')!;
  expect(id).toMatch(/^app_[0-9a-f-]{36}$/);
  const night_ = { id: night.nightId, kind: 'other', venue_name: 'The Pub', date: expect.stringMatching(/^2026-10-2[12]$/) };
  expect(useLogStore.getState().entries[id]).toMatchObject({ source: 'app', state: 'requested', song_key: 'sk1', night: night_ });
  useLogStore.getState().setState(id, 'sung');
  await outboxIdle();
  expect(queued()).toEqual([
    {
      id,
      patch: { state: 'sung', artist: 'Adele', title: 'Hello', song_key: 'sk1', night: night_, sung_at: new Date(NOW).toISOString() },
    },
  ]);
  expect(appStorage.getString(`tonight.log.v1.${userKeyFor('sam@example.com')}`)).toContain(id);
});

it('remove deletes locally and queues a delete', async () => {
  const id = useLogStore.getState().addOther({ artist: 'A', title: 'T' }, 'planned')!;
  useLogStore.getState().remove(id);
  await outboxIdle();
  expect(useLogStore.getState().entries[id]).toBeUndefined();
  expect(queued()).toEqual([{ id, op: 'delete' }]);
});

it('skipped surveys persist per user', () => {
  useLogStore.getState().skipSurvey('kj_z');
  useLogStore.getState().rehydrate('other@example.com');
  expect(useLogStore.getState().surveyed).toEqual({});
  useLogStore.getState().rehydrate('sam@example.com');
  expect(useLogStore.getState().surveyed).toEqual({ kj_z: true });
});
