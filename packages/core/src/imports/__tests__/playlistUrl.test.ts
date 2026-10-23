import { classifyPlaylistUrl } from '../index';

describe('classifyPlaylistUrl', () => {
  it.each([
    ['https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M', { service: 'spotify', url: 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M' }],
    ['https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=abc123&pt=x', { service: 'spotify', url: 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M' }],
    ['Check out this playlist on Spotify: https://open.spotify.com/intl-de/playlist/1AbCdEfGh2?si=z.', { service: 'spotify', url: 'https://open.spotify.com/playlist/1AbCdEfGh2' }],
    ['open.spotify.com/user/fixture-user/playlist/1AbCdEfGh2', { service: 'spotify', url: 'https://open.spotify.com/playlist/1AbCdEfGh2' }],
    ['spotify:playlist:1AbCdEfGh2', { service: 'spotify', url: 'https://open.spotify.com/playlist/1AbCdEfGh2' }],
    ['https://music.youtube.com/playlist?list=PLfixture_123-abc&si=xyz', { service: 'youtube_music', url: 'https://music.youtube.com/playlist?list=PLfixture_123-abc' }],
    ['https://www.youtube.com/playlist?list=PLfixture_123', { service: 'youtube_music', url: 'https://www.youtube.com/playlist?list=PLfixture_123' }],
    ['youtube.com/playlist?feature=share&list=PLfixture_123', { service: 'youtube_music', url: 'https://www.youtube.com/playlist?list=PLfixture_123' }],
    ['Listen: m.youtube.com/playlist?list=PLx1', { service: 'youtube_music', url: 'https://www.youtube.com/playlist?list=PLx1' }],
    ['https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC', null],
    ['https://www.youtube.com/watch?v=abc', null],
    ['https://example.com/playlist?list=PL1', null],
    ['not a link at all', null],
    ['', null],
  ])('%s', (text, expected) => {
    expect(classifyPlaylistUrl(text)).toEqual(expected);
  });
});
