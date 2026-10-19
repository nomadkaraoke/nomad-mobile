// The make screen's match judge, gate and community check (spec §4.3, A103–A105, A115; Task C7).
import type { MatchVerdict } from '@nomad/api-gen';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { Linking } from 'react-native';

import { useAuth } from '../auth/store';
import { useMakeIntent, type MakeIntent } from '../make/intentStore';
import { JUDGE_GATE_TIMEOUT_MS } from '../make/useMatchJudge';
import { gen, session } from '../test-utils/genAuthMock';
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
}));

const TIER1 = { sessionId: 's1', results: [bestChoice(0), youtube(1), spotify(2)] };
const TIER3 = { sessionId: 's3', results: [youtube(0, 'something else'), spotify(1)] };

const verdict = (over: Partial<MatchVerdict> = {}): MatchVerdict => ({
  kind: 'none',
  confident: true,
  canonical_artist: 'muse',
  canonical_title: 'starlite',
  alternatives: [],
  engine: 'catalog',
  reason: '',
  needs_ai: false,
  ...over,
});
const FIXED = { canonical_artist: 'Muse', canonical_title: 'Starlight' };
/** fast says "ask the AI"; full answers `full`. */
const judgeFull = (full: Partial<MatchVerdict>) =>
  gen.matchJudge.mockImplementation(async (b) => (b.stage === 'fast' ? verdict({ needs_ai: true }) : verdict(full)));
const fullCalls = () => gen.matchJudge.mock.calls.filter(([b]) => b.stage === 'full');

const setIntent = (over: Partial<MakeIntent> = {}) =>
  useMakeIntent.getState().set({
    artist: 'muse',
    title: 'starlite',
    source: 'typed',
    editedFields: [],
    createdAt: Date.now(),
    ...over,
  });

beforeEach(async () => {
  jest.useRealTimers();
  jest.clearAllMocks();
  await useAuth.getState().signInWithSession(session());
  setIntent();
  gen.getMe.mockResolvedValue({ email: 'me@example.com', credits: 3 });
  gen.searchAudio.mockResolvedValue(TIER1);
  gen.createJobFromSearch.mockResolvedValue('job-1');
  gen.createJobFromUrl.mockResolvedValue('job-2');
  gen.listMyJobs.mockResolvedValue([]);
  gen.matchJudge.mockResolvedValue(verdict());
  gen.communityCheck.mockResolvedValue({ has_community: false, songs: [], best_youtube_url: null });
});

const openMake = () => renderRouter(makeRoutes(), { initialUrl: '/make/new' });
const submitEnabled = () => waitFor(() => expect(screen.getByTestId('make-submit')).toBeEnabled());

it('the fast judge and the audio search start together; a confident cosmetic tidy applies with no full call', async () => {
  let finish!: (v: typeof TIER1) => void;
  gen.searchAudio.mockReturnValueOnce(new Promise((r) => (finish = r)));
  gen.matchJudge.mockResolvedValue(verdict({ kind: 'cosmetic', ...FIXED }));
  openMake();
  await screen.findByTestId('make-searching');
  expect(gen.searchAudio).toHaveBeenCalledWith('muse', 'starlite');
  expect(gen.matchJudge).toHaveBeenCalledWith({ artist: 'muse', title: 'starlite', stage: 'fast' });
  // Applied before the results land.
  expect(await screen.findByTestId('match-notice')).toHaveTextContent(/Tidied to/);
  expect(screen.getByTestId('make-song-title')).toHaveTextContent('Starlight');
  await act(async () => finish(TIER1));
  await submitEnabled();
  expect(fullCalls()).toHaveLength(0);
  expect(gen.searchAudio).toHaveBeenCalledTimes(1);
});

it('fast needs_ai → one full call with the tier', async () => {
  judgeFull({});
  openMake();
  await submitEnabled();
  expect(fullCalls()).toHaveLength(1);
  // The tier of the results for what was searched ("starlite": the filename doesn't match, so tier 2).
  expect(fullCalls()[0]?.[0]).toMatchObject({ stage: 'full', audio_confidence_tier: 2 });
});

it('content at tier 1: applied as "Corrected to … · Undo", no second search', async () => {
  judgeFull({ kind: 'content', engine: 'ai', ...FIXED });
  openMake();
  expect(await screen.findByTestId('match-notice')).toHaveTextContent(/Corrected to.*you typed/);
  await submitEnabled();
  expect(gen.searchAudio).toHaveBeenCalledTimes(1);
});

it('content at tier 3: exactly one more search, for the corrected song', async () => {
  gen.searchAudio.mockResolvedValueOnce(TIER3).mockResolvedValueOnce(TIER1);
  judgeFull({ kind: 'content', engine: 'ai', ...FIXED });
  openMake();
  await waitFor(() => expect(gen.searchAudio).toHaveBeenCalledTimes(2));
  expect(gen.searchAudio).toHaveBeenLastCalledWith('Muse', 'Starlight');
  expect(await screen.findByTestId('make-pick')).toBeTruthy();
  await submitEnabled();
  expect(gen.searchAudio).toHaveBeenCalledTimes(2);
  expect(fullCalls()).toHaveLength(1);
});

it('ambiguous shows Did you mean; accepting searches again and makes the job with it', async () => {
  judgeFull({
    kind: 'ambiguous',
    confident: false,
    engine: 'ai',
    ...FIXED,
    alternatives: [{ artist: 'Muse', title: 'Starlight (Live)' }],
  });
  gen.searchAudio.mockResolvedValueOnce(TIER1).mockResolvedValueOnce({ ...TIER1, sessionId: 's1b' });
  openMake();
  expect(await screen.findByTestId('did-you-mean')).toBeTruthy();
  expect(screen.getByTestId('did-you-mean-0')).toHaveTextContent(/Starlight · Muse/);
  fireEvent.press(screen.getByTestId('did-you-mean-1'));
  await waitFor(() => expect(gen.searchAudio).toHaveBeenCalledTimes(2));
  expect(gen.searchAudio).toHaveBeenLastCalledWith('Muse', 'Starlight (Live)');
  expect(screen.queryByTestId('did-you-mean')).toBeNull();
  await submitEnabled();
  await act(async () => fireEvent.press(screen.getByTestId('make-submit')));
  expect(gen.createJobFromSearch).toHaveBeenCalledWith({
    sessionId: 's1b',
    index: 0,
    artist: 'Muse',
    title: 'Starlight (Live)',
  });
});

it('the source buttons stay disabled while the judge is pending and open at the timeout', async () => {
  jest.useFakeTimers();
  gen.matchJudge.mockImplementation((b) =>
    b.stage === 'fast' ? Promise.resolve(verdict({ needs_ai: true })) : new Promise<MatchVerdict>(() => {}),
  );
  openMake();
  await act(async () => {
    await jest.advanceTimersByTimeAsync(0);
  });
  expect(screen.getByTestId('make-pick')).toBeDisabled();
  expect(screen.getByTestId('make-submit')).toBeDisabled();
  expect(screen.getByTestId('match-gate-checking')).toHaveTextContent('Checking song details…');
  fireEvent.press(screen.getByTestId('make-other-sources'));
  expect(screen.getByTestId('make-source-1')).toBeDisabled();
  await act(async () => {
    await jest.advanceTimersByTimeAsync(JUDGE_GATE_TIMEOUT_MS);
  });
  expect(screen.getByTestId('make-pick')).toBeEnabled();
  expect(screen.getByTestId('make-source-1')).toBeEnabled();
  expect(screen.getByTestId('make-submit')).toBeEnabled();
  expect(screen.queryByTestId('match-gate-checking')).toBeNull();
});

it('create-from-search gets the applied artist/title', async () => {
  gen.matchJudge.mockResolvedValue(verdict({ kind: 'cosmetic', ...FIXED }));
  openMake();
  await submitEnabled();
  await act(async () => fireEvent.press(screen.getByTestId('make-submit')));
  expect(gen.createJobFromSearch).toHaveBeenCalledWith({ sessionId: 's1', index: 0, artist: 'Muse', title: 'Starlight' });
});

it('create-from-url gets the applied artist/title', async () => {
  gen.matchJudge.mockResolvedValue(verdict({ kind: 'cosmetic', ...FIXED }));
  openMake();
  await submitEnabled();
  fireEvent.press(screen.getByTestId('make-youtube-toggle'));
  fireEvent.changeText(screen.getByTestId('make-youtube-input'), 'https://youtu.be/abc123');
  await act(async () => fireEvent.press(screen.getByTestId('make-submit')));
  expect(gen.createJobFromUrl).toHaveBeenCalledWith({ url: 'https://youtu.be/abc123', artist: 'Muse', title: 'Starlight' });
});

it('Undo keeps what was typed (metadata only) and the job uses it; redo puts the correction back', async () => {
  judgeFull({ kind: 'content', engine: 'ai', ...FIXED });
  openMake();
  fireEvent.press(await screen.findByTestId('match-undo'));
  expect(screen.getByTestId('make-song-title')).toHaveTextContent('starlite');
  expect(screen.getByTestId('match-notice')).toHaveTextContent(/Using what you typed/);
  fireEvent.press(screen.getByTestId('match-redo'));
  expect(screen.getByTestId('make-song-title')).toHaveTextContent('Starlight');
  fireEvent.press(screen.getByTestId('match-undo'));
  await submitEnabled();
  await act(async () => fireEvent.press(screen.getByTestId('make-submit')));
  expect(gen.createJobFromSearch).toHaveBeenCalledWith({ sessionId: 's1', index: 0, artist: 'muse', title: 'starlite' });
  expect(gen.searchAudio).toHaveBeenCalledTimes(1);
});

it('Review Focus 5: the title the user edited is never overwritten, and Undo restores exactly what was showing', async () => {
  // Pre-filled from "Muse — Starlight", then the user edited the title on the form before Make it.
  setIntent({
    artist: 'muse',
    title: 'Starlight (Live at Wembley)',
    canonicalArtist: 'Muse',
    canonicalTitle: 'Starlight',
    songKey: 'muse|starlight',
    editedFields: ['title'],
  });
  let answer!: (v: MatchVerdict) => void;
  gen.matchJudge.mockImplementation((b) =>
    b.stage === 'fast' ? Promise.resolve(verdict({ needs_ai: true })) : new Promise<MatchVerdict>((r) => (answer = r)),
  );
  openMake();
  await waitFor(() => expect(fullCalls()).toHaveLength(1));
  expect(screen.getByTestId('make-song-title')).toHaveTextContent('Starlight (Live at Wembley)');
  await act(async () => answer(verdict({ kind: 'content', engine: 'ai', ...FIXED })));
  expect(screen.getByTestId('make-song-title')).toHaveTextContent('Starlight (Live at Wembley)');
  expect(screen.getByTestId('make-song-artist')).toHaveTextContent('Muse');
  fireEvent.press(screen.getByTestId('match-undo'));
  expect(screen.getByTestId('make-song-title')).toHaveTextContent('Starlight (Live at Wembley)');
  expect(screen.getByTestId('make-song-artist')).toHaveTextContent('muse');
  await submitEnabled();
  await act(async () => fireEvent.press(screen.getByTestId('make-submit')));
  expect(gen.createJobFromSearch).toHaveBeenCalledWith(
    expect.objectContaining({ artist: 'muse', title: 'Starlight (Live at Wembley)' }),
  );
});

it('community-exists shows when a community version exists, with a watch link; make stays available', async () => {
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  gen.communityCheck.mockResolvedValue({
    has_community: true,
    songs: [
      {
        artist: 'Muse',
        title: 'Starlight',
        community_tracks: [{ brand_name: 'Nomad', brand_code: 'NOMAD', youtube_url: 'https://youtu.be/comm1', is_community: true }],
      },
    ],
    best_youtube_url: 'https://youtu.be/best',
  });
  openMake();
  expect(await screen.findByTestId('community-exists')).toHaveTextContent(/A community karaoke version already exists/);
  expect(gen.communityCheck).toHaveBeenCalledWith({ artist: 'muse', title: 'starlite' });
  fireEvent.press(screen.getByTestId('community-watch'));
  expect(open).toHaveBeenCalledWith('https://youtu.be/best');
  await submitEnabled();
  expect(gen.communityCheck).toHaveBeenCalledTimes(1);
  open.mockRestore();
});

it('a failed community check renders nothing and blocks nothing', async () => {
  gen.communityCheck.mockRejectedValue(new Error('500'));
  openMake();
  await submitEnabled();
  await waitFor(() => expect(gen.communityCheck).toHaveBeenCalled());
  expect(screen.queryByTestId('community-exists')).toBeNull();
});

