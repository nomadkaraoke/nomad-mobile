import { useAuth } from '../../../auth/store';
import { getPurchases } from '../index';

jest.mock('../index', () => {
  const adapter = { configure: jest.fn(async () => {}), logOut: jest.fn(async () => {}) };
  return { getPurchases: jest.fn(() => adapter) };
});

const adapter = (getPurchases as jest.Mock)() as { logOut: jest.Mock };

beforeEach(() => jest.clearAllMocks());

it('logOut on sign-out: the store customer is forgotten', async () => {
  await useAuth.getState().signInWithSession({ token: 't', email: 'a@b.co', credits: 0, creditsGranted: 0 });
  await useAuth.getState().signOut();
  expect(adapter.logOut).toHaveBeenCalledTimes(1);
});

it('a failing store logOut never blocks sign-out', async () => {
  adapter.logOut.mockRejectedValueOnce(new Error('store down'));
  await useAuth.getState().signInWithSession({ token: 't', email: 'a@b.co', credits: 0, creditsGranted: 0 });
  await expect(useAuth.getState().signOut()).resolves.toBeUndefined();
  expect(useAuth.getState().state.status).toBe('signedOut');
});

it('IAP off: sign-out works without an adapter', async () => {
  (getPurchases as jest.Mock).mockReturnValueOnce(null);
  await useAuth.getState().signInWithSession({ token: 't', email: 'a@b.co', credits: 0, creditsGranted: 0 });
  await expect(useAuth.getState().signOut()).resolves.toBeUndefined();
});
