import { redirectSystemPath } from '../app/+native-intent';

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

  it('passes every other link through', () => {
    expect(redirectSystemPath({ path: 'nomadkaraoke://job/abc', initial: false })).toBe('nomadkaraoke://job/abc');
    expect(redirectSystemPath({ path: '/make', initial: true })).toBe('/make');
    expect(redirectSystemPath({ path: 'nomadkaraoke://checkouts', initial: false })).toBe('nomadkaraoke://checkouts');
  });
});
