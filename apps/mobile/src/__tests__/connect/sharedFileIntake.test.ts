// Android Share -> Nomad Karaoke (Phase 3b Task 24): a shared export zip/CSV opens the import screen, whether the share
// cold-started the app or arrived while it was on another screen (Review Focus 5: never "Unmatched Route").
import { act, screen } from '@testing-library/react-native';
import { Slot, useLocalSearchParams } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import { createElement } from 'react';
import { Text } from 'react-native';

import { finishSignIn } from '../../auth/signInUi';
import { useAuth } from '../../auth/store';
import { useSharedFileIntake } from '../../discover/connect/useSharedFileIntake';
import { session } from '../../test-utils/genAuthMock';

type Shared = { uri: string; name: string; mimeType: string };
const mockNative = {
  initial: null as Shared | null,
  listeners: [] as ((f: Shared) => void)[],
};
jest.mock('../../../modules/share-intake', () => ({
  getInitialSharedFile: jest.fn(async () => {
    const f = mockNative.initial;
    mockNative.initial = null; // the native side clears the extra once read
    return f;
  }),
  addSharedFileListener: jest.fn((l: (f: Shared) => void) => {
    mockNative.listeners.push(l);
    return { remove: () => (mockNative.listeners = mockNative.listeners.filter((x) => x !== l)) };
  }),
}));

const SHARED: Shared = {
  uri: 'file:///data/user/0/com.nomadkaraoke.mobile/cache/shared/my_spotify_data.zip',
  name: 'my_spotify_data.zip',
  mimeType: 'application/zip',
};

// The real hook in a minimal app: a root layout that mounts it (as app/_layout.tsx does), Discover, Me, the import
// screen and the sign-in sheet. Any path outside these renders expo-router's "Unmatched Route".
const screenNamed = (name: string) =>
  function Named() {
    return createElement(Text, { testID: name }, name);
  };
function RootLayout() {
  useSharedFileIntake();
  return createElement(Slot);
}
/** Shows its returnTo, so the test can finish sign-in the way the real sheet does. */
function SignIn() {
  return createElement(Text, { testID: 'sign-in' }, useLocalSearchParams<{ returnTo?: string }>().returnTo);
}
const routes = () => ({
  _layout: RootLayout,
  index: screenNamed('discover'),
  me: screenNamed('me'),
  'discover/connect/import-file': screenNamed('import-file'),
  'sign-in/index': SignIn,
});

let app: ReturnType<typeof renderRouter>;
const flush = () => act(async () => {});

beforeEach(() => {
  mockNative.initial = null;
  mockNative.listeners = [];
  useAuth.setState({ state: { status: 'signedIn', session: { ...session(), createdAt: 0 } }, hydrated: true });
});

it('shared zip routes to import-file on a cold start', async () => {
  mockNative.initial = SHARED;
  app = renderRouter(routes(), { initialUrl: '/' });
  await flush();

  expect(app.getPathname()).toBe('/discover/connect/import-file');
  expect(app.getSearchParams()).toEqual({ file: SHARED.uri, name: SHARED.name });
  expect(screen.getByTestId('import-file')).toBeTruthy();
});

it('shared zip routes to import-file when it arrives on another screen', async () => {
  app = renderRouter(routes(), { initialUrl: '/me' });
  await flush();
  expect(app.getPathname()).toBe('/me');

  await act(async () => mockNative.listeners.forEach((l) => l({ ...SHARED, mimeType: 'text/csv', name: 'Apple Music Play Activity.csv' })));

  expect(app.getPathname()).toBe('/discover/connect/import-file');
  expect(app.getSearchParams()).toEqual({ file: SHARED.uri, name: 'Apple Music Play Activity.csv' });
});

it('signed out goes through sign-in, returning to the import screen with the same file', async () => {
  useAuth.setState({ state: { status: 'signedOut' }, hydrated: true });
  // The native side keeps cache names to [A-Za-z0-9._-] (the sign-in returnTo is a nested query string).
  const shared = { ...SHARED, uri: SHARED.uri.replace('my_spotify_data', 'Apple_Media_Services_information'), name: 'Apple_Media_Services_information.zip' };
  mockNative.initial = shared;
  app = renderRouter(routes(), { initialUrl: '/' });
  await flush();
  expect(app.getPathname()).toBe('/sign-in');

  // Signing in finishes on the sign-in sheet's returnTo, as the real sheet does.
  const returnTo = String(screen.getByTestId('sign-in').props.children);
  useAuth.setState({ state: { status: 'signedIn', session: { ...session(), createdAt: 0 } } });
  await act(async () => finishSignIn(returnTo));

  expect(app.getPathname()).toBe('/discover/connect/import-file');
  expect(app.getSearchParams()).toEqual({ file: shared.uri, name: shared.name });
});

it('nothing shared leaves the launch screen alone', async () => {
  app = renderRouter(routes(), { initialUrl: '/' });
  await flush();
  expect(app.getPathname()).toBe('/');
});

it('ios no-op: without the native module there is no shared file and no listener', async () => {
  // The real module wrapper: jest runs as iOS, where the Android-only native module is absent.
  const real = jest.requireActual<typeof import('../../../modules/share-intake')>('../../../modules/share-intake');
  await expect(real.getInitialSharedFile()).resolves.toBeNull();
  const listener = jest.fn();
  const sub = real.addSharedFileListener(listener);
  expect(() => sub.remove()).not.toThrow();
  expect(listener).not.toHaveBeenCalled();
});
