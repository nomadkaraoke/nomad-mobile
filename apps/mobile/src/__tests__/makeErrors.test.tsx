// Make screen: YouTube fallback placement, validate-url before create, and gen error mapping (spec §4.3 items 7–8).
// Lives here, not in src/app/make/__tests__: expo-router would bundle any .tsx under src/app as a route.
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';

import { useAuth } from '../auth/store';
import { useMakeIntent } from '../make/intentStore';
import { apiError, gen, session } from '../test-utils/genAuthMock';
import { bestChoice, makeRoutes, spotify, youtube } from '../test-utils/makeFixtures';

jest.mock('@nomad/api-decide', () => ({
  searchSongs: jest.fn(),
  popularSongs: jest.fn(async () => []),
  pingSearch: jest.fn(async () => true),
  getSongDetail: jest.fn(),
  logSearchEvent: jest.fn(async () => {}),
  configureClient: jest.fn(),
}));
jest.mock('@nomad/api-gen', () => ({
  ...jest.requireActual('@nomad/api-gen'),
  searchAudio: jest.fn(),
  createJobFromSearch: jest.fn(),
  createJobFromUrl: jest.fn(),
  getMe: jest.fn(),
  listMyJobs: jest.fn(),
  matchJudge: jest.fn(),
  communityCheck: jest.fn(),
  validateUrl: jest.fn(),
}));

const TIER1 = { sessionId: 's1', results: [bestChoice(0), youtube(1), spotify(2)] };
const TIER3 = { sessionId: 's3', results: [youtube(0), youtube(1, 'Starlight (live)'), spotify(2)] };
const BOT = "ERROR: [youtube] abc123: Sign in to confirm you're not a bot";

beforeEach(async () => {
  jest.useRealTimers();
  jest.clearAllMocks();
  await useAuth.getState().signInWithSession(session());
  useMakeIntent.getState().set({ artist: 'Muse', title: 'Starlight', source: 'typed', editedFields: [], createdAt: Date.now() });
  gen.getMe.mockResolvedValue({ email: 'me@example.com', credits: 3 });
  gen.searchAudio.mockResolvedValue(TIER1);
  gen.createJobFromSearch.mockResolvedValue('job-1');
  gen.createJobFromUrl.mockResolvedValue('job-2');
  gen.listMyJobs.mockResolvedValue([]);
  gen.matchJudge.mockResolvedValue({
    kind: 'none',
    confident: true,
    canonical_artist: 'Muse',
    canonical_title: 'Starlight',
    alternatives: [],
    engine: 'catalog',
    reason: '',
    needs_ai: false,
  });
  gen.communityCheck.mockResolvedValue({ has_community: false, songs: [], best_youtube_url: null });
  gen.validateUrl.mockResolvedValue({ supported: true });
});

const openMake = () => renderRouter(makeRoutes(), { initialUrl: '/make/new' });
const readySubmit = () =>
  waitFor(() => expect(screen.getByTestId('make-submit')).toBeEnabled(), { timeout: 3000 });
/** Open the link box (tiers 1–2), type a link and press Make it. */
const submitLink = async (link: string) => {
  await readySubmit();
  fireEvent.press(screen.getByTestId('youtube-toggle'));
  fireEvent.changeText(screen.getByTestId('make-youtube-input'), link);
  await act(async () => fireEvent.press(screen.getByTestId('make-submit')));
};
const submitPick = async () => {
  await readySubmit();
  await act(async () => fireEvent.press(screen.getByTestId('make-submit')));
};

/** testIDs in render order. */
const testIds = (root: ReturnType<typeof openMake>) =>
  root.UNSAFE_root.findAll((n) => typeof n.props.testID === 'string' && typeof n.type === 'string').map((n) => n.props.testID as string);

describe('YouTube fallback placement', () => {
  it('tier 1: collapsed behind "Can\'t find your song?", below the pick; the toggle opens it', async () => {
    openMake();
    expect(await screen.findByTestId('make-pick')).toBeTruthy();
    expect(screen.getByTestId('youtube-toggle')).toHaveTextContent("Can't find your song? Paste a link instead");
    expect(screen.queryByTestId('make-youtube-input')).toBeNull();
    fireEvent.press(screen.getByTestId('youtube-toggle'));
    expect(screen.getByTestId('make-youtube-input')).toBeTruthy();
  });

  it('tier 3: open and first, above the results, with no toggle', async () => {
    gen.searchAudio.mockResolvedValue(TIER3);
    const app = openMake();
    expect(await screen.findByTestId('make-source-2')).toBeTruthy();
    expect(screen.queryByTestId('youtube-toggle')).toBeNull();
    const ids = testIds(app);
    expect(ids.indexOf('make-youtube-input')).toBeGreaterThan(-1);
    expect(ids.indexOf('make-youtube-input')).toBeLessThan(ids.indexOf('make-source-0'));
  });

  it('no results: open and first, with no toggle', async () => {
    gen.searchAudio.mockResolvedValue({ sessionId: 's0', results: [] });
    openMake();
    expect(await screen.findByTestId('make-youtube-input')).toBeTruthy();
    expect(screen.queryByTestId('youtube-toggle')).toBeNull();
  });

  it('tier 3: typing a link chooses it; tapping a source afterwards chooses the source', async () => {
    gen.searchAudio.mockResolvedValue(TIER3);
    openMake();
    await waitFor(() => expect(screen.getByTestId('make-youtube-input')).toBeTruthy());
    expect(screen.getByTestId('make-submit')).toBeDisabled();
    fireEvent.changeText(screen.getByTestId('make-youtube-input'), 'https://youtu.be/abc123');
    await readySubmit();
    fireEvent.press(screen.getByTestId('make-source-2'));
    await act(async () => fireEvent.press(screen.getByTestId('make-submit')));
    expect(gen.createJobFromSearch).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 's3', index: 2 }));
    expect(gen.validateUrl).not.toHaveBeenCalled();
  });
});

describe('links are checked with gen before creating', () => {
  it('validate-url says no → its detail inline, and no job is created', async () => {
    gen.validateUrl.mockResolvedValue({ supported: false, detail: 'DRM-protected streaming links cannot be downloaded.' });
    openMake();
    await submitLink('https://open.example.com/track/1');
    expect(gen.validateUrl).toHaveBeenCalledWith('https://open.example.com/track/1');
    expect(await screen.findByTestId('youtube-invalid')).toHaveTextContent('DRM-protected streaming links cannot be downloaded.');
    expect(gen.createJobFromUrl).not.toHaveBeenCalled();
    // Editing the link clears the message, and Make it works again.
    fireEvent.changeText(screen.getByTestId('make-youtube-input'), 'https://youtu.be/abc123');
    expect(screen.queryByTestId('youtube-invalid')).toBeNull();
    expect(screen.getByTestId('make-submit')).toBeEnabled();
  });

  it('validate-url says no without a detail → a generic "not supported"', async () => {
    gen.validateUrl.mockResolvedValue({ supported: false });
    openMake();
    await submitLink('https://example.com/song');
    expect(await screen.findByTestId('youtube-invalid')).toHaveTextContent("That link isn't supported. Try another source.");
  });

  it('any http(s) link gen supports goes through (not only YouTube)', async () => {
    openMake();
    await submitLink('https://soundcloud.com/muse/starlight');
    expect(gen.createJobFromUrl).toHaveBeenCalledWith({ url: 'https://soundcloud.com/muse/starlight', artist: 'Muse', title: 'Starlight' });
  });

  it('validate-url failing (network) fails open: the job is still created', async () => {
    gen.validateUrl.mockRejectedValue(apiError(503, 'down'));
    openMake();
    await submitLink('https://youtu.be/abc123');
    await waitFor(() => expect(gen.createJobFromUrl).toHaveBeenCalledTimes(1));
  });

  it('not a link at all → Make it stays disabled, with an inline hint', async () => {
    openMake();
    await readySubmit();
    fireEvent.press(screen.getByTestId('youtube-toggle'));
    fireEvent.changeText(screen.getByTestId('make-youtube-input'), 'youtube muse starlight');
    expect(screen.getByTestId('make-submit')).toBeDisabled();
    expect(screen.getByText("That doesn't look like a link.")).toBeTruthy();
  });
});

describe('create errors', () => {
  it('422 "Sign in to confirm you\'re not a bot" from YouTube → the YouTube-blocked message', async () => {
    gen.createJobFromUrl.mockRejectedValue(apiError(422, BOT));
    openMake();
    await submitLink('https://youtu.be/abc123');
    expect(await screen.findByTestId('error-youtube-blocked')).toHaveTextContent(/YouTube is blocking our downloads/);
    expect(screen.queryByTestId('make-error')).toBeNull();
  });

  it.each([400, 403])('%i with a YouTube bot detail on create-from-search → YouTube-blocked, no re-search', async (status) => {
    gen.createJobFromSearch.mockRejectedValue(apiError(status, BOT));
    openMake();
    await submitPick();
    expect(await screen.findByTestId('error-youtube-blocked')).toBeTruthy();
    expect(gen.searchAudio).toHaveBeenCalledTimes(1);
  });

  it('403 on create-from-search (session not ours) → one re-search, with the expired note', async () => {
    gen.createJobFromSearch.mockRejectedValueOnce(apiError(403, "You don't have permission to use this search session"));
    openMake();
    await submitPick();
    expect(await screen.findByText('That search expired, so we looked again.')).toBeTruthy();
    expect(gen.searchAudio).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('make-error')).toBeNull();
    await submitPick();
    expect(gen.createJobFromSearch).toHaveBeenCalledTimes(2);
    expect(gen.searchAudio).toHaveBeenCalledTimes(2);
  });

  it('404 "Search expired" → one re-search', async () => {
    gen.createJobFromSearch.mockRejectedValueOnce(apiError(404, 'Search expired — please search again'));
    openMake();
    await submitPick();
    expect(await screen.findByText('That search expired, so we looked again.')).toBeTruthy();
    expect(gen.searchAudio).toHaveBeenCalledTimes(2);
  });

  it('a 404 for a link is not a search problem → createFailed, no re-search', async () => {
    gen.createJobFromUrl.mockRejectedValue(apiError(404, 'Not found'));
    openMake();
    await submitLink('https://youtu.be/abc123');
    expect(await screen.findByTestId('make-error')).toHaveTextContent("Couldn't start this one. Try again.");
    expect(gen.searchAudio).toHaveBeenCalledTimes(1);
  });

  it.each([
    [400, 'This YouTube video is private and cannot be downloaded.'],
    [422, [{ msg: 'field required' }]],
    [500, 'boom'],
  ])('%i %j → createFailed', async (status, detail) => {
    gen.createJobFromUrl.mockRejectedValue(apiError(status, detail));
    openMake();
    await submitLink('https://youtu.be/abc123');
    expect(await screen.findByTestId('make-error')).toBeTruthy();
    expect(screen.queryByTestId('error-youtube-blocked')).toBeNull();
  });

  it('a network error (not from gen) → createFailed', async () => {
    gen.createJobFromSearch.mockRejectedValue(new TypeError('Network request failed'));
    openMake();
    await submitPick();
    expect(await screen.findByTestId('make-error')).toBeTruthy();
  });
});
