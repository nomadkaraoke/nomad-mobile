import type { JobDetail } from '@nomad/api-gen';
import { File } from 'expo-file-system';
import { Asset, requestPermissionsAsync } from 'expo-media-library';

import { useAuth } from '../auth/store';
import { downloadMp4, fetchMp4, signedMp4Url } from '../jobs/downloadMp4';
import { gen, session } from '../test-utils/genAuthMock';

jest.mock('@nomad/api-gen', () => ({ ...jest.requireActual('@nomad/api-gen'), getJob: jest.fn() }));

const download = File.downloadFileAsync as jest.Mock;
const requestPermissions = requestPermissionsAsync as jest.Mock;
const createAsset = Asset.create as jest.Mock;

const complete = (over: Partial<JobDetail> = {}): JobDetail =>
  ({ job_id: 'j1', status: 'complete', progress: 100, artist: 'Muse', title: 'Starlight', ...over }) as JobDetail;

beforeEach(async () => {
  jest.clearAllMocks();
  await useAuth.getState().signInWithSession(session());
  gen.getJob.mockResolvedValue(complete());
  download.mockImplementation(async (_url: string, dest: { uri: string }) => dest);
  requestPermissions.mockResolvedValue({ granted: true, status: 'granted' });
  createAsset.mockResolvedValue({ id: 'asset-1' });
});

describe('signedMp4Url', () => {
  it('reads download_urls.finals.lossy_720p_mp4 (file_urls shape)', () => {
    expect(signedMp4Url(complete({ download_urls: { finals: { lossy_720p_mp4: 'https://gcs/signed' } } }))).toBe(
      'https://gcs/signed',
    );
  });
  it('reads a flat download_urls.lossy_720p_mp4', () => {
    expect(signedMp4Url(complete({ download_urls: { lossy_720p_mp4: 'https://gcs/flat' } }))).toBe('https://gcs/flat');
  });
  it('is null without one', () => {
    expect(signedMp4Url(complete({ download_urls: {} }))).toBeNull();
    expect(signedMp4Url(complete())).toBeNull();
  });
});

describe('fetchMp4', () => {
  it('downloads the signed URL to the cache as an .mp4, reporting progress', async () => {
    gen.getJob.mockResolvedValue(complete({ download_urls: { finals: { lossy_720p_mp4: 'https://gcs/signed' } } }));
    const onProgress = jest.fn();
    download.mockImplementation(async (_url, dest, opts) => {
      opts.onProgress({ bytesWritten: 50, totalBytes: 200 });
      return dest;
    });
    const file = await fetchMp4('j1', onProgress);
    expect(gen.getJob).toHaveBeenCalledWith('j1');
    expect(download).toHaveBeenCalledWith(
      'https://gcs/signed',
      expect.objectContaining({ uri: 'file:///cache/nomad-j1-720p.mp4' }),
      expect.objectContaining({ idempotent: true }),
    );
    expect(download.mock.calls[0][2].headers).toBeUndefined();
    expect(onProgress).toHaveBeenCalledWith(0.25);
    expect(file.uri).toBe('file:///cache/nomad-j1-720p.mp4');
  });

  it('without a signed URL uses the download endpoint with the Bearer token', async () => {
    await fetchMp4('j1');
    expect(download).toHaveBeenCalledWith(
      'https://api.nomadkaraoke.com/api/jobs/j1/download/finals/lossy_720p_mp4',
      expect.anything(),
      expect.objectContaining({ headers: { Authorization: 'Bearer tok-me@example.com' } }),
    );
  });

  it('reports no fraction when the server sends no Content-Length', async () => {
    const onProgress = jest.fn();
    download.mockImplementation(async (_url, dest, opts) => {
      opts.onProgress({ bytesWritten: 50, totalBytes: -1 });
      return dest;
    });
    await fetchMp4('j1', onProgress);
    expect(onProgress).toHaveBeenCalledWith(null);
  });
});

describe('downloadMp4', () => {
  it('happy path: asks for write-only access, downloads, saves to Photos', async () => {
    await expect(downloadMp4('j1')).resolves.toBe('saved');
    expect(requestPermissions).toHaveBeenCalledWith(true);
    expect(download).toHaveBeenCalledTimes(1);
    expect(createAsset).toHaveBeenCalledWith('file:///cache/nomad-j1-720p.mp4');
  });

  it('permission denied: no download, nothing saved', async () => {
    requestPermissions.mockResolvedValue({ granted: false, status: 'denied' });
    await expect(downloadMp4('j1')).resolves.toBe('denied');
    expect(download).not.toHaveBeenCalled();
    expect(createAsset).not.toHaveBeenCalled();
  });

  it('a 410 from the download (output_archived) reads as archived', async () => {
    download.mockRejectedValue(new Error('Unable to download a file: response has status: 410'));
    await expect(downloadMp4('j1')).resolves.toBe('archived');
    expect(createAsset).not.toHaveBeenCalled();
  });

  it('reuses a file already fetched (e.g. by the in-app player)', async () => {
    const cached = { uri: 'file:///cache/nomad-j1-720p.mp4' } as File;
    await expect(downloadMp4('j1', { cached })).resolves.toBe('saved');
    expect(download).not.toHaveBeenCalled();
    expect(createAsset).toHaveBeenCalledWith(cached.uri);
  });

  it('other failures throw', async () => {
    download.mockRejectedValue(new Error('Unable to download a file: response has status: 500'));
    await expect(downloadMp4('j1')).rejects.toThrow('500');
  });
});
