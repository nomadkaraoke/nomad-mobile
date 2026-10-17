import {
  createJobFromSearchApiJobsCreateFromSearchPost,
  createJobFromUrlApiJobsCreateFromUrlPost,
  searchAudioStandaloneApiAudioSearchSearchStandalonePost,
} from '../client';
import { type AudioResult, StandaloneSearchSchema } from '../overrides/audioSearch';
import { parseResponse } from '../overrides/parse';

// Same as the web: lyrics auto-reviewed, and public so gen posts the video to YouTube.
const MAKE_DEFAULTS = { review_mode: 'auto', is_private: false } as const;

/** Standalone audio search (can take ~45s; 402 before searching when the user has no credits). */
export async function searchAudio(artist: string, title: string): Promise<{ sessionId: string; results: AudioResult[] }> {
  const { data } = await searchAudioStandaloneApiAudioSearchSearchStandalonePost({ body: { artist, title } });
  const parsed = parseResponse(StandaloneSearchSchema, data);
  return { sessionId: parsed.search_session_id, results: parsed.results };
}

/** Returns the new job_id. */
export async function createJobFromSearch(a: { sessionId: string; index: number; artist: string; title: string }): Promise<string> {
  const { data } = await createJobFromSearchApiJobsCreateFromSearchPost({
    body: { search_session_id: a.sessionId, selection_index: a.index, artist: a.artist, title: a.title, ...MAKE_DEFAULTS },
  });
  return data.job_id;
}

/** Returns the new job_id. */
export async function createJobFromUrl(a: { url: string; artist: string; title: string }): Promise<string> {
  const { data } = await createJobFromUrlApiJobsCreateFromUrlPost({
    body: { url: a.url, artist: a.artist, title: a.title, ...MAKE_DEFAULTS },
  });
  return data.job_id;
}
