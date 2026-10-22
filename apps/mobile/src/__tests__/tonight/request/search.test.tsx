import * as kjbox from '@nomad/api-kjbox';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';

import { useAuth } from '../../../auth/store';
import { useNightStore } from '../../../tonight/nightStore';
import { nightPoll } from '../../../tonight/nomad/queries';
import { useRequestStore } from '../../../tonight/request/requestStore';
import { gen, session } from '../../../test-utils/genAuthMock';
import { me, nightOpen, nowResult, rotationResult, song } from '../../../test-utils/tonightFixtures';
import { confident, deferred, group, kn, local, noIdent, requestRoutes, results } from './helpers';

jest.mock('@nomad/api-decide', () => ({
  searchSongs: jest.fn(),
  popularSongs: jest.fn(async () => []),
  pingSearch: jest.fn(async () => true),
  getSong: jest.fn(),
  configureClient: jest.fn(),
}));
jest.mock('@nomad/api-gen', () => ({ ...jest.requireActual('@nomad/api-gen'), getMe: jest.fn(), listMyJobs: jest.fn() }));
jest.mock('@nomad/api-kjbox', () => ({
  ...jest.requireActual('@nomad/api-kjbox'),
  getMe: jest.fn(),
  getNow: jest.fn(),
  getRotation: jest.fn(),
  getNight: jest.fn(),
  searchSongs: jest.fn(),
  identify: jest.fn(),
  resolve: jest.fn(),
  logSearchEvent: jest.fn(async () => {}),
  submitRequest: jest.fn(),
  changeRequest: jest.fn(),
  previewResolve: jest.fn(),
  previewClose: jest.fn(async () => ({ api_version: '1.0', ok: true })),
}));

const api = kjbox as jest.Mocked<typeof kjbox>;
const NIGHT = 'aaaaaaaaaaaaaaaa';

beforeEach(async () => {
  jest.useRealTimers();
  jest.clearAllMocks();
  useRequestStore.getState().clear();
  Object.assign(nightPoll, { meMs: 60_000, nowMs: 60_000, rotationMs: 60_000, nightMs: 60_000 });
  await useAuth.getState().signInWithSession(session());
  gen.getMe.mockResolvedValue({ email: 'me@example.com', credits: 1 });
  gen.listMyJobs.mockResolvedValue([]);
  useNightStore.getState().joinNomad('2121', NIGHT, 'Andrew');
  api.getMe.mockResolvedValue(me({ songs: [song({ request: { id: 41, song_title: 'Old Song' } })] }));
  api.getNow.mockResolvedValue(nowResult());
  api.getRotation.mockResolvedValue({ etag: '"1"', data: rotationResult([]) });
  api.getNight.mockResolvedValue(nightOpen({ night_id: NIGHT }));
  api.identify.mockResolvedValue(noIdent);
  api.resolve.mockResolvedValue({ api_version: '1.0' });
});

const type = async (text: string) => fireEvent.changeText(await screen.findByTestId('tonight-search-input'), text);

it('latest response wins (A.17): a slow earlier search never replaces a newer one', async () => {
  const slow = deferred<kjbox.SearchResult>();
  api.searchSongs.mockImplementation(async (_t, q) => (q === 'starl' ? slow.promise : results([group('Hello', 'Adele')])));
  renderRouter(requestRoutes(), { initialUrl: '/tonight/search' });
  await type('starl');
  await waitFor(() => expect(api.searchSongs).toHaveBeenCalledWith('2121', 'starl', expect.any(String), NIGHT));
  await type('hello');
  expect(await screen.findByText('Hello')).toBeTruthy();
  await act(async () => slow.resolve(results([group('Starlight')])));
  expect(screen.queryByText('Starlight')).toBeNull();
  expect(screen.getByText('Hello')).toBeTruthy();
});

it('auto-correct banner with undo (A.29): resolve runs only on empty results', async () => {
  api.searchSongs.mockResolvedValue(results([]));
  api.resolve.mockResolvedValue({
    api_version: '1.0',
    corrected: { artist: 'The Strokes', title: 'Machu Picchu' },
    kind: 'content',
    typed: 'machu pichu strokes',
    songs: [group('Machu Picchu', 'The Strokes')],
  });
  renderRouter(requestRoutes(), { initialUrl: '/tonight/search' });
  await type('machu pichu strokes');
  expect(await screen.findByTestId('tonight-correction')).toBeTruthy();
  expect(screen.getByTestId('tonight-result-title-0').props.children).toBe('Machu Picchu');
  fireEvent.press(screen.getByTestId('tonight-correction-undo'));
  await waitFor(() => expect(screen.queryByTestId('tonight-result-0') === null).toBe(true));
  expect(screen.getByTestId('tonight-correction-redo')).toBeTruthy();
  expect(screen.getByTestId('tonight-empty')).toBeTruthy();
  fireEvent.press(screen.getByTestId('tonight-correction-redo'));
  expect(await screen.findByTestId('tonight-result-0')).toBeTruthy();
});

it('does not run the auto-correct when the search found songs', async () => {
  api.searchSongs.mockResolvedValue(results([group('Starlight')]));
  renderRouter(requestRoutes(), { initialUrl: '/tonight/search' });
  await type('starlight');
  expect(await screen.findByTestId('tonight-result-0')).toBeTruthy();
  expect(api.resolve).not.toHaveBeenCalled();
});

it('no-karaoke card on confident identify (A.31), near-misses capped at 3, make routes to /tonight/make (E5-R7)', async () => {
  api.searchSongs.mockResolvedValue(results(['A', 'B', 'C', 'D', 'E'].map((x) => group(`Machu ${x}`, 'Other'))));
  api.identify.mockResolvedValue(confident('Machu Picchu', 'The Strokes'));
  const { getPathname, getSearchParams } = renderRouter(requestRoutes(), { initialUrl: '/tonight/search' });
  await type('machu picchu strokes');
  expect(await screen.findByTestId('tonight-no-karaoke')).toBeTruthy();
  expect(screen.getByTestId('tonight-similar-heading')).toBeTruthy();
  expect(screen.queryByTestId('tonight-result-3')).toBeNull();
  expect(screen.getByTestId('tonight-results-more')).toBeTruthy();
  expect(screen.queryByTestId('tonight-make-bar')).toBeNull();
  fireEvent.press(screen.getByTestId('tonight-no-karaoke-make'));
  expect(await screen.findByTestId('tonight-make-stub')).toBeTruthy();
  expect(getPathname()).toBe('/tonight/make');
  expect(getSearchParams()).toMatchObject({ artist: 'The Strokes', title: 'Machu Picchu' });
  expect(api.logSearchEvent).toHaveBeenCalledWith('2121', expect.objectContaining({ action: 'make_offer_tap', data: { where: 'missing_card' } }));
});

it('the karaoke:true veto: no no-karaoke card, and the identified song\'s own rows show', async () => {
  api.searchSongs.mockImplementation(async (_t, q) =>
    q === 'The Killers Mr. Brightside' ? results([group('Mr. Brightside', 'The Killers')]) : results([group('Killers Song', 'Killers')]),
  );
  api.identify.mockResolvedValue(confident('Mr. Brightside', 'The Killers', true, 'content'));
  renderRouter(requestRoutes(), { initialUrl: '/tonight/search' });
  await type('brightside');
  expect(await screen.findByTestId('tonight-identified-heading')).toBeTruthy();
  expect(screen.getByTestId('tonight-result-title-0').props.children).toBe('Mr. Brightside');
  expect(screen.queryByTestId('tonight-no-karaoke')).toBeNull();
});

describe('search the identified song (the web\'s fetchKaraokeForCorrection)', () => {
  const starlight = async (karaoke: boolean, found: kjbox.SearchSong[]) => {
    api.searchSongs.mockImplementation(async (_t, q) => (q === 'Muse Starlight' ? results(found) : results([])));
    api.identify.mockResolvedValue(confident('Starlight', 'Muse', karaoke, 'content'));
    renderRouter(requestRoutes(), { initialUrl: '/tonight/search' });
    await type('starlite muse');
    await waitFor(() => expect(api.searchSongs).toHaveBeenCalledWith('2121', 'Muse Starlight', expect.any(String), NIGHT));
  };

  it('"starlite muse" with karaoke:true and an empty typed search shows Muse "Starlight", no empty state', async () => {
    await starlight(true, [group('Starlight', 'Muse')]);
    expect(await screen.findByTestId('tonight-result-0')).toBeTruthy();
    expect(screen.getByTestId('tonight-result-title-0').props.children).toBe('Starlight');
    expect(screen.queryByTestId('tonight-empty')).toBeNull();
    expect(screen.queryByTestId('tonight-no-karaoke')).toBeNull();
    expect(api.resolve).not.toHaveBeenCalled();
  });

  it('the same with karaoke:false and nothing found shows the no-karaoke card', async () => {
    await starlight(false, []);
    expect(await screen.findByTestId('tonight-no-karaoke')).toBeTruthy();
    expect(screen.queryByTestId('tonight-empty')).toBeNull();
  });

  it('holds the empty state and the card while that search runs', async () => {
    const pending = deferred<kjbox.SearchResult>();
    api.searchSongs.mockImplementation(async (_t, q) => (q === 'Muse Starlight' ? pending.promise : results([])));
    api.identify.mockResolvedValue(confident('Starlight', 'Muse', false, 'content'));
    renderRouter(requestRoutes(), { initialUrl: '/tonight/search' });
    await type('starlite muse');
    await waitFor(() => expect(api.searchSongs).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId('tonight-empty')).toBeNull();
    expect(screen.queryByTestId('tonight-no-karaoke')).toBeNull();
    await act(async () => pending.resolve(results([])));
    expect(await screen.findByTestId('tonight-no-karaoke')).toBeTruthy();
  });
});

it('make bar when not confident (A.32); none when the identified song is in the rows', async () => {
  api.searchSongs.mockResolvedValue(results([group('Starlight')]));
  renderRouter(requestRoutes(), { initialUrl: '/tonight/search' });
  await type('starl');
  expect(await screen.findByTestId('tonight-make-bar')).toBeTruthy();

  api.identify.mockResolvedValue(confident('Starlight', 'Muse', true));
  await type('starlight muse');
  await waitFor(() => expect(api.searchSongs).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.queryByTestId('tonight-make-bar') === null).toBe(true));
});

it('make offers say "Ask the host" when make-it is off (A.78)', async () => {
  api.searchSongs.mockResolvedValue(results([], { make_requests_enabled: false }));
  renderRouter(requestRoutes(), { initialUrl: '/tonight/search' });
  await type('zzzz unknown');
  expect(await screen.findByTestId('tonight-ask-host')).toBeTruthy();
  expect(screen.queryByTestId('tonight-empty-make')).toBeNull();
});

it('"Request this song" auto-selects the best version by default (E5-R2) and opens confirm', async () => {
  api.searchSongs.mockResolvedValue(results([group('Starlight', 'Muse', [kn(1), kn(2), kn(3)])]));
  renderRouter(requestRoutes(), { initialUrl: '/tonight/search' });
  await type('starlight');
  const cta = await screen.findByTestId('tonight-result-request-0');
  expect(screen.getByTestId('tonight-version-0-0-best')).toBeTruthy();
  fireEvent.press(cta);
  expect(await screen.findByTestId('tonight-confirm')).toBeTruthy();
  expect(useRequestStore.getState().pending?.version).toBe('auto');
  expect(screen.getByTestId('tonight-confirm-source').props.children).toBe("We'll pick the best version for you.");
});

it('a double tap on "Request this song" pushes confirm once', async () => {
  api.searchSongs.mockResolvedValue(results([group('Starlight', 'Muse', [kn(1), kn(2)])]));
  const { getPathname } = renderRouter(requestRoutes(), { initialUrl: '/tonight/search' });
  await type('starlight');
  const cta = await screen.findByTestId('tonight-result-request-0');
  await act(async () => jest.advanceTimersByTimeAsync(400)); // renderRouter runs on fake timers: leave the arm window
  fireEvent.press(cta);
  fireEvent.press(cta);
  expect(await screen.findByTestId('tonight-confirm')).toBeTruthy();
  fireEvent.press(screen.getByTestId('tonight-confirm-back'));
  await waitFor(() => expect(getPathname()).toBe('/tonight/search'));
  expect(screen.queryByTestId('tonight-confirm') === null).toBe(true);
});

it('a tap right after the list changed is queued, then lands (E5-R1)', async () => {
  api.searchSongs.mockResolvedValue(results([group('Starlight', 'Muse', [kn(1), kn(2)])]));
  renderRouter(requestRoutes(), { initialUrl: '/tonight/search' });
  await type('starlight');
  fireEvent.press(await screen.findByTestId('tonight-result-request-0')); // inside the arm window
  expect(screen.queryByTestId('tonight-confirm')).toBeNull();
  expect(await screen.findByTestId('tonight-confirm')).toBeTruthy();
});

describe('change mode (A.39, E5-R4)', () => {
  it('shows "Replacing {title}" and hides make offers', async () => {
    api.searchSongs.mockResolvedValue(results([]));
    renderRouter(requestRoutes(), { initialUrl: '/tonight/search?change=41&replacing=Old%20Song' });
    expect(await screen.findByTestId('tonight-replacing')).toBeTruthy();
    expect(screen.getByText('Replacing ⁨Old Song⁩')).toBeTruthy();
    expect(useRequestStore.getState()).toMatchObject({ mode: 'change', replaces: { id: 41, title: 'Old Song' } });
    await type('zzzz unknown');
    expect(await screen.findByTestId('tonight-ask-host')).toBeTruthy();
  });

  it('is cleared when the singer leaves search', async () => {
    api.searchSongs.mockResolvedValue(results([]));
    renderRouter(requestRoutes(), { initialUrl: '/tonight' });
    const { router } = jest.requireActual<typeof import('expo-router')>('expo-router');
    act(() => router.push('/tonight/search?change=41&replacing=Old%20Song'));
    expect(await screen.findByTestId('tonight-replacing')).toBeTruthy();
    fireEvent.press(screen.getByTestId('tonight-replacing-keep'));
    await waitFor(() => expect(useRequestStore.getState().mode).toBe('new'), { timeout: 2000 });
  });
});

it('▶ on a version previews its source in a sheet; Close releases its token (E10)', async () => {
  api.searchSongs.mockResolvedValue(results([group('Starlight', 'Muse', [local('/lib/starlight.mp4')])]));
  api.previewResolve.mockResolvedValue({ api_version: '1.0', mode: 'cdg', title: 'Starlight', token: 'k9' });
  renderRouter(requestRoutes(), { initialUrl: '/tonight/search' });
  await type('starlight');
  const play = await screen.findByTestId('tonight-version-0-0-preview');
  await act(async () => fireEvent.press(play));
  expect(api.previewResolve).toHaveBeenCalledWith('2121', 'local', undefined, NIGHT, {
    file_path: '/lib/starlight.mp4',
    title: 'Starlight — Muse',
  });
  expect(await screen.findByTestId('tonight-preview-web')).toBeTruthy();
  fireEvent.press(screen.getByTestId('tonight-preview-close'));
  await waitFor(() => expect(api.previewClose).toHaveBeenCalledWith('2121', 'k9', NIGHT));
});
