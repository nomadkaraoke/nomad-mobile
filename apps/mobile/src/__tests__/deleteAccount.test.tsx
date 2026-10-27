// Me → Account and notifications → Delete account (Phase 6 M4, App Store 5.1.1(v)): gen's preview, the confirm,
// Apple re-auth on iOS, and the rule that the phone is wiped only once gen has deleted the account (or the session
// is gone mid-delete, ruling R30). Offline, timeouts and 503s keep every bit of local data.
import * as AppleAuthentication from 'expo-apple-authentication';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import * as SecureStore from 'expo-secure-store';
import { Alert, Linking, Platform } from 'react-native';

import { wipeLocal } from '../account/wipeLocal';
import { useAuth } from '../auth/store';
import { appStorage } from '../storage';
import { apiError, gen, session } from '../test-utils/genAuthMock';
import { appRoutes } from '../test-utils/routes';

jest.mock('@nomad/api-decide', () => ({
  ...jest.requireActual('@nomad/api-decide'),
  getOfflineIndexManifest: jest.fn(async () => null),
  popularSongs: jest.fn(async () => []),
  pingSearch: jest.fn(async () => true),
  logSearchEvent: jest.fn(async () => {}),
}));
jest.mock('@nomad/api-gen', () => ({
  ...jest.requireActual('@nomad/api-gen'),
  getMe: jest.fn(),
  getDeletionPreview: jest.fn(),
  deleteMyAccount: jest.fn(),
  registerExpoToken: jest.fn(async () => {}),
  deleteExpoToken: jest.fn(async () => {}),
}));
jest.mock('../account/wipeLocal', () => {
  const actual = jest.requireActual('../account/wipeLocal');
  return { wipeLocal: jest.fn((opts) => actual.wipeLocal(opts)) };
});
jest.mock('../offline/offlineIndex', () => ({
  ...jest.requireActual('../offline/offlineIndex'),
  removeOfflineIndex: jest.fn(async () => {}),
}));

const Apple = AppleAuthentication as jest.Mocked<typeof AppleAuthentication>;
const PREVIEW = { credits: 3, jobsInProgress: 2, blocked: null };
const ME = { email: 'me@example.com', credits: 3, capabilities: { accountDeletion: true } };

const openDelete = async () => {
  renderRouter(appRoutes(), { initialUrl: '/me/delete-account' });
  return screen.findByTestId('delete-account-confirm');
};
const confirm = async () => {
  fireEvent.press(await openDelete());
  await act(async () => {});
};

let alert: jest.SpyInstance;
beforeEach(async () => {
  jest.clearAllMocks();
  jest.useRealTimers();
  Platform.OS = 'ios';
  appStorage.clearAll();
  await useAuth.getState().signInWithSession(session(), 'google');
  gen.getMe.mockResolvedValue(ME);
  gen.getDeletionPreview.mockResolvedValue(PREVIEW);
  gen.deleteMyAccount.mockResolvedValue(undefined);
  alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

it('confirm shows credits and jobs counts', async () => {
  await openDelete();
  expect(screen.getByTestId('delete-account-credits')).toHaveTextContent('3 credits will be lost.');
  expect(screen.getByTestId('delete-account-jobs')).toHaveTextContent('2 videos in progress will be cancelled.');
  expect(screen.getByText('• Job and payment records, which we need for accounting')).toBeTruthy();
  expect(screen.getByText('• Your recordings')).toBeTruthy();
});

it('no credits and nothing in progress: neither line shows', async () => {
  gen.getDeletionPreview.mockResolvedValue({ credits: 0, jobsInProgress: 0, blocked: null });
  await openDelete();
  expect(screen.queryByTestId('delete-account-credits')).toBeNull();
  expect(screen.queryByTestId('delete-account-jobs')).toBeNull();
});

it('success wipes then signs out', async () => {
  appStorage.set('some.personal.key', 'x');
  await confirm();
  await waitFor(() => expect(useAuth.getState().state.status).toBe('signedOut'));
  expect(gen.deleteMyAccount).toHaveBeenCalledWith(expect.objectContaining({ appleAuthorizationCode: undefined }));
  expect(wipeLocal).toHaveBeenCalledTimes(1);
  expect(appStorage.getString('some.personal.key')).toBeUndefined();
  // Wiped only after gen's 200.
  expect(gen.deleteMyAccount.mock.invocationCallOrder[0]!).toBeLessThan((wipeLocal as jest.Mock).mock.invocationCallOrder[0]!);
  await waitFor(() => expect(alert).toHaveBeenCalledWith('Your account was deleted', expect.any(String), expect.any(Array)));
  // Back to the start (Discover), no longer on the delete screen.
  await waitFor(() => expect(screen.queryByTestId('delete-account-screen')).toBeNull());
});

it('503 keeps local data and offers retry', async () => {
  gen.deleteMyAccount.mockRejectedValueOnce(apiError(503, { step: 'dropbox' }));
  appStorage.set('some.personal.key', 'x');
  await confirm();
  expect(await screen.findByTestId('delete-account-retry-message')).toHaveTextContent(
    'Something went wrong part-way. Please try again — deletion picks up where it left off.',
  );
  expect(wipeLocal).not.toHaveBeenCalled();
  expect(useAuth.getState().state.status).toBe('signedIn');
  expect(appStorage.getString('some.personal.key')).toBe('x');
  // The retry sends the DELETE again; this time gen finishes.
  fireEvent.press(screen.getByTestId('delete-account-confirm'));
  await waitFor(() => expect(useAuth.getState().state.status).toBe('signedOut'));
  expect(gen.deleteMyAccount).toHaveBeenCalledTimes(2);
});

it('offline keeps local data', async () => {
  gen.deleteMyAccount.mockRejectedValueOnce(apiError(0, new TypeError('Network request failed')));
  appStorage.set('some.personal.key', 'x');
  await confirm();
  expect(await screen.findByTestId('delete-account-retry-message')).toHaveTextContent(
    "Couldn't delete your account. Check your connection and try again.",
  );
  expect(wipeLocal).not.toHaveBeenCalled();
  expect(useAuth.getState().state.status).toBe('signedIn');
  expect(appStorage.getString('some.personal.key')).toBe('x');
});

it('a request that never answers is aborted and keeps local data', async () => {
  jest.useFakeTimers();
  gen.deleteMyAccount.mockImplementationOnce(
    ({ signal } = {}) =>
      new Promise((_, reject) => signal?.addEventListener('abort', () => reject(apiError(0, 'aborted')))),
  );
  await confirm();
  await act(async () => {
    jest.advanceTimersByTime(60_000);
  });
  jest.useRealTimers();
  expect(await screen.findByTestId('delete-account-retry-message')).toBeTruthy();
  expect(wipeLocal).not.toHaveBeenCalled();
  expect(useAuth.getState().state.status).toBe('signedIn');
});

it('409 shows support', async () => {
  gen.deleteMyAccount.mockRejectedValueOnce(apiError(409, { code: 'order_in_progress' }));
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  await confirm();
  expect(await screen.findByText(/order in progress/)).toBeTruthy();
  fireEvent.press(screen.getByTestId('delete-account-support'));
  expect(open).toHaveBeenCalledWith('mailto:support@nomadkaraoke.com');
  expect(screen.queryByTestId('delete-account-confirm')).toBeNull();
  expect(wipeLocal).not.toHaveBeenCalled();
  expect(useAuth.getState().state.status).toBe('signedIn');
});

it('409 with an unknown code shows the generic support copy', async () => {
  gen.deleteMyAccount.mockRejectedValueOnce(apiError(409, { code: 'brand_new_reason' }));
  await confirm();
  expect(await screen.findByText("We can't delete this account from the app.")).toBeTruthy();
  expect(screen.getByTestId('delete-account-support')).toBeTruthy();
});

it('a blocked preview shows support and no confirm', async () => {
  gen.getDeletionPreview.mockResolvedValue({ credits: 0, jobsInProgress: 0, blocked: 'admin' });
  renderRouter(appRoutes(), { initialUrl: '/me/delete-account' });
  expect(await screen.findByTestId('delete-account-blocked')).toBeTruthy();
  expect(screen.queryByTestId('delete-account-confirm')).toBeNull();
  expect(screen.getByTestId('delete-account-keep')).toBeTruthy();
});

it('deletion off on gen (404 preview): support copy and Keep my account', async () => {
  gen.getDeletionPreview.mockRejectedValue(apiError(404, 'Not Found'));
  renderRouter(appRoutes(), { initialUrl: '/me/delete-account' });
  expect(await screen.findByText("Deleting your account from the app isn't available right now.")).toBeTruthy();
  expect(screen.getByTestId('delete-account-keep')).toBeTruthy();
  expect(screen.queryByTestId('delete-account-confirm')).toBeNull();
});

it('two taps in one frame send one DELETE', async () => {
  let finish: () => void = () => {};
  gen.deleteMyAccount.mockImplementation(() => new Promise<void>((r) => (finish = r)));
  const button = await openDelete();
  await act(async () => {
    fireEvent.press(button);
    fireEvent.press(button);
  });
  expect(gen.deleteMyAccount).toHaveBeenCalledTimes(1);
  await act(async () => finish());
  await waitFor(() => expect(useAuth.getState().state.status).toBe('signedOut'));
});

it('401 during the confirm wipes, signs out and says so neutrally (R30)', async () => {
  gen.deleteMyAccount.mockRejectedValueOnce(apiError(401, 'Not authenticated'));
  await confirm();
  await waitFor(() => expect(useAuth.getState().state.status).toBe('signedOut'));
  expect(wipeLocal).toHaveBeenCalledTimes(1);
  await waitFor(() =>
    expect(alert).toHaveBeenCalledWith(
      "You've been signed out",
      "You've been signed out. If you just deleted your account, it's gone. Otherwise sign in and try again.",
      expect.any(Array),
    ),
  );
});

it('401 with a registered push token leaves no pending unregister behind (R30)', async () => {
  appStorage.set('push.expoToken.v1', 'ExponentPushToken[me]');
  // What gen's client does on a 401: its onUnauthorized signs out (sessionDead) before the call rejects, and the
  // push sign-out listener then notes a pending unregister for the dead session.
  gen.deleteMyAccount.mockImplementationOnce(async () => {
    void useAuth.getState().signOut({ sessionDead: true });
    throw apiError(401, 'Not authenticated');
  });
  await confirm();
  await waitFor(() => expect(alert).toHaveBeenCalledWith("You've been signed out", expect.any(String), expect.any(Array)));
  await act(async () => {});
  expect(await SecureStore.getItemAsync('push.pendingUnregister.v1')).toBeNull();
  expect(appStorage.getString('push.expoToken.v1')).toBeUndefined();
  expect(gen.deleteExpoToken).not.toHaveBeenCalled();
});

it('apple user on iOS passes authorization code', async () => {
  await useAuth.getState().signInWithSession(session(), 'apple');
  Apple.signInAsync.mockResolvedValue({ authorizationCode: 'apple-code', identityToken: 'id' } as never);
  await confirm();
  await waitFor(() => expect(gen.deleteMyAccount).toHaveBeenCalled());
  expect(Apple.signInAsync).toHaveBeenCalledWith({ requestedScopes: [] });
  expect(gen.deleteMyAccount).toHaveBeenCalledWith(expect.objectContaining({ appleAuthorizationCode: 'apple-code' }));
});

it('apple cancel aborts', async () => {
  await useAuth.getState().signInWithSession(session(), 'apple');
  Apple.signInAsync.mockRejectedValue(Object.assign(new Error('cancelled'), { code: 'ERR_REQUEST_CANCELED' }));
  await confirm();
  await waitFor(() => expect(Apple.signInAsync).toHaveBeenCalled());
  expect(gen.deleteMyAccount).not.toHaveBeenCalled();
  expect(wipeLocal).not.toHaveBeenCalled();
  expect(useAuth.getState().state.status).toBe('signedIn');
  expect(screen.getByTestId('delete-account-confirm')).toBeTruthy();
});

it('a Google account, or an Apple account on Android, is never asked to sign in with Apple', async () => {
  await confirm();
  await waitFor(() => expect(gen.deleteMyAccount).toHaveBeenCalled());
  expect(Apple.signInAsync).not.toHaveBeenCalled();
});

it('row hidden without capability', async () => {
  gen.getMe.mockResolvedValue({ email: 'me@example.com', credits: 3 });
  renderRouter(appRoutes(), { initialUrl: '/me/account' });
  await screen.findByTestId('account-notifications');
  await waitFor(() => expect(gen.getMe).toHaveBeenCalled());
  await act(async () => {});
  expect(screen.queryByTestId('account-delete')).toBeNull();
});

it('row shown with capability opens the delete screen', async () => {
  renderRouter(appRoutes(), { initialUrl: '/me/account' });
  fireEvent.press(await screen.findByTestId('account-delete'));
  expect(await screen.findByTestId('delete-account-screen')).toBeTruthy();
});
