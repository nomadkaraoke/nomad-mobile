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
    useMakeIntent.getState().set({ artist: 'Muse', title: 'Starlight', source: 'typed', editedFields: [], createdAt: Date.now() });
    expect(redirectSystemPath({ path: 'nomadkaraoke://checkout?status=success', initial: true })).toBe('/make/new');
  });

  it('a cold-start checkout return with a stale make intent lands on Me', () => {
    useMakeIntent.getState().set({ artist: 'Muse', title: 'Old', source: 'typed', editedFields: [], createdAt: Date.now() - 31 * 60 * 1000 });
    expect(redirectSystemPath({ path: 'nomadkaraoke://checkout?status=cancelled', initial: true })).toBe('/me');
  });

  it('passes every other link through', () => {
    expect(redirectSystemPath({ path: 'nomadkaraoke://job/abc', initial: false })).toBe('nomadkaraoke://job/abc');
    expect(redirectSystemPath({ path: '/make', initial: true })).toBe('/make');
    expect(redirectSystemPath({ path: 'nomadkaraoke://checkouts', initial: false })).toBe('nomadkaraoke://checkouts');
  });
});

// decide web's Apple Music page hands back to nomadkaraoke://music-connected; Android also delivers it as an intent.
describe('redirectSystemPath: Apple Music hand-back', () => {
  it('keeps the current screen while the app is open', () => {
    expect(redirectSystemPath({ path: 'nomadkaraoke://music-connected?service=apple_music', initial: false })).toBeNull();
  });

  it('a cold start opens the music profile', () => {
    expect(redirectSystemPath({ path: 'nomadkaraoke://music-connected', initial: true })).toBe('/me/music-profile');
  });
});

// decide's ListenBrainz OAuth callback returns to nomadkaraoke://services/listenbrainz?status=…; Android also
// delivers it to Expo Router, which has no such route.
describe('redirectSystemPath: ListenBrainz OAuth return', () => {
  it.each([
    'nomadkaraoke://services/listenbrainz?status=connected',
    'nomadkaraoke://services/listenbrainz?status=error&reason=denied',
    'nomadkaraoke:///services/listenbrainz',
  ])('nativeIntent services return keeps screen when warm (%s)', (path) => {
    expect(redirectSystemPath({ path, initial: false })).toBeNull();
  });

  it('nativeIntent services return opens LB screen when cold, carrying the result', () => {
    expect(redirectSystemPath({ path: 'nomadkaraoke://services/listenbrainz?status=connected', initial: true })).toBe(
      '/discover/connect/listenbrainz?status=connected',
    );
    expect(
      redirectSystemPath({ path: 'nomadkaraoke://services/listenbrainz?status=error&reason=validate_failed', initial: true }),
    ).toBe('/discover/connect/listenbrainz?status=error&reason=validate_failed');
  });

  it('a cold return with no or odd parameters still opens the LB screen, dropping anything unknown', () => {
    expect(redirectSystemPath({ path: 'nomadkaraoke://services/listenbrainz', initial: true })).toBe(
      '/discover/connect/listenbrainz',
    );
    expect(
      redirectSystemPath({ path: 'nomadkaraoke://services/listenbrainz?status=evil&reason=<script>', initial: true }),
    ).toBe('/discover/connect/listenbrainz');
    expect(
      redirectSystemPath({ path: 'nomadkaraoke://services/listenbrainz?status=error&reason=../../x', initial: true }),
    ).toBe('/discover/connect/listenbrainz?status=error');
  });

  it('other services paths are not taken for it', () => {
    expect(redirectSystemPath({ path: 'nomadkaraoke://services/listenbrainzz', initial: false })).toBe(
      'nomadkaraoke://services/listenbrainzz',
    );
  });
});

// Final review I2: the import screen reads (and on leaving deletes) the cache file named in `?file=`. Only the app's
// picker and share intake open it (router.push); a system link to it lands on the Connect hub.
describe('redirectSystemPath: import-file links', () => {
  const offlineDb = encodeURIComponent('file:///data/user/0/com.nomadkaraoke.mobile/cache/offline/offline.db');
  it.each([
    `nomadkaraoke://discover/connect/import-file?file=${offlineDb}&name=x.zip`,
    `nomadkaraoke:///discover/connect/import-file?file=${offlineDb}`,
    '/discover/connect/import-file?file=file%3A%2F%2F%2Fcache%2FDocumentPicker%2Fa.zip',
    'nomadkaraoke://discover/connect/import-file',
    'nomadkaraoke://discover/connect/import-file/',
    'nomadkaraoke://Discover/Connect/Import-File?file=x',
    'nomadkaraoke://discover//connect/import-file?file=x',
    'nomadkaraoke://discover/connect/import%2Dfile?file=x',
    'nomadkaraoke://discover/connect/import%252Dfile?file=x',
    'https://kjbox.cc/discover/connect/import-file?file=x',
  ])('sends %s to the Connect hub', (path) => {
    expect(redirectSystemPath({ path, initial: false })).toBe('/discover/connect');
    expect(redirectSystemPath({ path, initial: true })).toBe('/discover/connect');
  });

  it('leaves other Connect links alone, even with import-file in the query', () => {
    expect(redirectSystemPath({ path: 'nomadkaraoke://discover/connect', initial: true })).toBe('nomadkaraoke://discover/connect');
    expect(redirectSystemPath({ path: 'nomadkaraoke://discover/connect/screenshot?x=import-file', initial: false })).toBe(
      'nomadkaraoke://discover/connect/screenshot?x=import-file',
    );
  });
});
