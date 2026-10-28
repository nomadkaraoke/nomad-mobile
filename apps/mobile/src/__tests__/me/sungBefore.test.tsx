// sungBefore: the bulk "songs I've sung" picker at /me/sung-before (Phase 4a, B10).
import * as decide from '@nomad/api-decide';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';

import { useAuth } from '../../auth/store';
import { loadRecsSnapshot, saveRecsSnapshot } from '../../discover/recsSnapshot';
import { useSearch } from '../../find/useSearch';
import { useLogStore } from '../../tonight/log/logStore';
import { gen } from '../../test-utils/genAuthMock';
import { appRoutes } from '../../test-utils/routes';
import { resetMe, li } from './helpers';

jest.setTimeout(20_000);

jest.mock('@nomad/api-decide', () => ({
  ...jest.requireActual('@nomad/api-decide'),
  getLibrary: jest.fn(),
  popularSongs: jest.fn(async () => []),
  pingSearch: jest.fn(async () => true),
  logSearchEvent: jest.fn(async () => {}),
  configureClient: jest.fn(),
  getOfflineIndexManifest: jest.fn(async () => ({ bytes: 1 })),
  getServicesSummary: jest.fn(async () => ({ sources: [], capabilities: { screenshot_import: false, listenbrainz_oauth: false } })),
  getVoiceFlags: jest.fn(async () => ({ session_enabled: false, is_admin: false, voice_data: false })),
  listKaraokeLog: jest.fn(async () => ({ entries: [] })),
  putKaraokeLog: jest.fn(async () => ({})),
}));
jest.mock('@nomad/api-gen', () => ({ ...jest.requireActual('@nomad/api-gen'), getMe: jest.fn() }));
jest.mock('../../find/useSearch', () => ({ ...jest.requireActual('../../find/useSearch'), useSearch: jest.fn() }));
jest.mock('../../discover/recsSnapshot', () => {
  const actual = jest.requireActual('../../discover/recsSnapshot');
  return { ...actual, loadRecsSnapshot: jest.fn(actual.loadRecsSnapshot) };
});
// The real List, its testID recorded so the screen is known to use it.
const mockLists: string[] = [];
jest.mock('@nomad/ui', () => {
  const actual = jest.requireActual('@nomad/ui');
  const React = jest.requireActual('react');
  const List = React.forwardRef(function MockList(props: { testID: string }, ref: unknown) {
    mockLists.push(props.testID);
    return React.createElement(actual.List, { ...props, ref });
  });
  return { ...actual, List };
});
const mockSearch = useSearch as jest.Mock;
const noSearch = { groups: [], identification: null, resolve: null, query: '', resultsQuery: '', loading: false, source: 'cloud', error: null, retry: jest.fn(), offline: false, warmingUp: false };

const api = decide as jest.Mocked<typeof decide>;
const entries = () => Object.values(useLogStore.getState().entries);

beforeEach(() => {
  jest.clearAllMocks();
  mockSearch.mockReturnValue(noSearch);
  resetMe('me@example.com');
  gen.getMe.mockResolvedValue({ email: 'me@example.com', credits: 3 } as never);
  api.getLibrary.mockResolvedValue({
    status: 'ok',
    etag: 'e1',
    items: [
      li('Band A', 'Loved One', { loved: true, times_sung: 0 }),
      li('Band B', 'Loved Sung', { loved: true, times_sung: 2 }),
      li('Band C', 'Not Loved', { loved: false, times_sung: 0 }),
    ],
  } as never);
  saveRecsSnapshot(
    'me@example.com\n',
    {
      sections: [
        { id: 'songs_you_know', songs: [{ song_key: 'k_Loved One', artist: 'Band A', title: 'Loved One' }, { song_key: 'k_Imported', artist: 'Band D', title: 'Imported' }] },
        { id: 'crowd_pleasers', songs: [{ song_key: 'k_Crowd', artist: 'Band E', title: 'Crowd' }] },
      ],
      has_profile: true,
    } as never,
  );
});

describe('sungBefore', () => {
  it('with a query: search hits first, then the prefill filtered by the query, deduped; the snapshot is read once', async () => {
    mockSearch.mockImplementation((q: string) =>
      q
        ? {
            ...noSearch,
            query: q,
            resultsQuery: q,
            groups: [
              { song_key: 'k_Loved Three', artist: 'Band X', title: 'Loved Three', version_count: 1, versions: [] },
              { song_key: 'k_Loved One', artist: 'Band A', title: 'Loved One', version_count: 1, versions: [] },
            ],
          }
        : noSearch,
    );
    renderRouter(appRoutes(), { initialUrl: '/me/sung-before' });
    expect(await screen.findByTestId('sung-before-row-0')).toHaveTextContent(/Loved One/);
    expect(mockLists).toContain('sung-before-list');
    const reads = (loadRecsSnapshot as jest.Mock).mock.calls.length;
    fireEvent.changeText(screen.getByTestId('sung-before-search'), 'l');
    fireEvent.changeText(screen.getByTestId('sung-before-search'), 'lo');
    fireEvent.changeText(screen.getByTestId('sung-before-search'), 'LOVED');
    await waitFor(() => expect(screen.getByTestId('sung-before-row-0')).toHaveTextContent(/Loved Three/));
    expect(screen.getByTestId('sung-before-row-1')).toHaveTextContent(/Loved One/);
    expect(screen.getByTestId('sung-before-row-2')).toHaveTextContent(/Loved Sung/);
    expect(screen.queryByTestId('sung-before-row-3')).toBeNull(); // "Imported" doesn't match; "Loved One" listed once
    expect((loadRecsSnapshot as jest.Mock).mock.calls.length).toBe(reads);
  });

  it('an empty query shows the whole prefill again', async () => {
    renderRouter(appRoutes(), { initialUrl: '/me/sung-before' });
    expect(await screen.findByTestId('sung-before-row-0')).toBeTruthy();
    fireEvent.changeText(screen.getByTestId('sung-before-search'), 'imported');
    await waitFor(() => expect(screen.queryByTestId('sung-before-row-1')).toBeNull());
    expect(screen.getByTestId('sung-before-row-0')).toHaveTextContent(/Imported/);
    fireEvent.changeText(screen.getByTestId('sung-before-search'), '');
    await waitFor(() => expect(screen.getByTestId('sung-before-row-2')).toHaveTextContent(/Imported/));
  });

  it('lists saved then imported songs deduped; already-sung rows are checked and disabled', async () => {
    renderRouter(appRoutes(), { initialUrl: '/me/sung-before' });
    expect(await screen.findByTestId('sung-before-row-0')).toBeTruthy();
    expect(screen.getByTestId('sung-before-row-0')).toHaveTextContent(/Loved One/);
    expect(screen.getByTestId('sung-before-row-1')).toHaveTextContent(/Loved Sung/);
    expect(screen.getByTestId('sung-before-row-2')).toHaveTextContent(/Imported/);
    expect(screen.queryByTestId('sung-before-row-3')).toBeNull();
    expect(screen.getByTestId('sung-before-row-1').props.accessibilityState).toMatchObject({ checked: true, disabled: true });
    expect(screen.getByTestId('sung-before-row-0').props.accessibilityState).toMatchObject({ checked: false, disabled: false });
  });

  it('selecting 2 and Done backfills 2 entries (times 1, unknown); the sung row is ignored', async () => {
    renderRouter(appRoutes(), { initialUrl: '/me/sung-before' });
    fireEvent.press(await screen.findByTestId('sung-before-row-0'));
    fireEvent.press(screen.getByTestId('sung-before-row-1')); // disabled
    fireEvent.press(screen.getByTestId('sung-before-row-2'));
    fireEvent.press(screen.getByTestId('sung-before-done'));
    await waitFor(() => expect(entries()).toHaveLength(2));
    expect(entries().map((e) => e.title).sort()).toEqual(['Imported', 'Loved One']);
    for (const e of entries()) expect(e).toMatchObject({ times: 1, origin: 'backfill', state: 'sung', night: { date_precision: 'unknown' } });
  });
});
