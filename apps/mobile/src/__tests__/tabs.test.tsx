import * as decide from '@nomad/api-decide';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { GoogleAuth } from 'react-native-google-auth';

import { useAuth } from '../auth/store';
import { gen, session } from '../test-utils/genAuthMock';
import { makeRoutes } from '../test-utils/makeFixtures';

jest.mock('@nomad/api-decide', () => ({
  searchCatalogSongs: jest.fn(),
  popularCatalogSongs: jest.fn(async () => []),
  getSong: jest.fn(),
  configureClient: jest.fn(),
}));
jest.mock('@nomad/api-gen', () => ({
  ...jest.requireActual('@nomad/api-gen'),
  getMe: jest.fn(),
  exchangeGoogleToken: jest.fn(),
  listMyJobs: jest.fn(),
}));

beforeEach(async () => {
  jest.useRealTimers();
  jest.clearAllMocks();
  (decide.popularCatalogSongs as jest.Mock).mockResolvedValue([]);
  await useAuth.getState().signOut();
  gen.getMe.mockResolvedValue({ email: 'me@example.com', credits: 3 });
  gen.listMyJobs.mockResolvedValue([]);
});

it('opens on Discover and shows four tabs: Discover, Tonight, Make, Me', async () => {
  const app = renderRouter(makeRoutes(), { initialUrl: '/' });
  expect(await screen.findByTestId('discover-search-input')).toBeTruthy();
  expect(app.getPathname()).toBe('/discover');
  for (const id of ['tab-discover', 'tab-tonight', 'tab-make', 'tab-me']) expect(screen.getByTestId(id)).toBeTruthy();
  expect(screen.getByText('Discover')).toBeTruthy();
  expect(screen.getByText('Tonight')).toBeTruthy();
  expect(screen.getByText('Make')).toBeTruthy();
  expect(screen.getByText('Me')).toBeTruthy();
});

it('Tonight is a coming-soon placeholder', async () => {
  renderRouter(makeRoutes(), { initialUrl: '/tonight' });
  expect(await screen.findByText("Coming soon: your requests and tonight's queue")).toBeTruthy();
});

it('Me (signed in): credits from gen, Buy credits, language, email and sign out', async () => {
  await useAuth.getState().signInWithSession(session());
  const app = renderRouter(makeRoutes(), { initialUrl: '/me' });
  expect(await screen.findByText('3 credits')).toBeTruthy();
  expect(screen.getByTestId('me-credits')).toHaveTextContent('3 credits');
  expect(screen.getByText('Signed in as \u2068me@example.com\u2069')).toBeTruthy();
  expect(screen.getByTestId('me-language')).toHaveTextContent('English');
  fireEvent.press(screen.getByTestId('me-buy'));
  expect(await screen.findByTestId('credits-stub')).toBeTruthy();
  expect(app.getPathname()).toBe('/credits');
});

it('Me: sign out returns to the signed-out state', async () => {
  await useAuth.getState().signInWithSession(session());
  renderRouter(makeRoutes(), { initialUrl: '/me' });
  await act(async () => fireEvent.press(await screen.findByTestId('me-signout')));
  expect(await screen.findByTestId('me-signin')).toBeTruthy();
  expect(screen.queryByTestId('me-credits')).toBeNull();
});

it('Make tab (signed out) offers sign-in that returns to the Make tab', async () => {
  (GoogleAuth.signIn as jest.Mock).mockResolvedValueOnce({ type: 'success', data: { idToken: 'gid' } });
  gen.exchangeGoogleToken.mockResolvedValue(session('g@example.com'));
  const app = renderRouter(makeRoutes(), { initialUrl: '/discover' });
  fireEvent.press(await screen.findByTestId('tab-make'));
  fireEvent.press(await screen.findByTestId('make-tab-signin'));
  expect(await screen.findByTestId('signin-sheet')).toBeTruthy();
  expect(app.getSearchParams()).toMatchObject({ returnTo: '/(tabs)/make' });
  await act(async () => fireEvent.press(screen.getByTestId('signin-google')));
  expect(await screen.findByTestId('make-empty')).toBeTruthy();
  expect(app.getSegments()).toEqual(['(tabs)', 'make']);
  expect(useAuth.getState().state.status).toBe('signedIn');
});
