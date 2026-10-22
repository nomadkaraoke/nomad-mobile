import { redirectSystemPath } from '../../app/+native-intent';

// Ruling E3-R1: every night-link form the system hands the app opens the join route; anything else passes through.
describe('night links open the join route', () => {
  it.each([
    // The printed QR (A.87): uppercase so the QR uses alphanumeric mode.
    'HTTP://KJBOX.CC/2121',
    'http://kjbox.cc/2121',
    'https://kjbox.cc/2121',
    'https://kjbox.cc/2121/',
    'https://www.kjbox.cc/2121',
    'HTTPS://WWW.KJBOX.CC/2121',
    'https://sing.nomadkaraoke.com/?t=2121',
    'HTTPS://SING.NOMADKARAOKE.COM/?t=2121',
    'nomadkaraoke://tonight?t=2121',
    'nomadkaraoke:///tonight?t=2121',
  ])('native intent maps kjbox.cc uppercase and every other form: %s', (path) => {
    expect(redirectSystemPath({ path, initial: true })).toBe('/tonight/join?t=2121');
    expect(redirectSystemPath({ path, initial: false })).toBe('/tonight/join?t=2121');
  });

  it.each([
    'https://kjbox.cc/abc',
    'https://kjbox.cc/',
    'https://example.com/2121',
    'https://sing.nomadkaraoke.com/admin?t=2121',
    'nomadkaraoke://tonight',
    'nomadkaraoke://job/abc',
    '/tonight/join?t=2121',
    '/tonight',
    '2121',
  ])('leaves %s unchanged', (path) => {
    expect(redirectSystemPath({ path, initial: false })).toBe(path);
  });
});
