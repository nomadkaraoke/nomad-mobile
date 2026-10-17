import { getJob, type JobDetail } from '@nomad/api-gen';
import { File, Paths } from 'expo-file-system';
import { Asset, requestPermissionsAsync } from 'expo-media-library';

import { useAuth } from '../auth/store';
import { GEN_API_URL } from '../config';

const KEY = 'lossy_720p_mp4';

/**
 * The signed 2-hour GCS URL gen adds to GET /api/jobs/{id} for a complete job, if any. Gen fills
 * download_urls from the legacy flat `output_files` map, which current workers don't write, so this is
 * usually null and the authenticated download endpoint is used instead. Both shapes are accepted.
 */
export function signedMp4Url(job: JobDetail): string | null {
  const urls = job.download_urls ?? {};
  const finals = urls.finals;
  const nested = finals && typeof finals === 'object' ? (finals as Record<string, unknown>)[KEY] : undefined;
  const url = nested ?? urls[KEY];
  return typeof url === 'string' && url ? url : null;
}

/** gen answers 410 `output_archived` once storage retention has purged the render. */
export class Mp4ArchivedError extends Error {
  constructor() {
    super('output_archived');
    this.name = 'Mp4ArchivedError';
  }
}

// expo-file-system only reports the status: "Unable to download a file: response has status[:] 410".
const isGone = (e: unknown) => e instanceof Error && /status:?\s*410\b/.test(e.message);

/** `fraction` is 0–1, or null when the server sends no Content-Length (gen's streamed endpoint doesn't). */
export type Mp4Progress = (fraction: number | null) => void;

/**
 * Downloads the job's 720p MP4 into the cache (overwriting a previous copy). Reads the job fresh so a
 * signed URL is never stale; without one it uses /api/jobs/{id}/download/finals/lossy_720p_mp4 with
 * the session's Bearer token. Throws Mp4ArchivedError on a 410.
 */
export async function fetchMp4(jobId: string, onProgress?: Mp4Progress): Promise<File> {
  const job = await getJob(jobId);
  const signed = signedMp4Url(job);
  const token = useAuth.getState().getToken();
  const url = signed ?? `${GEN_API_URL.replace(/\/+$/, '')}/api/jobs/${encodeURIComponent(jobId)}/download/finals/${KEY}`;
  const destination = new File(Paths.cache, `nomad-${jobId}-720p.mp4`);
  try {
    return await File.downloadFileAsync(url, destination, {
      idempotent: true,
      headers: signed || !token ? undefined : { Authorization: `Bearer ${token}` },
      onProgress: ({ bytesWritten, totalBytes }) =>
        onProgress?.(totalBytes > 0 ? Math.min(1, bytesWritten / totalBytes) : null),
    });
  } catch (e) {
    if (isGone(e)) throw new Mp4ArchivedError();
    throw e;
  }
}

export type DownloadResult = 'saved' | 'denied' | 'archived';

/**
 * Saves the 720p MP4 to Photos / Gallery (spec §4.7). Asks for write-only access first, so a refusal
 * doesn't cost a download. `cached` reuses a file the in-app player already fetched.
 */
export async function downloadMp4(
  jobId: string,
  { onProgress, cached }: { onProgress?: Mp4Progress; cached?: File } = {},
): Promise<DownloadResult> {
  const permission = await requestPermissionsAsync(true);
  if (!permission.granted) return 'denied';
  let file: File;
  try {
    file = cached ?? (await fetchMp4(jobId, onProgress));
  } catch (e) {
    if (e instanceof Mp4ArchivedError) return 'archived';
    throw e;
  }
  await Asset.create(file.uri);
  return 'saved';
}
