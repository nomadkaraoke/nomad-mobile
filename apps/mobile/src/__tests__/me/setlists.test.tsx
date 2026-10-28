// setlists: list, detail, add-to-setlist sheet, reorder (Phase 4a, B11).
import * as decide from '@nomad/api-decide';
import { fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { Alert, Platform } from 'react-native';
import { renderRouter } from 'expo-router/testing-library';

import { useSearch } from '../../find/useSearch';
import { AddToSetlistSheet } from '../../me/AddToSetlistSheet';
import { useMeOutbox } from '../../me/meOutbox';
import { gen } from '../../test-utils/genAuthMock';
import { appRoutes } from '../../test-utils/routes';
import { renderTonight } from '../../test-utils/tonightFixtures';
import { resetMe } from './helpers';

jest.setTimeout(20_000);

// The real List, with its props captured per testID.
const mockListProps: Record<string, Record<string, unknown>> = {};
jest.mock('@nomad/ui', () => {
  const actual = jest.requireActual('@nomad/ui');
  const React = jest.requireActual('react');
  const List = React.forwardRef(function MockList(props: { testID: string }, ref: unknown) {
    mockListProps[props.testID] = props;
    return React.createElement(actual.List, { ...props, ref });
  });
  return { ...actual, List };
});

jest.mock('@nomad/api-decide', () => ({
  ...jest.requireActual('@nomad/api-decide'),
  listSetlists: jest.fn(),
  createSetlist: jest.fn(),
  putSetlistItems: jest.fn(),
  renameSetlist: jest.fn(),
  deleteSetlist: jest.fn(),
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


const api = decide as jest.Mocked<typeof decide>;
const { ApiError } = jest.requireActual<typeof decide>('@nomad/api-decide');
const mockSearch = useSearch as jest.Mock;

const item = (n: number, o: Record<string, unknown> = {}) => ({
  item_id: `it_${n}`, song_key: `sk_${n}`, artist: `Band ${n}`, title: `Song ${n}`, added_at: '2026-10-01T00:00:00Z', facets: { has_karaoke: true, community: true }, ...o,
});
const setlist = (id: string, name: string, items: ReturnType<typeof item>[]) => ({
  id, name, description: null, song_ids: [], song_count: items.length, items, rev: 1, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
});
const SEED = 'pl_seed0001';
const queuedFor = (id: string) => useMeOutbox.getState().items.find((i) => i.key === `setlist:${id}`) as { items: { title?: string; song_key?: string | null }[] } | undefined;

beforeEach(() => {
  jest.clearAllMocks();
  resetMe('me@example.com');
  gen.getMe.mockResolvedValue({ email: 'me@example.com', credits: 3 } as never);
  api.listSetlists.mockResolvedValue([setlist(SEED, 'Friday', [item(1), item(2), item(3)])] as never);
  for (const f of [api.createSetlist, api.putSetlistItems, api.renameSetlist, api.deleteSetlist]) (f as jest.Mock).mockRejectedValue(new ApiError(0, 'offline'));
  mockSearch.mockReturnValue({ groups: [], identification: null, resolve: null, query: '', resultsQuery: '', loading: false, source: 'cloud', error: null, retry: jest.fn(), offline: false, warmingUp: false });
});

describe('setlists list', () => {
  it('create makes a setlist that appears with 0 songs', async () => {
    api.listSetlists.mockResolvedValue([]);
    renderRouter(appRoutes(), { initialUrl: '/me/setlists' });
    fireEvent.press(await screen.findByTestId('setlists-new'));
    fireEvent.changeText(screen.getByTestId('setlist-name-input'), 'Karaoke night');
    fireEvent.press(screen.getByTestId('setlist-name-save'));
    const row = await screen.findByText(/Karaoke night/);
    expect(row).toBeTruthy();
    expect(screen.getByTestId(/^setlists-row-pl_/)).toHaveTextContent(/No songs/);
  });

  it('shows name and count per row', async () => {
    renderRouter(appRoutes(), { initialUrl: '/me/setlists' });
    const row = await screen.findByTestId(`setlists-row-${SEED}`);
    expect(row).toHaveTextContent(/Friday/);
    expect(row).toHaveTextContent(/3 songs/);
  });
});

describe('setlist detail', () => {
  it('reorders (down on the first) and saves the new order', async () => {
    renderRouter(appRoutes(), { initialUrl: `/me/setlists/${SEED}` });
    await screen.findByTestId('setlist-item-0');
    fireEvent.press(screen.getByTestId('setlist-edit-order'));
    fireEvent.press(screen.getByTestId('setlist-item-down-0'));
    fireEvent.press(screen.getByTestId('setlist-order-save'));
    await waitFor(() => expect(queuedFor(SEED)?.items.map((x) => x.title)).toEqual(['Song 2', 'Song 1', 'Song 3']));
    expect(screen.queryByTestId('setlist-order-save')).toBeNull();
  });

  it('the setlist list lets rows move when the header changes height (Edit order keeps the name and buttons in view)', async () => {
    renderRouter(appRoutes(), { initialUrl: `/me/setlists/${SEED}` });
    await screen.findByTestId('setlist-item-0');
    expect(mockListProps['setlist-items']?.showNewRowsAtTop).toBe(true);
    fireEvent.press(screen.getByTestId('setlist-edit-order'));
    expect(mockListProps['setlist-items']?.showNewRowsAtTop).toBe(true);
  });

  it('Mark as sung on a row offers the survey after Save (the sheet is not remounted when it closes)', async () => {
    const orig = Platform.OS;
    Platform.OS = 'android'; // the survey opens straight from Save (iOS waits for the sheet's onDismiss)
    try {
      renderRouter(appRoutes(), { initialUrl: `/me/setlists/${SEED}` });
      fireEvent.press(await screen.findByTestId('setlist-item-sung-0'));
      fireEvent.press(await screen.findByTestId('mark-when-ago'));
      fireEvent.press(screen.getByTestId('mark-save'));
      expect(await screen.findByTestId('survey-save')).toBeTruthy();
    } finally {
      Platform.OS = orig;
    }
  });

  it('Mark as sung closed without saving starts the next song from Tonight', async () => {
    renderRouter(appRoutes(), { initialUrl: `/me/setlists/${SEED}` });
    fireEvent.press(await screen.findByTestId('setlist-item-sung-0'));
    fireEvent.press(await screen.findByTestId('mark-when-ago'));
    fireEvent.press(screen.getByTestId('mark-sung-close'));
    fireEvent.press(screen.getByTestId('setlist-item-sung-1'));
    expect((await screen.findByTestId('mark-when-tonight')).props.accessibilityState).toMatchObject({ selected: true });
  });

  it('delete confirms, then the setlist is gone', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    renderRouter(appRoutes(), { initialUrl: `/me/setlists/${SEED}` });
    await screen.findByTestId('setlist-item-0');
    fireEvent.press(screen.getByTestId('setlist-delete'));
    expect(alert).toHaveBeenCalled();
    const buttons = alert.mock.calls[0]![2]!;
    buttons.find((b) => b.style === 'destructive')!.onPress!();
    await waitFor(() => expect(useMeOutbox.getState().items.some((i) => i.op === 'delete' && i.id === SEED)).toBe(true));
    expect(await screen.findByTestId('setlists')).toBeTruthy();
    expect(screen.queryByTestId('setlist-not-found')).toBeNull();
    expect(screen.queryByTestId(`setlists-row-${SEED}`)).toBeNull();
    alert.mockRestore();
  });

  it('a reorder refused at 500 songs stays in edit mode with the full message', async () => {
    const big = Array.from({ length: 501 }, (_, n) => item(n + 1));
    api.listSetlists.mockResolvedValue([setlist(SEED, 'Big', big)] as never);
    renderRouter(appRoutes(), { initialUrl: `/me/setlists/${SEED}` });
    await screen.findByTestId('setlist-item-0');
    fireEvent.press(screen.getByTestId('setlist-edit-order'));
    fireEvent.press(screen.getByTestId('setlist-item-down-0'));
    fireEvent.press(screen.getByTestId('setlist-order-save'));
    expect(await screen.findByTestId('setlist-full')).toBeTruthy();
    expect(screen.getByTestId('setlist-order-save')).toBeTruthy();
    expect(queuedFor(SEED)).toBeUndefined();
  });

  it('removes an item', async () => {
    renderRouter(appRoutes(), { initialUrl: `/me/setlists/${SEED}` });
    await screen.findByTestId('setlist-item-0');
    fireEvent.press(screen.getByTestId('setlist-item-remove-1'));
    await waitFor(() => expect(queuedFor(SEED)?.items.map((x) => x.title)).toEqual(['Song 1', 'Song 3']));
  });

  it('shows Make it only for songs without a karaoke version', async () => {
    api.listSetlists.mockResolvedValue([setlist(SEED, 'Friday', [item(1), item(2, { facets: { has_karaoke: false } }), item(3, { facets: null })])] as never);
    renderRouter(appRoutes(), { initialUrl: `/me/setlists/${SEED}` });
    await screen.findByTestId('setlist-item-0');
    expect(screen.queryByTestId('setlist-item-make-0')).toBeNull();
    expect(screen.getByTestId('setlist-item-make-1')).toBeTruthy();
    expect(screen.getByTestId('setlist-item-make-2')).toBeTruthy();
  });

  it('legacy items with empty names show the song key', async () => {
    api.listSetlists.mockResolvedValue([setlist(SEED, 'Friday', [item(1, { artist: '', title: '', song_key: 'legacy_key' })])] as never);
    renderRouter(appRoutes(), { initialUrl: `/me/setlists/${SEED}` });
    expect(await screen.findByTestId('setlist-item-0')).toHaveTextContent(/legacy_key/);
  });

  it('the free-text add creates an item with song_key null', async () => {
    renderRouter(appRoutes(), { initialUrl: `/me/setlists/${SEED}` });
    await screen.findByTestId('setlist-item-0');
    fireEvent.press(screen.getByTestId('setlist-add'));
    fireEvent.changeText(screen.getByTestId('setlist-search-input'), 'Made Up Band - Invented Song');
    fireEvent.press(await screen.findByTestId('setlist-search-typed'));
    await waitFor(() => expect(queuedFor(SEED)?.items).toHaveLength(4));
    expect(queuedFor(SEED)!.items[3]).toMatchObject({ title: 'Invented Song', artist: 'Made Up Band', song_key: null });
  });

  it('free text with no dash or "by" is added under the Unknown Artist sentinel', async () => {
    renderRouter(appRoutes(), { initialUrl: `/me/setlists/${SEED}` });
    await screen.findByTestId('setlist-item-0');
    fireEvent.press(screen.getByTestId('setlist-add'));
    fireEvent.changeText(screen.getByTestId('setlist-search-input'), 'Invented Tune');
    fireEvent.press(await screen.findByTestId('setlist-search-typed'));
    await waitFor(() => expect(queuedFor(SEED)?.items).toHaveLength(4));
    expect(queuedFor(SEED)!.items[3]).toMatchObject({ title: 'Invented Tune', artist: 'Unknown Artist', song_key: null });
  });

  it('adds a search result with its song_key', async () => {
    mockSearch.mockReturnValue({
      groups: [{ song_key: 'sk_9', artist: 'Band 9', title: 'Song 9', version_count: 1, versions: [] }],
      identification: null, resolve: null, query: 'song 9', resultsQuery: 'song 9', loading: false, source: 'cloud', error: null, retry: jest.fn(), offline: false, warmingUp: false,
    });
    renderRouter(appRoutes(), { initialUrl: `/me/setlists/${SEED}` });
    await screen.findByTestId('setlist-item-0');
    fireEvent.press(screen.getByTestId('setlist-add'));
    fireEvent.changeText(screen.getByTestId('setlist-search-input'), 'song 9');
    fireEvent.press(await screen.findByTestId('setlist-search-row-0'));
    await waitFor(() => expect(queuedFor(SEED)?.items[3]).toMatchObject({ song_key: 'sk_9', title: 'Song 9' }));
  });
});

describe('AddToSetlistSheet', () => {
  const SONG = { artist: 'Band 2', title: 'Song 2', song_key: 'sk_2' };

  it('ticks the setlists that already have the song; done applies changes', async () => {
    api.listSetlists.mockResolvedValue([setlist(SEED, 'Friday', [item(1), item(2)]), setlist('pl_other001', 'Sunday', [item(5)])] as never);
    const onClose = jest.fn();
    renderTonight(<AddToSetlistSheet song={SONG} onClose={onClose} />);
    const friday = await screen.findByTestId(`add-setlist-${SEED}`);
    expect(friday.props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.getByTestId('add-setlist-pl_other001').props.accessibilityState).toMatchObject({ checked: false });
    fireEvent.press(screen.getByTestId('add-setlist-pl_other001'));
    fireEvent.press(friday); // untick
    fireEvent.press(screen.getByTestId('add-setlist-done'));
    await waitFor(() => expect(queuedFor('pl_other001')?.items.map((x) => x.title)).toEqual(['Song 5', 'Song 2']));
    expect(queuedFor(SEED)?.items.map((x) => x.title)).toEqual(['Song 1']);
    expect(onClose).toHaveBeenCalled();
  });

  it('creates a new setlist and adds the song to it', async () => {
    api.listSetlists.mockResolvedValue([]);
    renderTonight(<AddToSetlistSheet song={SONG} onClose={jest.fn()} />);
    fireEvent.changeText(await screen.findByTestId('add-setlist-new-input'), 'Fresh');
    fireEvent.press(screen.getByTestId('add-setlist-new'));
    const q = useMeOutbox.getState().items.find((i) => i.op === 'save') as { name: string; items: { title?: string }[] };
    expect(q.name).toBe('Fresh');
    expect(q.items.map((x) => x.title)).toEqual(['Song 2']);
    expect(within(screen.getByTestId('add-to-setlist')).getByText(/Fresh/)).toBeTruthy();
  });
});
