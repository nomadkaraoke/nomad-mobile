import { Linking, Platform } from 'react-native';

import { openYouTube, youtubeId, youtubeThumbnail, youtubeTitle } from '../jobs/youtube';

describe('youtubeId', () => {
  it.each([
    ['https://youtu.be/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ?si=abc&t=10', 'dQw4w9WgXcQ'],
    ['http://youtu.be/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['youtu.be/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://youtube.com/watch?feature=share&v=dQw4w9WgXcQ&t=3s', 'dQw4w9WgXcQ'],
    ['https://m.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://music.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/shorts/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/live/dQw4w9WgXcQ?feature=shared', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/embed/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['  https://youtu.be/a-B_c1D2e3F  ', 'a-B_c1D2e3F'],
  ])('%s → %s', (url, id) => {
    expect(youtubeId(url)).toBe(id);
  });

  it.each([
    '',
    'not a url',
    'https://youtu.be/',
    'https://youtu.be/short',
    'https://www.youtube.com/watch?v=',
    'https://www.youtube.com/channel/UCabcdefghijk',
    'https://example.com/watch?v=dQw4w9WgXcQ',
    'https://notyoutube.com/shorts/dQw4w9WgXcQ',
  ])('rejects %p', (url) => {
    expect(youtubeId(url)).toBeNull();
  });
});

it('builds the hqdefault thumbnail URL', () => {
  expect(youtubeThumbnail('dQw4w9WgXcQ')).toBe('https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
});

describe('youtubeTitle (gen build_youtube_title)', () => {
  it('is "Artist - Title (Karaoke)"', () => {
    expect(youtubeTitle({ artist: 'Muse', title: 'Starlight' })).toBe('Muse - Starlight (Karaoke)');
  });

  it('truncates past 95 characters the way gen does (92 + " ...")', () => {
    const t = youtubeTitle({ artist: 'A'.repeat(50), title: 'B'.repeat(50) });
    expect(t).toHaveLength(96);
    expect(t.endsWith(' ...')).toBe(true);
    expect(t.startsWith(`${'A'.repeat(50)} - `)).toBe(true);
  });

  it('fills a missing artist or title like gen ("Unknown")', () => {
    expect(youtubeTitle({ title: 'Starlight' })).toBe('Unknown - Starlight (Karaoke)');
  });
});

describe('openYouTube', () => {
  const canOpen = jest.spyOn(Linking, 'canOpenURL');
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  const os = Platform.OS;

  afterEach(() => {
    jest.clearAllMocks();
    Platform.OS = os;
  });

  it('opens the YouTube app (youtube:// on iOS) when it is installed', async () => {
    Platform.OS = 'ios';
    canOpen.mockResolvedValue(true);
    await openYouTube('dQw4w9WgXcQ');
    expect(canOpen).toHaveBeenCalledWith('youtube://dQw4w9WgXcQ');
    expect(open).toHaveBeenCalledWith('youtube://dQw4w9WgXcQ');
  });

  it('uses vnd.youtube:// on Android', async () => {
    Platform.OS = 'android';
    canOpen.mockResolvedValue(true);
    await openYouTube('dQw4w9WgXcQ');
    expect(open).toHaveBeenCalledWith('vnd.youtube://dQw4w9WgXcQ');
  });

  it('falls back to https://youtu.be/<id> without the app', async () => {
    Platform.OS = 'ios';
    canOpen.mockResolvedValue(false);
    await openYouTube('dQw4w9WgXcQ');
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith('https://youtu.be/dQw4w9WgXcQ');
  });

  it('falls back to the browser when the app link fails to open', async () => {
    Platform.OS = 'android';
    canOpen.mockResolvedValue(true);
    open.mockRejectedValueOnce(new Error('no handler'));
    await openYouTube('dQw4w9WgXcQ');
    expect(open).toHaveBeenCalledWith('vnd.youtube://dQw4w9WgXcQ');
    expect(open).toHaveBeenLastCalledWith('https://youtu.be/dQw4w9WgXcQ');
  });
});
