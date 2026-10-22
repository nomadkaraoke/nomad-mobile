// Pending make records: the 24 h replay window and per-night purge (fix round 2, item 1).
import { appStorage } from '../../../storage';
import { useNightStore } from '../../../tonight/nightStore';
import {
  getPendingMake,
  installPendingMakePurge,
  PENDING_MAKE_TTL_MS,
  purgePendingMakes,
  setPendingMake,
  type PendingMake,
} from '../../../tonight/make/pendingMake';

const SONG = { artist: 'Muse', title: 'Starlight' };
const rec = (at = Date.now()): PendingMake => ({
  clientRequestId: 'id-1',
  sourceMeta: { search_session_id: 's1', selection_index: 0 },
  songArtist: 'Muse',
  songTitle: 'Starlight',
  at,
});
const raw = (userKey: string, nightId: string) => appStorage.getString(`tonight.make.pending.v1.${userKey}.${nightId}`);

beforeEach(() => {
  purgePendingMakes(null);
  useNightStore.setState({ active: null });
});

it('a record older than the box replay window (24 h) is dropped and purged', () => {
  setPendingMake('u1', 'nightA', SONG, rec(Date.now() - PENDING_MAKE_TTL_MS - 1000));
  expect(raw('u1', 'nightA')).toBeDefined();
  expect(getPendingMake('u1', 'nightA', SONG)).toBeNull();
  expect(raw('u1', 'nightA')).toBeUndefined();
  expect(PENDING_MAKE_TTL_MS).toBe(24 * 60 * 60 * 1000);
});

it('a fresh record is kept', () => {
  setPendingMake('u1', 'nightA', SONG, rec());
  expect(getPendingMake('u1', 'nightA', SONG)?.clientRequestId).toBe('id-1');
});

it('purging keeps only the current night, for every account', () => {
  setPendingMake('u1', 'nightA', SONG, rec());
  setPendingMake('u2', 'nightA', SONG, rec());
  setPendingMake('u1', 'nightB', SONG, rec());
  purgePendingMakes('nightB');
  expect(raw('u1', 'nightA')).toBeUndefined();
  expect(raw('u2', 'nightA')).toBeUndefined();
  expect(raw('u1', 'nightB')).toBeDefined();
});

it('on app open and on every night change, other nights are purged', () => {
  setPendingMake('u1', 'nightA', SONG, rec());
  setPendingMake('u1', 'nightB', SONG, rec());
  useNightStore.setState({ active: { kind: 'nomad', code: '2121', nightId: 'nightB', kjName: 'A', joinedAt: 0 } });
  const stop = installPendingMakePurge(); // app open
  try {
    expect(raw('u1', 'nightA')).toBeUndefined();
    expect(raw('u1', 'nightB')).toBeDefined();
    useNightStore.setState({ active: { kind: 'nomad', code: '2121', nightId: 'nightC', kjName: 'A', joinedAt: 0 } });
    expect(raw('u1', 'nightB')).toBeUndefined();
  } finally {
    stop();
  }
});
