// SongHistory (Phase 4a, B9): one song's records from the mirror (or decide), with Edit and Remove.
import * as decide from '@nomad/api-decide';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import { SongHistory } from '../../me/SongHistory';
import { useLogStore } from '../../tonight/log/logStore';
import { outboxIdle, useOutbox } from '../../tonight/log/outbox';
import { renderTonight } from '../../test-utils/tonightFixtures';
import { resetMe } from './helpers';

jest.mock('@nomad/api-decide', () => ({
  ...jest.requireActual('@nomad/api-decide'),
  listKaraokeLog: jest.fn(),
  listSongHistory: jest.fn(),
  putKaraokeLog: jest.fn(async () => ({})),
  deleteKaraokeLog: jest.fn(async () => ({})),
}));
let mockDateTime: ((d: Date) => string) | null = null;
jest.mock('@nomad/i18n', () => {
  const actual = jest.requireActual('@nomad/i18n');
  return { ...actual, useFormatter: () => (mockDateTime ? { dateTime: mockDateTime } : actual.useFormatter()) };
});
const api = decide as jest.Mocked<typeof decide>;

const rec = (id: string, o: Record<string, unknown> = {}) =>
  ({
    id, user_id: 'u', source: 'app', state: 'sung', artist: 'Invented Band', title: 'Made Up Song',
    song_key: 'sk_1', song_key_status: 'resolved', updated_at: '2026-10-01T00:00:00Z', ...o,
  }) as decide.KaraokeLogEntry;

beforeEach(() => {
  jest.clearAllMocks();
  resetMe();
  api.listSongHistory.mockResolvedValue([]);
});

// Queued writes flush in the background: let them land inside act so nothing updates after the test.
afterEach(() => act(async () => { await outboxIdle(); }));

it('a backfill without a date reads "Before the app ×3"', async () => {
  api.listKaraokeLog.mockResolvedValue({
    entries: [
      rec('app_1', { origin: 'backfill', times: 3, night: { kind: 'other', date_precision: 'unknown' } }),
      rec('app_other', { title: 'Another Song', song_key: 'sk_2' }),
    ],
  });
  renderTonight(<SongHistory libraryKey="sk_1" />);
  expect(await screen.findByTestId('song-history-app_1')).toHaveTextContent(/Before the app ×3/);
  expect(screen.queryByTestId('song-history-app_other')).toBeNull();
});

it('month precision shows the month and year; venue, survey summary and notes show', async () => {
  api.listKaraokeLog.mockResolvedValue({
    entries: [
      rec('app_1', {
        origin: 'backfill',
        night: { kind: 'other', date: '2020-03', date_precision: 'month', venue_name: 'The Test Bar' },
        survey: { feel: 'great', key: 'right', crowd_pleaser: true, vibes: ['party'], notes: 'Invented note' },
      }),
    ],
  });
  renderTonight(<SongHistory libraryKey="sk_1" />);
  const row = await screen.findByTestId('song-history-app_1');
  expect(row).toHaveTextContent(/March 2020/);
  expect(row).toHaveTextContent(/The Test Bar/);
  expect(row).toHaveTextContent(/Feel: Great/);
  expect(row).toHaveTextContent(/Key: About right/);
  expect(row).toHaveTextContent(/Crowd-pleaser/);
  expect(row).toHaveTextContent(/Party/);
  expect(row).toHaveTextContent(/Invented note/);
});

it('falls back to the per-song list when the mirror is empty', async () => {
  api.listKaraokeLog.mockResolvedValue({ entries: [] });
  api.listSongHistory.mockResolvedValue([rec('app_9', { night: { kind: 'nomad' }, sung_at: '2026-09-05T20:00:00Z' })]);
  renderTonight(<SongHistory libraryKey="sk_1" />);
  expect(await screen.findByTestId('song-history-app_9')).toHaveTextContent(/Nomad night/);
  expect(api.listSongHistory).toHaveBeenCalledWith('sk_1');
});

it('a song just marked sung (still queued) shows at once, matched by library key', async () => {
  api.listKaraokeLog.mockResolvedValue({ entries: [rec('app_1')] });
  const id = useLogStore.getState().addBackfill({ artist: 'Invented Band', title: 'Made Up Song', song_key: 'sk_1' }, { times: 2, precision: 'unknown' })!;
  renderTonight(<SongHistory libraryKey="sk_1" />);
  expect(await screen.findByTestId(`song-history-${id}`)).toHaveTextContent(/Before the app ×2/);
});

it('an uncatalogued song matches by its u: key', async () => {
  api.listKaraokeLog.mockResolvedValue({
    entries: [rec('app_u', { song_key: null, song_key_status: 'unresolved', artist: 'Nobody', title: 'Odd Tune' })],
  });
  const { libraryKey } = jest.requireActual('@nomad/core');
  renderTonight(<SongHistory libraryKey={libraryKey('Nobody', 'Odd Tune', null)} />);
  expect(await screen.findByTestId('song-history-app_u')).toBeTruthy();
});

it('Edit on a kj_ record opens the survey only, with its answers; saving queues {survey} only', async () => {
  api.listKaraokeLog.mockResolvedValue({
    entries: [rec('kj_abc', { source: 'kjbox', night: { kind: 'nomad' }, survey: { feel: 'bad', reasons: ['too_hard'] } })],
  });
  renderTonight(<SongHistory libraryKey="sk_1" />);
  fireEvent.press(await screen.findByTestId('song-history-edit-kj_abc'));
  expect(await screen.findByTestId('survey')).toBeTruthy();
  expect(screen.getByTestId('survey-feel-bad').props.accessibilityState.selected).toBe(true);
  fireEvent.press(screen.getByTestId('survey-feel-great'));
  fireEvent.press(screen.getByTestId('survey-save'));
  const [item] = useOutbox.getState().items as { id: string; patch: Record<string, unknown> }[];
  expect(item!.id).toBe('kj_abc');
  expect(Object.keys(item!.patch)).toEqual(['survey']);
  expect(item!.patch.survey).toMatchObject({ feel: 'great', reasons: [] });
  await act(async () => { await outboxIdle(); });
});

it('Remove asks, then queues a delete (kj_ too) and the row disappears', async () => {
  api.listKaraokeLog.mockResolvedValue({ entries: [rec('kj_abc', { source: 'kjbox' })] });
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  renderTonight(<SongHistory libraryKey="sk_1" />);
  fireEvent.press(await screen.findByTestId('song-history-remove-kj_abc'));
  const buttons = alert.mock.calls[0]![2]!;
  act(() => buttons.find((b) => b.style === 'destructive')!.onPress!());
  expect(useOutbox.getState().items[0]).toMatchObject({ id: 'kj_abc', op: 'delete' });
  await waitFor(() => expect(screen.queryByTestId('song-history-kj_abc')).toBeNull());
});

it('renders nothing when the song has no records', async () => {
  api.listKaraokeLog.mockResolvedValue({ entries: [] });
  renderTonight(<SongHistory libraryKey="sk_1" />);
  await waitFor(() => expect(api.listSongHistory).toHaveBeenCalled());
  expect(screen.queryByTestId('song-history')).toBeNull();
});

it('a day-precision timestamp is formatted as the instant (local day), never sliced to its UTC date', async () => {
  mockDateTime = (d) => `FMT[${d.toISOString()}]`;
  api.listKaraokeLog.mockResolvedValue({ entries: [rec('app_t', { sung_at: '2026-09-05T23:30:00Z' })] });
  renderTonight(<SongHistory libraryKey="sk_1" />);
  expect(await screen.findByTestId('song-history-app_t')).toHaveTextContent(/FMT\[2026-09-05T23:30:00\.000Z\]/);
  mockDateTime = null;
});
