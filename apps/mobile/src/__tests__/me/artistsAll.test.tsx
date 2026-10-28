// artistsAll: Me -> music profile -> "All artists" A-Z screen at /me/artists (Phase 4a, B7).
import * as decide from '@nomad/api-decide';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';

import { useAuth } from '../../auth/store';
import { gen, session } from '../../test-utils/genAuthMock';
import { appRoutes } from '../../test-utils/routes';
import { groupArtists } from '../../discover/profile/artistGroups';

jest.setTimeout(20_000);

// The real List, with scrollToIndex captured.
const mockScrollToIndex = jest.fn();
jest.mock('@nomad/ui', () => {
  const actual = jest.requireActual('@nomad/ui');
  const React = jest.requireActual('react');
  const List = React.forwardRef(function MockList(props: object, ref: unknown) {
    React.useImperativeHandle(ref, () => ({ scrollToIndex: mockScrollToIndex, scrollToTop: jest.fn() }));
    return React.createElement(actual.List, props);
  });
  return { ...actual, List };
});

jest.mock('@nomad/api-decide', () => ({
  ...jest.requireActual('@nomad/api-decide'),
  getServicesSummary: jest.fn(async () => ({ sources: [], capabilities: { screenshot_import: false, listenbrainz_oauth: false } })),
  popularSongs: jest.fn(async () => []),
  pingSearch: jest.fn(async () => true),
  logSearchEvent: jest.fn(async () => {}),
  configureClient: jest.fn(),
  getOfflineIndexManifest: jest.fn(async () => ({ bytes: 1 })),
  getRecommendationsV2: jest.fn(),
  getPreferences: jest.fn(),
  listMyArtists: jest.fn(),
  removeMyArtist: jest.fn(),
  listLovedSongs: jest.fn(),
  listHiddenSongs: jest.fn(),
  getQuizProgress: jest.fn(),
  getVoiceFlags: jest.fn(async () => ({ session_enabled: false, is_admin: false, voice_data: false })),
}));
jest.mock('@nomad/api-gen', () => ({ ...jest.requireActual('@nomad/api-gen'), getMe: jest.fn() }));

const m = (f: unknown) => f as jest.Mock;
let rows: { artist_name: string; sources: string[] }[];

beforeEach(async () => {
  jest.clearAllMocks();
  await useAuth.getState().signOut();
  gen.getMe.mockResolvedValue({ email: 'me@example.com', credits: 3 } as never);
  rows = ['Beta Band', 'Alpha Band', 'Mango Tree', 'Zed Zed', 'Étoile', 'Мария', 'Mike Moon'].map((artist_name) => ({
    artist_name,
    sources: ['quiz'],
  }));
  m(decide.getPreferences).mockResolvedValue({ genres: [], decades: [], energy_preference: null });
  m(decide.listMyArtists).mockImplementation(async () => ({ artists: rows, total: rows.length, page: 1, per_page: 50, has_more: false }));
  m(decide.listLovedSongs).mockResolvedValue([]);
  m(decide.listHiddenSongs).mockResolvedValue([]);
  m(decide.getRecommendationsV2).mockResolvedValue({ sections: [], filters_applied: {}, next_cursor: null, has_profile: true, catalog_run: 'r' });
  m(decide.getQuizProgress).mockResolvedValue(null);
  m(decide.removeMyArtist).mockResolvedValue(undefined);
  await act(() => useAuth.getState().signInWithSession(session()));
});

describe('groupArtists', () => {
  it('groups A-Z with accents stripped and non-Latin initials under #', () => {
    const rowsOut = groupArtists(['Étoile', 'Alpha', 'Мария', '1975', 'Ace']);
    expect(rowsOut.map((r) => (r.kind === 'header' ? `[${r.letter}]` : r.name))).toEqual([
      '[A]', 'Ace', 'Alpha', '[E]', 'Étoile', '[#]', '1975', 'Мария',
    ]);
  });
});

describe('artistsAll', () => {
  it('lists artists under letter headers and offers a jump bar of present letters only', async () => {
    renderRouter(appRoutes(), { initialUrl: '/me/artists' });
    expect(await screen.findByTestId('artists-header-A')).toBeTruthy();
    expect(screen.getByTestId('artists-jump-A')).toBeTruthy();
    expect(screen.getByTestId('artists-jump-E')).toBeTruthy();
    expect(screen.getByTestId('artists-jump-#')).toBeTruthy();
    expect(screen.queryByTestId('artists-jump-Q')).toBeNull();
  });

  it('jumping to M scrolls the list to the M header', async () => {
    renderRouter(appRoutes(), { initialUrl: '/me/artists' });
    await screen.findByTestId('artists-header-M');
    // Flat rows: [A] Alpha [B] Beta [E] Etoile [M] ... so the M header is index 6.
    fireEvent.press(screen.getByTestId('artists-jump-M'));
    expect(mockScrollToIndex).toHaveBeenCalledWith(6, expect.anything());
  });

  it('remove calls removeMyArtist with the name', async () => {
    renderRouter(appRoutes(), { initialUrl: '/me/artists' });
    fireEvent.press(await screen.findByTestId('artists-remove-0'));
    await waitFor(() => expect(decide.removeMyArtist).toHaveBeenCalledWith('Alpha Band'));
  });

  it('shows the empty text when there are no artists', async () => {
    rows = [];
    renderRouter(appRoutes(), { initialUrl: '/me/artists' });
    expect(await screen.findByTestId('artists-empty')).toBeTruthy();
  });
});
