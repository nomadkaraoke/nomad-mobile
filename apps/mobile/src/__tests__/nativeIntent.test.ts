import { redirectSystemPath } from '../app/+native-intent';
import { useMakeIntent } from '../make/intentStore';

beforeEach(() => useMakeIntent.getState().clear());

// Found by Maestro on Android: the checkout return (nomadkaraoke://checkout?status=…) reaches the app as an
// intent, and Expo Router navigated to an "Unmatched Route" over the credits screen. The in-app browser
// session already reads that URL, so the router must leave the screen where it is.
describe('redirectSystemPath', () => {
  it.each(['nomadkaraoke://checkout?status=success', 'nomadkaraoke://checkout?status=cancelled', 'nomadkaraoke:///checkout'])(
    'ignores the checkout return %s while the app is open',
    (path) => {
      expect(redirectSystemPath({ path, initial: false })).toBeNull();
    },
  );

  it('a checkout return that cold-starts the app lands on Me (where the balance is)', () => {
    expect(redirectSystemPath({ path: 'nomadkaraoke://checkout?status=success', initial: true })).toBe('/me');
  });

  // Android can kill the app during card entry: the song they were making must not be lost.
  it('a cold-start checkout return with a fresh make intent resumes the make flow', () => {
    useMakeIntent.getState().set({ artist: 'Muse', title: 'Starlight', createdAt: Date.now() });
    expect(redirectSystemPath({ path: 'nomadkaraoke://checkout?status=success', initial: true })).toBe('/make/new');
  });

  it('a cold-start checkout return with a stale make intent lands on Me', () => {
    useMakeIntent.getState().set({ artist: 'Muse', title: 'Old', createdAt: Date.now() - 31 * 60 * 1000 });
    expect(redirectSystemPath({ path: 'nomadkaraoke://checkout?status=cancelled', initial: true })).toBe('/me');
  });

  it('passes every other link through', () => {
    expect(redirectSystemPath({ path: 'nomadkaraoke://job/abc', initial: false })).toBe('nomadkaraoke://job/abc');
    expect(redirectSystemPath({ path: '/make', initial: true })).toBe('/make');
    expect(redirectSystemPath({ path: 'nomadkaraoke://checkouts', initial: false })).toBe('nomadkaraoke://checkouts');
  });
});
