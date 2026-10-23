// The app's one YouTube module (Phase 3d D3): id parsing, URLs, gen's title, opening a video, and the link
// Tonight hands a host. Moved here from jobs/youtube.ts and tonight/other/YouTubeLink.ts.
import type { Version } from '@nomad/api-decide';
import type { JobSummary } from '@nomad/api-gen';
import { Linking } from 'react-native';

import {
  openYouTube,
  openYouTubeUrl,
  youTubeLinkFor,
  youtubeId,
  youtubeShortUrl,
  youtubeThumbnail,
  youtubeTitle,
  youtubeWatchUrl,
} from '../../media/youtube';

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

it('builds the watch and short URLs', () => {
  expect(youtubeWatchUrl('dQw4w9WgXcQ')).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  expect(youtubeShortUrl('dQw4w9WgXcQ')).toBe('https://youtu.be/dQw4w9WgXcQ');
});

describe('openYouTube (spike D1: the https watch URL is a universal / app link; never probe canOpenURL)', () => {
  const canOpen = jest.spyOn(Linking, 'canOpenURL');
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);

  afterEach(() => jest.clearAllMocks());

  it('opens https://www.youtube.com/watch?v=<id>, which the YouTube app claims when installed', async () => {
    await openYouTube('dQw4w9WgXcQ');
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(canOpen).not.toHaveBeenCalled();
  });

  it('passes a failure to open on to the caller', async () => {
    open.mockRejectedValueOnce(new Error('no handler'));
    await expect(openYouTube('dQw4w9WgXcQ')).rejects.toThrow('no handler');
  });
});

describe('openYouTubeUrl', () => {
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);

  afterEach(() => jest.clearAllMocks());

  it('opens any YouTube link form through the watch URL', async () => {
    await openYouTubeUrl('https://youtu.be/dQw4w9WgXcQ?si=abc');
    expect(open).toHaveBeenCalledWith('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  });

  it('opens any other link as it is', async () => {
    await openYouTubeUrl('https://example.com/video');
    expect(open).toHaveBeenCalledWith('https://example.com/video');
  });
});

const job = (over: Partial<JobSummary> & { youtube_url?: string }): JobSummary => {
  const { youtube_url, ...rest } = over;
  return { job_id: 'j1', status: 'complete', progress: 100, artist: 'Muse', title: 'Starlight', state_data: youtube_url ? { youtube_url } : {}, ...rest } as JobSummary;
};
const v = (kind: Version['kind'], youtube_url: string | null): Version => ({ brand_code: 'B', brand_name: 'B', kind, youtube_url, rank: 0 });
const SONG = { artist: 'Muse', title: 'Starlight' };

describe('youTubeLinkFor (Tonight E9-R4)', () => {
  it("prefers the user's own gen video for the same artist + title", () => {
    expect(
      youTubeLinkFor(SONG, {
        jobs: [job({ title: 'Uprising', youtube_url: 'https://youtu.be/other000000' }), job({ title: 'starlight', youtube_url: 'https://youtu.be/mine0000000' })],
        versions: [v('community', 'https://youtu.be/comm0000000')],
      }),
    ).toBe('https://youtu.be/mine0000000');
  });

  it("falls back to a community version's youtube_url, never a commercial one", () => {
    expect(youTubeLinkFor(SONG, { jobs: [job({})], versions: [v('commercial', 'https://youtu.be/com00000000'), v('community', 'https://youtu.be/comm0000000')] })).toBe(
      'https://youtu.be/comm0000000',
    );
    expect(youTubeLinkFor(SONG, { jobs: [], versions: [v('commercial', 'https://youtu.be/com00000000')] })).toBeNull();
  });

  it('is null with no sources', () => {
    expect(youTubeLinkFor(SONG, {})).toBeNull();
    expect(youTubeLinkFor(SONG, { jobs: [job({ youtube_url: '' })], versions: [v('community', null)] })).toBeNull();
  });
});
