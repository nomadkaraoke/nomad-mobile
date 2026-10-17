import * as SecureStore from 'expo-secure-store';

import { MAX_CODE_ATTEMPTS } from '../auth/authApi';
import { useAuth } from '../auth/store';
import { apiError, gen, session } from '../test-utils/genAuthMock';

jest.mock('@nomad/api-gen', () => ({
  ...jest.requireActual('@nomad/api-gen'),
  sendCode: jest.fn(),
  verifyCode: jest.fn(),
}));

beforeEach(async () => {
  await useAuth.getState().signOut();
  jest.clearAllMocks();
  gen.sendCode.mockResolvedValue(undefined);
  gen.verifyCode.mockImplementation(async (email) => session(email));
});

const signIn = async () => {
  await useAuth.getState().requestCode('me@example.com');
  await useAuth.getState().verify('123456');
};

it('happy path: email → code → signedIn with the gen session token, persisted', async () => {
  await useAuth.getState().requestCode('  Me@Example.com ');
  expect(gen.sendCode).toHaveBeenCalledWith('me@example.com', 'en');
  expect(useAuth.getState().state).toEqual({ status: 'codeSent', email: 'me@example.com' });
  await useAuth.getState().verify('123 456');
  expect(gen.verifyCode).toHaveBeenCalledWith('me@example.com', '123456');
  const s = useAuth.getState().state;
  expect(s.status === 'signedIn' && s.session.email).toBe('me@example.com');
  expect(useAuth.getState().getToken()).toBe('tok-me@example.com');
  expect(SecureStore.setItemAsync).toHaveBeenCalledTimes(1);
});

it('rejects an invalid email or malformed code without calling gen', async () => {
  await expect(useAuth.getState().requestCode('nope')).rejects.toThrow('invalid_email');
  expect(gen.sendCode).not.toHaveBeenCalled();
  await useAuth.getState().requestCode('me@example.com');
  await expect(useAuth.getState().verify('12345')).rejects.toThrow('invalid_code_format');
  expect(gen.verifyCode).not.toHaveBeenCalled();
  expect(useAuth.getState().attemptsLeft).toBe(MAX_CODE_ATTEMPTS);
});

const verifyError = (code = '000000') => useAuth.getState().verify(code).then(() => null, (e: unknown) => e);

it('counts wrong codes down from 5; the 5th wrong code says locked and no 6th request is sent', async () => {
  gen.verifyCode.mockRejectedValue(apiError(401, 'invalid_code'));
  await useAuth.getState().requestCode('me@example.com');
  for (const left of [4, 3, 2, 1]) {
    expect(await verifyError()).toMatchObject({ kind: 'invalid', attemptsLeft: left });
  }
  expect(await verifyError()).toMatchObject({ kind: 'locked', attemptsLeft: 0 });
  expect(gen.verifyCode).toHaveBeenCalledTimes(5);
  expect(await verifyError()).toMatchObject({ kind: 'locked' });
  expect(gen.verifyCode).toHaveBeenCalledTimes(5);
  expect(useAuth.getState().state.status).toBe('codeSent');
});

it('429 too_many_attempts locks; requesting a new code resets the attempts', async () => {
  gen.verifyCode.mockRejectedValueOnce(apiError(429, 'too_many_attempts'));
  await useAuth.getState().requestCode('me@example.com');
  expect(await verifyError()).toMatchObject({ kind: 'locked', attemptsLeft: 0 });
  expect(useAuth.getState().attemptsLeft).toBe(0);
  await useAuth.getState().requestCode('me@example.com');
  expect(gen.sendCode).toHaveBeenCalledTimes(2);
  expect(useAuth.getState().attemptsLeft).toBe(MAX_CODE_ATTEMPTS);
  await useAuth.getState().verify('123456');
  expect(useAuth.getState().state.status).toBe('signedIn');
});

it.each([
  [apiError(401, 'expired'), 'expired'],
  [new TypeError('Network request failed'), 'network'],
  [apiError(0, undefined), 'network'],
  [apiError(502, 'bad gateway'), 'network'],
  [apiError(400, 'weird'), 'failed'],
])('verify maps %p to %s', async (err, kind) => {
  gen.verifyCode.mockRejectedValueOnce(err);
  await useAuth.getState().requestCode('me@example.com');
  expect(await verifyError()).toMatchObject({ kind });
  expect(useAuth.getState().state.status).toBe('codeSent');
});

it.each([
  [apiError(429, 'too_many_codes'), 'tooManyCodes'],
  [apiError(422, 'Disposable email addresses are not allowed.'), 'disposable'],
  [apiError(422, [{ msg: 'field required' }]), 'failed'],
  [new TypeError('Network request failed'), 'network'],
])('requestCode maps %p to %s and stays signed out', async (err, kind) => {
  gen.sendCode.mockRejectedValueOnce(err);
  await expect(useAuth.getState().requestCode('me@example.com')).rejects.toMatchObject({ kind });
  expect(useAuth.getState().state.status).toBe('signedOut');
});

it('verify without a pending code throws', async () => {
  await expect(useAuth.getState().verify('123456')).rejects.toThrow('no_pending_code');
});

it('signInWithSession stores any provider’s session', async () => {
  await useAuth.getState().signInWithSession(session('g@example.com'));
  expect(useAuth.getState().getToken()).toBe('tok-g@example.com');
  useAuth.setState({ state: { status: 'signedOut' }, hydrated: false });
  await useAuth.getState().hydrate();
  const s = useAuth.getState().state;
  expect(s.status === 'signedIn' && s.session.email).toBe('g@example.com');
});

it('hydrate restores a persisted session; signOut clears it', async () => {
  await signIn();
  useAuth.setState({ state: { status: 'signedOut' }, hydrated: false });
  await useAuth.getState().hydrate();
  expect(useAuth.getState().state.status).toBe('signedIn');
  await useAuth.getState().signOut();
  await useAuth.getState().hydrate();
  expect(useAuth.getState().state.status).toBe('signedOut');
});

it('hydrate discards a corrupt stored session', async () => {
  await SecureStore.setItemAsync('nomad.session.v1', '{not json');
  await useAuth.getState().hydrate();
  expect(useAuth.getState().state.status).toBe('signedOut');
  expect(await SecureStore.getItemAsync('nomad.session.v1')).toBeNull();
});

it('repeated signOut (401 storm) touches storage only once', async () => {
  await signIn();
  jest.clearAllMocks();
  await Promise.all([useAuth.getState().signOut(), useAuth.getState().signOut(), useAuth.getState().signOut()]);
  expect(useAuth.getState().state.status).toBe('signedOut');
  expect(SecureStore.deleteItemAsync).toHaveBeenCalledTimes(1);
});

it('after a reinstall, discards a session the iOS Keychain kept from the previous install', async () => {
  await signIn();
  // Reinstall: app storage (MMKV) is wiped, Keychain (SecureStore) is not.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('react-native-mmkv').__resetMMKV();
  useAuth.setState({ state: { status: 'signedOut' }, hydrated: false });
  await useAuth.getState().hydrate();
  expect(useAuth.getState().state.status).toBe('signedOut');
  expect(await SecureStore.getItemAsync('nomad.session.v1')).toBeNull();
});

it('a keychain read failure still finishes hydrating (signed out) instead of leaving a blank app', async () => {
  (SecureStore.getItemAsync as jest.Mock).mockRejectedValueOnce(new Error('keychain locked'));
  useAuth.setState({ state: { status: 'signedOut' }, hydrated: false });
  await expect(useAuth.getState().hydrate()).resolves.toBeUndefined();
  expect(useAuth.getState().hydrated).toBe(true);
  expect(useAuth.getState().state.status).toBe('signedOut');
});

it.each(['null', '{}', '{"token":1,"email":"a@b.co"}'])('treats malformed stored session %s as signed out', async (raw) => {
  await signIn(); // sets the install marker
  await SecureStore.setItemAsync('nomad.session.v1', raw);
  useAuth.setState({ state: { status: 'signedOut' }, hydrated: false });
  await useAuth.getState().hydrate();
  expect(useAuth.getState().state.status).toBe('signedOut');
  expect(useAuth.getState().getToken()).toBeNull();
});
