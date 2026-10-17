import * as decide from '@nomad/api-decide';
import { fireEvent, screen } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { View } from 'react-native';

import { useAuth } from '../auth/store';
import { useMakeIntent } from '../make/intentStore';
import { session } from '../test-utils/genAuthMock';
import { signInRoutes } from '../test-utils/signInRoutes';

jest.mock('@nomad/api-decide', () => ({
  searchSongs: jest.fn(),
  popularSongs: jest.fn(async () => []),
  getSong: jest.fn(),
  configureClient: jest.fn(),
}));
const getSong = decide.getSong as jest.Mock;

const routes = () => ({ ...signInRoutes(), 'sign-in/index': () => <View testID="signin-stub" /> });

beforeEach(async () => {
  jest.useRealTimers();
  jest.clearAllMocks();
  await useAuth.getState().signOut();
  useMakeIntent.getState().clear();
  getSong.mockResolvedValue({ id: 7, artist: 'Muse', title: 'Starlight', brands: [], brand_count: 0, is_popular: true });
});

it('a song with no karaoke version: gold badge and "Make it · 1 credit" (disabled until it loads)', async () => {
  renderRouter(routes(), { initialUrl: '/song/7' });
  expect(screen.getByTestId('song-make')).toBeDisabled();
  expect(await screen.findByText('Starlight')).toBeTruthy();
  expect(screen.getByTestId('song-make')).toBeEnabled();
  expect(screen.getByTestId('song-badge')).toHaveTextContent('No karaoke version found');
  expect(screen.getByTestId('song-make')).toHaveTextContent('Make it · 1 credit');
});

it('a song with karaoke versions still offers Make it', async () => {
  getSong.mockResolvedValue({ id: 7, artist: 'Muse', title: 'Starlight', brands: ['SF'], brand_count: 2, is_popular: true });
  renderRouter(routes(), { initialUrl: '/song/7' });
  expect(await screen.findByText('Karaoke versions exist')).toBeTruthy();
  expect(screen.getByTestId('song-make')).toBeEnabled();
});

it('signed out: Make it sets the intent and opens the sign-in sheet for /make/new', async () => {
  const app = renderRouter(routes(), { initialUrl: '/song/7' });
  await screen.findByText('Starlight');
  fireEvent.press(screen.getByTestId('song-make'));
  expect(await screen.findByTestId('signin-stub')).toBeTruthy();
  expect(app.getPathname()).toBe('/sign-in');
  expect(app.getSearchParams()).toMatchObject({ returnTo: '/make/new' });
  expect(useMakeIntent.getState().get()).toMatchObject({ artist: 'Muse', title: 'Starlight', decideSongId: 7 });
});

it('signed in: Make it goes straight to the make flow', async () => {
  await useAuth.getState().signInWithSession(session());
  const app = renderRouter(routes(), { initialUrl: '/song/7' });
  await screen.findByText('Starlight');
  fireEvent.press(screen.getByTestId('song-make'));
  expect(await screen.findByTestId('make-stub')).toBeTruthy();
  expect(app.getPathname()).toBe('/make/new');
  expect(useMakeIntent.getState().get()).toMatchObject({ title: 'Starlight' });
});

it('make any song: typed artist and title become the intent', async () => {
  await useAuth.getState().signInWithSession(session());
  renderRouter(routes(), { initialUrl: '/song/new' });
  expect(await screen.findByTestId('song-make')).toBeDisabled();
  fireEvent.changeText(screen.getByTestId('song-artist'), ' Muse ');
  fireEvent.changeText(screen.getByTestId('song-title'), 'Uprising');
  fireEvent.press(screen.getByTestId('song-make'));
  expect(await screen.findByTestId('make-stub')).toBeTruthy();
  const intent = useMakeIntent.getState().get();
  expect(intent).toMatchObject({ artist: 'Muse', title: 'Uprising' });
  expect(intent?.decideSongId).toBeUndefined();
  expect(getSong).not.toHaveBeenCalled();
});
