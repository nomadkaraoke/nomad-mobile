import * as SecureStore from 'expo-secure-store';

import { useAuth } from '../auth/store';

beforeEach(async () => {
  await useAuth.getState().signOut();
  jest.clearAllMocks();
});

it('happy path: email → code → signedIn, persisted', async () => {
  await useAuth.getState().requestCode('  Me@Example.com ');
  expect(useAuth.getState().state).toEqual({ status: 'codeSent', email: 'me@example.com' });
  await useAuth.getState().verify('123 456');
  const s = useAuth.getState().state;
  expect(s.status).toBe('signedIn');
  expect(s.status === 'signedIn' && s.session.email).toBe('me@example.com');
  expect(useAuth.getState().getToken()).toBeTruthy();
  expect(SecureStore.setItemAsync).toHaveBeenCalledTimes(1);
});

it('rejects an invalid email without calling the API', async () => {
  await expect(useAuth.getState().requestCode('nope')).rejects.toThrow('invalid_email');
  expect(useAuth.getState().state.status).toBe('signedOut');
});

it('rejects a malformed code client-side', async () => {
  await useAuth.getState().requestCode('me@example.com');
  await expect(useAuth.getState().verify('12345')).rejects.toThrow('invalid_code_format');
  expect(useAuth.getState().state.status).toBe('codeSent');
});

it('wrong code keeps codeSent state', async () => {
  await useAuth.getState().requestCode('me@example.com');
  await expect(useAuth.getState().verify('000000')).rejects.toMatchObject({ status: 400 });
  expect(useAuth.getState().state.status).toBe('codeSent');
});

it('hydrate restores a persisted session; signOut clears it', async () => {
  await useAuth.getState().requestCode('me@example.com');
  await useAuth.getState().verify('123456');
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
  await useAuth.getState().requestCode('me@example.com');
  await useAuth.getState().verify('123456');
  jest.clearAllMocks();
  await Promise.all([useAuth.getState().signOut(), useAuth.getState().signOut(), useAuth.getState().signOut()]);
  expect(useAuth.getState().state.status).toBe('signedOut');
  expect(SecureStore.deleteItemAsync).toHaveBeenCalledTimes(1);
});

it('after a reinstall, discards a session the iOS Keychain kept from the previous install', async () => {
  await useAuth.getState().requestCode('me@example.com');
  await useAuth.getState().verify('123456');
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
  await useAuth.getState().requestCode('me@example.com');
  await useAuth.getState().verify('123456'); // sets the install marker
  await SecureStore.setItemAsync('nomad.session.v1', raw);
  useAuth.setState({ state: { status: 'signedOut' }, hydrated: false });
  await useAuth.getState().hydrate();
  expect(useAuth.getState().state.status).toBe('signedOut');
  expect(useAuth.getState().getToken()).toBeNull();
});
