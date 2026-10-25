// The Me home (Phase 4a, B8): profile card, go-tos, setlists, All your songs, stats; signed out shows sign-in.
import * as decide from '@nomad/api-decide';
import { fireEvent, screen, within } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';

import { useAuth } from '../../auth/store';
import { useVoiceStore } from '../../voice/voiceStore';
import { gen } from '../../test-utils/genAuthMock';
import { appRoutes } from '../../test-utils/routes';
import { li, resetMe } from './helpers';

jest.setTimeout(20_000);

jest.mock('@nomad/api-decide', () => ({
  ...jest.requireActual('@nomad/api-decide'),
  getLibrary: jest.fn(),
  listSetlists: jest.fn(async () => []),
  listKaraokeLog: jest.fn(async () => ({ entries: [] })),
  putKaraokeLog: jest.fn(async () => ({})),
  getServicesSummary: jest.fn(),
  getOfflineIndexManifest: jest.fn(async () => ({ bytes: 1 })),
  getVoiceProfile: jest.fn(async () => null),
  getVoiceFlags: jest.fn(async () => ({ session_enabled: false, is_admin: false, voice_data: false })),
  popularSongs: jest.fn(async () => []),
  pingSearch: jest.fn(async () => true),
  logSearchEvent: jest.fn(async () => {}),
  configureClient: jest.fn(),
}));
jest.mock('@nomad/api-gen', () => ({ ...jest.requireActual('@nomad/api-gen'), getMe: jest.fn() }));

const api = decide as jest.Mocked<typeof decide>;

const goTo = (n: number) => li(`Band ${n}`, `Song ${n}`, { times_sung: 10 - n, latest_feel: 'great', feel_counts: { great: 1 } });

beforeEach(() => {
  jest.clearAllMocks();
  resetMe('me@example.com');
  useVoiceStore.getState().clear();
  gen.getMe.mockResolvedValue({ email: 'me@example.com', credits: 3 } as never);
  api.getServicesSummary.mockResolvedValue({ sources: [], capabilities: { screenshot_import: false, listenbrainz_oauth: false } } as never);
  api.getLibrary.mockResolvedValue({
    status: 'ok', etag: 'e',
    items: [1, 2, 3, 4, 5, 6, 7].map(goTo).concat([li('Solo', 'Once', { times_sung: 1 })]),
  } as never);
});

describe('Me home', () => {
  it('lists up to 5 go-tos, the all-songs row, stats, and keeps the existing rows', async () => {
    renderRouter(appRoutes(), { initialUrl: '/me' });
    expect(await screen.findByTestId('me-gotos')).toBeTruthy();
    expect(await screen.findByTestId('me-goto-4')).toBeTruthy();
    expect(screen.queryByTestId('me-goto-5')).toBeNull();
    expect(await screen.findByTestId('me-all-songs')).toHaveTextContent(/8/);
    expect(screen.getByTestId('me-stats')).toBeTruthy();
    for (const id of ['me-credits', 'me-buy', 'me-music-profile', 'me-signout', 'me-offline', 'me-language']) {
      expect(await screen.findByTestId(id)).toBeTruthy();
    }
    fireEvent.press(screen.getByTestId('me-all-songs'));
    expect(await screen.findByTestId('me-songs')).toBeTruthy();
  });

  it('puts the profile card first, then go-tos, setlists, all-songs, stats', async () => {
    renderRouter(appRoutes(), { initialUrl: '/me' });
    await screen.findByTestId('me-credits');
    await screen.findByTestId('me-goto-0');
    const order = ['me-profile-card', 'me-gotos', 'me-setlists', 'me-all-songs', 'me-stats', 'me-credits'];
    const json = JSON.stringify(screen.toJSON());
    const at = order.map((id) => json.indexOf(`"testID":"${id}"`));
    expect(at.every((n) => n >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it('profile card: voice CTA and connect CTA with nothing set up; manage opens the music profile', async () => {
    renderRouter(appRoutes(), { initialUrl: '/me' });
    const card = await screen.findByTestId('me-profile-card');
    expect(within(card).getByTestId('me-profile-voice-cta')).toBeTruthy();
    expect(await within(card).findByTestId('me-profile-connect')).toBeTruthy();
    fireEvent.press(within(card).getByTestId('me-profile-manage'));
    expect(await screen.findByTestId('profile-screen')).toBeTruthy();
  });

  it('profile card: voice range keys and source icons when set up', async () => {
    useVoiceStore.getState().save({
      lowMidi: 45, highMidi: 69, comfortLow: 48, comfortHigh: 66, voiceType: 'baritone', voiceTypeBetween: null,
      register: null, confidence: 'high', method: 'mic', measuredAt: '2026-10-01T00:00:00Z',
    });
    api.getServicesSummary.mockResolvedValue({
      sources: [{ source: 'spotify', connected: true, songs: 120 }],
      capabilities: { screenshot_import: false, listenbrainz_oauth: false },
    } as never);
    renderRouter(appRoutes(), { initialUrl: '/me' });
    const card = await screen.findByTestId('me-profile-card');
    expect(within(card).getByTestId('me-profile-keys')).toBeTruthy();
    expect(within(card).queryByTestId('me-profile-voice-cta')).toBeNull();
    expect(await within(card).findByTestId('me-profile-source-spotify', { includeHiddenElements: true })).toBeTruthy();
    expect(within(card).getByTestId('me-profile-known')).toHaveTextContent(/120/);
    expect(within(card).getByTestId('me-profile-sung')).toHaveTextContent(/8/);
  });

  it('empty go-tos open the bulk picker; New setlist opens a named setlist', async () => {
    api.getLibrary.mockResolvedValue({ status: 'ok', etag: 'e', items: [] } as never);
    renderRouter(appRoutes(), { initialUrl: '/me' });
    fireEvent.press(await screen.findByTestId('me-gotos-empty-cta'));
    expect(await screen.findByTestId('sung-before')).toBeTruthy();
  });

  it('creating a setlist from the shelf navigates to it', async () => {
    renderRouter(appRoutes(), { initialUrl: '/me' });
    fireEvent.press(await screen.findByTestId('me-setlist-new'));
    fireEvent.changeText(await screen.findByTestId('setlist-name-input'), 'Friday');
    fireEvent.press(screen.getByTestId('setlist-name-save'));
    expect(await screen.findByTestId('setlist')).toBeTruthy();
  });
});

it('signed out shows only sign-in', async () => {
  useAuth.setState({ state: { status: 'signedOut' } as never, hydrated: true });
  renderRouter(appRoutes(), { initialUrl: '/me' });
  expect(await screen.findByTestId('me-signin')).toBeTruthy();
  expect(screen.queryByTestId('me-profile-card')).toBeNull();
  expect(screen.queryByTestId('me-gotos')).toBeNull();
});
