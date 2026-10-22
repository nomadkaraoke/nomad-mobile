// Tonight's make on the spot (spec §4.3, A.65–A.79; Task E7, rulings E7-R1..R4).
import * as kjbox from '@nomad/api-kjbox';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { View } from 'react-native';

import * as makeRoute from '../../../app/tonight/make';
import { useAuth } from '../../../auth/store';
import { useNightStore } from '../../../tonight/nightStore';
import * as signInUi from '../../../auth/signInUi';
import { clearPendingMake, getPendingMake } from '../../../tonight/make/pendingMake';
import { makeTiming } from '../../../tonight/make/sendMake';
import { nightPoll } from '../../../tonight/nomad/queries';
import { useRequestStore } from '../../../tonight/request/requestStore';
import { gen, session } from '../../../test-utils/genAuthMock';
import { bestChoice, youtube } from '../../../test-utils/makeFixtures';
import { me, nightOpen, nowResult, rotationResult, song } from '../../../test-utils/tonightFixtures';
import { requestRoutes } from '../request/helpers';

jest.mock('@nomad/api-decide', () => ({
  searchSongs: jest.fn(),
  popularSongs: jest.fn(async () => []),
  pingSearch: jest.fn(async () => true),
  getSong: jest.fn(),
  logSearchEvent: jest.fn(async () => {}),
  configureClient: jest.fn(),
}));
jest.mock('@nomad/api-gen', () => ({
  ...jest.requireActual('@nomad/api-gen'),
  getMe: jest.fn(),
  listMyJobs: jest.fn(),
  searchAudio: jest.fn(),
  matchJudge: jest.fn(),
  createJobFromSearch: jest.fn(),
}));
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
  makeSearch: jest.fn(),
  makeCheck: jest.fn(),
  makeValidateUrl: jest.fn(),
}));

const api = kjbox as jest.Mocked<typeof kjbox>;
const { KjboxError } = jest.requireActual<typeof kjbox>('@nomad/api-kjbox');
const NIGHT = 'aaaaaaaaaaaaaaaa';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const searchResult = (): kjbox.MakeSearchResult => ({
  api_version: '1.0',
  search_session_id: 'kj-s1',
  results: [bestChoice(0), youtube(1)] as unknown as kjbox.MakeAudioResult[],
});
const verdict = (over: Partial<kjbox.MakeCheckResult> = {}): kjbox.MakeCheckResult => ({
  api_version: '1.0',
  kind: 'none',
  confident: true,
  canonical_artist: 'Muse',
  canonical_title: 'Starlight',
  alternatives: [],
  needs_ai: false,
  ...over,
});
const made = (): kjbox.RequestResult => ({
  api_version: '1.0',
  auto_approved: true,
  request: {
    id: 42,
    singer_name: 'Sam',
    song_artist: 'Muse',
    song_title: 'Starlight',
    source_type: 'make',
    status: 'approved',
    created_at: null,
    linked_entry_id: 7,
    additional_singers: null,
    supersedes_request_id: null,
    media_consent: null,
    for_friend: false,
  },
});

const STARLIGHT = { artist: 'Muse', title: 'Starlight' };
const pending = () => getPendingMake(useNightStore.getState().userKey, NIGHT, STARLIGHT);
const nav = () => jest.requireActual<typeof import('expo-router')>('expo-router').router;

const routes = () => ({
  ...requestRoutes(),
  'tonight/make': makeRoute,
  'review/[id]': () => <View testID="review-stub" />,
});
const openMake = (query = 'artist=Muse&title=Starlight') => renderRouter(routes(), { initialUrl: `/tonight/make?${query}` });
const submitEnabled = () =>
  waitFor(() => expect(screen.getByTestId('tonight-make-submit')).toBeEnabled(), { timeout: 3000 });

beforeEach(async () => {
  jest.useRealTimers();
  jest.clearAllMocks();
  useRequestStore.getState().clear();
  Object.assign(nightPoll, { meMs: 60_000, nowMs: 60_000, rotationMs: 60_000, nightMs: 60_000 });
  Object.assign(makeTiming, { retryMinMs: 5, lastStartMs: 2_000 });
  await useAuth.getState().signInWithSession(session());
  gen.getMe.mockResolvedValue({ email: 'me@example.com', credits: 0 });
  gen.listMyJobs.mockResolvedValue([]);
  useNightStore.getState().joinNomad('2121', NIGHT, 'Andrew');
  for (const w of [STARLIGHT, { ...STARLIGHT, friend: 'Alex' }]) clearPendingMake(useNightStore.getState().userKey, NIGHT, w);
  api.getMe.mockResolvedValue(me());
  api.getNow.mockResolvedValue(nowResult());
  api.getRotation.mockResolvedValue({ etag: '"1"', data: rotationResult([]) });
  api.getNight.mockResolvedValue(nightOpen({ night_id: NIGHT }));
  api.makeSearch.mockResolvedValue(searchResult());
  api.makeCheck.mockResolvedValue(verdict());
  api.makeValidateUrl.mockResolvedValue({ api_version: '1.0', supported: true });
  api.submitRequest.mockResolvedValue(made());
});

it('make submits through kjbox', async () => {
  const { QueryClient } = jest.requireActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');
  const invalidate = jest.spyOn(QueryClient.prototype, 'invalidateQueries');
  const { getPathname } = openMake();
  await submitEnabled();
  // The audio search and the judge go through the box (show credit, the box's rate limits), never gen directly.
  expect(api.makeSearch).toHaveBeenCalledWith('2121', 'Muse', 'Starlight', NIGHT);
  expect(api.makeCheck).toHaveBeenCalledWith('2121', expect.objectContaining({ artist: 'Muse', title: 'Starlight', stage: 'fast', night_id: NIGHT }));
  expect(gen.searchAudio).not.toHaveBeenCalled();
  expect(gen.matchJudge).not.toHaveBeenCalled();
  // Free at the show: no credit balance, no checkout (A.67).
  expect(screen.queryByTestId('make-cost')).toBeNull();
  fireEvent.press(screen.getByTestId('tonight-make-submit'));
  await waitFor(() => expect(getPathname()).toBe('/tonight'));
  expect(api.submitRequest).toHaveBeenCalledTimes(1);
  const [code, body] = api.submitRequest.mock.calls[0]!;
  expect(code).toBe('2121');
  expect(body).toMatchObject({
    source_type: 'make',
    song_artist: 'Muse',
    song_title: 'Starlight',
    night_id: NIGHT,
    source_meta: { search_session_id: 'kj-s1', selection_index: 0 },
  });
  expect(body.client_request_id).toMatch(UUID);
  expect(body.for_friend).toBeUndefined();
  expect(gen.createJobFromSearch).not.toHaveBeenCalled();
  // E7-R3: the night queries are invalidated; the new "Being made" row arrives through /me.
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['kjbox', useNightStore.getState().userKey, NIGHT] });
  invalidate.mockRestore();
});

it('a pasted YouTube link is checked by the box, then sent as source_meta.youtube_url', async () => {
  openMake();
  await submitEnabled();
  fireEvent.press(screen.getByTestId('youtube-toggle'));
  fireEvent.changeText(screen.getByTestId('make-youtube-input'), 'https://youtu.be/abc');
  fireEvent.press(screen.getByTestId('tonight-make-submit'));
  await waitFor(() => expect(api.submitRequest).toHaveBeenCalled());
  expect(api.makeValidateUrl).toHaveBeenCalledWith('2121', 'https://youtu.be/abc', NIGHT);
  expect(api.submitRequest.mock.calls[0]![1]).toMatchObject({ source_type: 'make', source_meta: { youtube_url: 'https://youtu.be/abc' } });
});

describe('make hidden when features.make false shows ask the host (A.78, ruling E7-R1)', () => {
  it.each([
    ['make off', { make: false, simple_mode: false }],
    ['Simple Mode', { make: true, simple_mode: true }],
  ])('%s', async (_label, flags) => {
    api.getNight.mockResolvedValue(
      nightOpen({ night_id: NIGHT, features: { ask_photo_consent: false, quick_version: true, tips: true, ...flags } }),
    );
    openMake();
    expect(await screen.findByTestId('tonight-make-ask-host')).toHaveTextContent('Ask the host: they may be able to get it for you.');
    expect(screen.queryByTestId('tonight-make-submit')).toBeNull();
    expect(api.makeSearch).not.toHaveBeenCalled();
  });

  it('the box says make_disabled mid-flow: ask the host too', async () => {
    api.makeSearch.mockRejectedValue(new KjboxError('make_disabled', 400));
    openMake();
    expect(await screen.findByTestId('tonight-make-ask-host')).toBeTruthy();
  });
});

it('youtube_blocked copy', async () => {
  api.submitRequest.mockRejectedValue(new KjboxError('youtube_blocked', 400));
  const { getPathname } = openMake();
  await submitEnabled();
  fireEvent.press(screen.getByTestId('tonight-make-submit'));
  expect(await screen.findByTestId('tonight-make-error')).toHaveTextContent(
    'YouTube is blocking downloads right now. Pick another audio source or a song from the list.',
  );
  expect(getPathname()).toBe('/tonight/make');
});

it.each([
  ['gen_rejected', "We couldn't start making that song. Ask the host."],
  ['already_generating', "That song is already being made. It will join the rotation once it's ready."],
] as const)('%s has its own copy', async (code, copy) => {
  api.submitRequest.mockRejectedValue(new KjboxError(code, code === 'gen_rejected' ? 400 : 409));
  openMake();
  await submitEnabled();
  fireEvent.press(screen.getByTestId('tonight-make-submit'));
  expect(await screen.findByTestId('tonight-make-error')).toHaveTextContent(copy);
});

it('busy_retry keeps retrying with the same client_request_id and says "Still working…"', async () => {
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  api.submitRequest.mockImplementation(async () => {
    calls += 1;
    if (calls === 1) throw new KjboxError('internal', 0, undefined, {}, true); // timed out: the box is still on it
    if (calls < 4) throw new KjboxError('busy_retry', 409, 0);
    await gate;
    return made();
  });
  const { getPathname } = openMake();
  await submitEnabled();
  fireEvent.press(screen.getByTestId('tonight-make-submit'));
  expect(await screen.findByTestId('tonight-make-still-working')).toHaveTextContent('Still working…');
  await waitFor(() => expect(calls).toBe(4));
  // A second tap while it is still working sends nothing new.
  fireEvent.press(screen.getByTestId('tonight-make-submit'));
  await act(async () => release());
  await waitFor(() => expect(getPathname()).toBe('/tonight'));
  const ids = api.submitRequest.mock.calls.map(([, b]) => b.client_request_id);
  expect(ids).toHaveLength(4);
  expect(new Set(ids).size).toBe(1);
});

it('gives up after the retry budget, keeping the id for the next tap', async () => {
  Object.assign(makeTiming, { retryMinMs: 5, lastStartMs: 60 });
  api.submitRequest.mockRejectedValue(new KjboxError('busy_retry', 409, 0));
  openMake();
  await submitEnabled();
  fireEvent.press(screen.getByTestId('tonight-make-submit'));
  expect(await screen.findByTestId('tonight-make-error')).toHaveTextContent(/may already be on its way.*Your songs/);
  expect(screen.getByTestId('tonight-make-error')).not.toHaveTextContent(/tap/i);
  const n = api.submitRequest.mock.calls.length;
  api.submitRequest.mockResolvedValue(made());
  fireEvent.press(screen.getByTestId('tonight-make-submit'));
  await waitFor(() => expect(api.submitRequest.mock.calls.length).toBe(n + 1));
  const ids = new Set(api.submitRequest.mock.calls.map(([, b]) => b.client_request_id));
  expect(ids.size).toBe(1);
});

it('a kjbox unauthenticated never signs out (gen decides through its own session check)', async () => {
  api.submitRequest.mockRejectedValue(new KjboxError('unauthenticated', 401));
  openMake();
  await submitEnabled();
  fireEvent.press(screen.getByTestId('tonight-make-submit'));
  expect(await screen.findByTestId('tonight-make-error')).toHaveTextContent(/sign-in needs refreshing/);
  // Asks gen whether the session is still good; gen's 401 (not kjbox's) is what signs out.
  await waitFor(() => expect(gen.getMe).toHaveBeenCalled());
  expect(useAuth.getState().state.status).toBe('signedIn');
});

it('ETA copy promises about 30 minutes, not a fixed time (ruling E7-R2, A.71, A.76)', async () => {
  openMake();
  await submitEnabled();
  expect(screen.getByTestId('tonight-make-eta')).toHaveTextContent(
    "It's free tonight. It usually takes about 30 minutes: we'll show it here in your songs and email it to you.",
  );
});

it('night_changed on submit ends the night and goes back to Tonight', async () => {
  api.submitRequest.mockRejectedValue(new KjboxError('night_changed', 409, undefined, { night_id: 'bbbbbbbbbbbbbbbb' }));
  const { getPathname } = openMake();
  await submitEnabled();
  fireEvent.press(screen.getByTestId('tonight-make-submit'));
  await waitFor(() => expect(getPathname()).toBe('/tonight'));
  expect(useNightStore.getState().active).toBeNull();
});

it('a song for a friend arrives as the friend route param and is sent for_friend', async () => {
  openMake('artist=Muse&title=Starlight&friend=Alex');
  expect(await screen.findByTestId('tonight-make-friend')).toHaveTextContent(/Alex/);
  await submitEnabled();
  fireEvent.press(screen.getByTestId('tonight-make-submit'));
  await waitFor(() => expect(api.submitRequest).toHaveBeenCalled());
  expect(api.submitRequest.mock.calls[0]![1]).toMatchObject({ for_friend: true, friend_name: 'Alex', source_type: 'make' });
});

it('search in friend mode passes the friend to the make route', async () => {
  api.searchSongs.mockResolvedValue({ api_version: '1.0', songs: [], make_requests_enabled: true, simple_mode: false });
  api.identify.mockResolvedValue({ api_version: '1.0', status: 'none' });
  api.resolve.mockResolvedValue({ api_version: '1.0', status: 'none' } as never);
  const { getPathname } = renderRouter(routes(), { initialUrl: '/tonight/search?friend=Alex' });
  fireEvent.changeText(await screen.findByTestId('tonight-search-input'), 'machu picchu');
  fireEvent.press(await screen.findByTestId('tonight-empty-make', {}, { timeout: 3000 }));
  await waitFor(() => expect(getPathname()).toBe('/tonight/make'));
  expect(await screen.findByTestId('tonight-make-friend')).toHaveTextContent(/Alex/);
});

it('no artist yet (typed words only): asks for the artist before searching', async () => {
  openMake('artist=&title=machu%20picchu');
  expect(await screen.findByTestId('tonight-make-song-form')).toBeTruthy();
  expect(api.makeSearch).not.toHaveBeenCalled();
  fireEvent.changeText(screen.getByTestId('tonight-make-artist-input'), 'The Strokes');
  fireEvent.changeText(screen.getByTestId('tonight-make-title-input'), 'Machu Picchu');
  fireEvent.press(screen.getByTestId('tonight-make-find-audio'));
  await waitFor(() => expect(api.makeSearch).toHaveBeenCalledWith('2121', 'The Strokes', 'Machu Picchu', NIGHT));
});

it('refuses /tonight/make while the request flow is changing a song (ruling E7-R4, A.39)', async () => {
  useRequestStore.getState().startChange({ id: 5, title: 'Hello' });
  openMake();
  expect(await screen.findByTestId('tonight-make-refused')).toBeTruthy();
  expect(api.makeSearch).not.toHaveBeenCalled();
  expect(screen.queryByTestId('tonight-make-submit')).toBeNull();
});

describe('an unknown make outcome survives leaving the screen (fix round 1, item 1)', () => {
  it('leave mid-pending, return, make the same song: same client_request_id and source, no new search', async () => {
    api.submitRequest.mockImplementationOnce(() => new Promise(() => {})); // the box never answers this one
    const { getPathname } = openMake();
    await submitEnabled();
    fireEvent.press(screen.getByTestId('tonight-make-submit'));
    await waitFor(() => expect(api.submitRequest).toHaveBeenCalledTimes(1));
    const first = api.submitRequest.mock.calls[0]![1];
    await act(async () => nav().dismissTo('/tonight'));
    await waitFor(() => expect(getPathname()).toBe('/tonight'));
    expect(pending()?.clientRequestId).toBe(first.client_request_id);

    await act(async () => nav().push('/tonight/make?artist=Muse&title=Starlight'));
    fireEvent.press(await screen.findByTestId('tonight-make-resume'));
    await waitFor(() => expect(getPathname()).toBe('/tonight'));
    expect(api.makeSearch).toHaveBeenCalledTimes(1);
    const second = api.submitRequest.mock.calls[1]![1];
    expect(second.client_request_id).toBe(first.client_request_id);
    expect(second.source_meta).toEqual({ search_session_id: 'kj-s1', selection_index: 0 });
    expect(pending()).toBeNull();
  });

  it('/me shows the make-it row: it says so and the record is cleared', async () => {
    api.submitRequest.mockImplementationOnce(() => new Promise(() => {}));
    const { getPathname } = openMake();
    await submitEnabled();
    fireEvent.press(screen.getByTestId('tonight-make-submit'));
    await waitFor(() => expect(api.submitRequest).toHaveBeenCalledTimes(1));
    await act(async () => nav().dismissTo('/tonight'));
    await waitFor(() => expect(getPathname()).toBe('/tonight'));
    api.getMe.mockResolvedValue(
      me({ songs: [song({ make: 'making', request: { source_type: 'make', song_artist: 'Muse', song_title: 'Starlight' } })] }),
    );
    await act(async () => nav().push('/tonight/make?artist=Muse&title=Starlight'));
    expect(await screen.findByTestId('tonight-make-already')).toHaveTextContent(/already being made/);
    await waitFor(() => expect(pending()).toBeNull());
    expect(screen.queryByTestId('tonight-make-resume')).toBeNull();
    expect(api.makeSearch).toHaveBeenCalledTimes(1);
  });
});

it('undo/redo of a tidy while a send is pending keeps the same client_request_id (item 3)', async () => {
  Object.assign(makeTiming, { retryMinMs: 5, lastStartMs: 30 });
  api.makeCheck.mockResolvedValue(verdict({ kind: 'cosmetic', canonical_artist: 'Muse', canonical_title: 'Starlight' }));
  api.submitRequest.mockRejectedValue(new KjboxError('busy_retry', 409, 0));
  openMake('artist=muse&title=starlight');
  await submitEnabled();
  fireEvent.press(screen.getByTestId('tonight-make-submit'));
  await screen.findByTestId('tonight-make-error');
  fireEvent.press(screen.getByTestId('match-undo'));
  await submitEnabled();
  fireEvent.press(screen.getByTestId('tonight-make-submit'));
  await waitFor(() => expect(api.submitRequest.mock.calls.at(-1)![1].song_artist).toBe('muse'));
  expect(new Set(api.submitRequest.mock.calls.map(([, b]) => b.client_request_id)).size).toBe(1);
});

it('signed out: sign-in returns to /tonight/make with the params (item 4)', async () => {
  const open = jest.spyOn(signInUi, 'openSignIn').mockImplementation(() => {});
  const night = useNightStore.getState().active;
  await useAuth.getState().signOut();
  // Signing out drops the night (E2); force one back so the session lapsing under an open screen reaches the gate.
  useNightStore.setState({ active: night });
  openMake('artist=Muse&title=Starlight&friend=Alex');
  fireEvent.press(await screen.findByTestId('tonight-make-signin'));
  expect(open).toHaveBeenCalledWith('/tonight/make?artist=Muse&title=Starlight&friend=Alex');
  open.mockRestore();
});

describe('search sessions (item 5)', () => {
  it('no search_session_id: searches again instead of sending an empty one', async () => {
    api.makeSearch.mockResolvedValueOnce({ ...searchResult(), search_session_id: null });
    openMake();
    await submitEnabled();
    fireEvent.press(screen.getByTestId('tonight-make-submit'));
    await waitFor(() => expect(api.makeSearch).toHaveBeenCalledTimes(2));
    expect(api.submitRequest).not.toHaveBeenCalled();
    await submitEnabled();
    fireEvent.press(screen.getByTestId('tonight-make-submit'));
    await waitFor(() => expect(api.submitRequest).toHaveBeenCalled());
    expect(api.submitRequest.mock.calls[0]![1].source_meta).toEqual({ search_session_id: 'kj-s1', selection_index: 0 });
  });

  // kjbox: gen 404/403 on create-from-search → web 409 {error: 'search_expired'} → v1 409 conflict, message
  // 'search_expired' (no map entry, so the status fallback, with the web code as the message).
  const expired = () => new KjboxError('conflict', 409, undefined, { error: 'conflict', message: 'search_expired' });

  it('an expired session (409 conflict, message search_expired) searches again once, then shows the error', async () => {
    api.submitRequest.mockRejectedValue(expired());
    openMake();
    await submitEnabled();
    fireEvent.press(screen.getByTestId('tonight-make-submit'));
    expect(await screen.findByTestId('tonight-make-searched-again')).toBeTruthy();
    await waitFor(() => expect(api.makeSearch).toHaveBeenCalledTimes(2));
    await submitEnabled();
    fireEvent.press(screen.getByTestId('tonight-make-submit'));
    expect(await screen.findByTestId('tonight-make-error')).toBeTruthy();
    expect(api.makeSearch).toHaveBeenCalledTimes(2);
    expect(pending()).toBeNull();
  });

  it('any other conflict is an error, not a re-search', async () => {
    api.submitRequest.mockRejectedValue(new KjboxError('conflict', 409));
    openMake();
    await submitEnabled();
    fireEvent.press(screen.getByTestId('tonight-make-submit'));
    expect(await screen.findByTestId('tonight-make-error')).toHaveTextContent(/Something changed in the meantime/);
    expect(api.makeSearch).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('tonight-make-searched-again')).toBeNull();
  });
});

it('a pending send, then a different source: a new client_request_id (reuse only for the same source, round 2 item 3)', async () => {
  Object.assign(makeTiming, { retryMinMs: 5, lastStartMs: 30 });
  api.submitRequest.mockRejectedValue(new KjboxError('busy_retry', 409, 0));
  openMake();
  await submitEnabled();
  fireEvent.press(screen.getByTestId('tonight-make-submit'));
  await screen.findByTestId('tonight-make-error');
  const firstId = api.submitRequest.mock.calls[0]![1].client_request_id;
  fireEvent.press(screen.getByTestId('make-other-sources'));
  fireEvent.press(await screen.findByTestId('make-source-1'));
  fireEvent.press(screen.getByTestId('tonight-make-submit'));
  await waitFor(() => expect(api.submitRequest.mock.calls.at(-1)![1].source_meta).toEqual({ search_session_id: 'kj-s1', selection_index: 1 }));
  expect(api.submitRequest.mock.calls.at(-1)![1].client_request_id).not.toBe(firstId);
  expect(pending()?.clientRequestId).toBe(api.submitRequest.mock.calls.at(-1)![1].client_request_id);
});
