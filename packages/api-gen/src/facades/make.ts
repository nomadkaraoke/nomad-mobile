import {
  checkCommunityVersionsApiCatalogCommunityCheckPost,
  type CommunityCheckResponse,
  createJobFromSearchApiJobsCreateFromSearchPost,
  createJobFromUrlApiJobsCreateFromUrlPost,
  matchJudgeApiCatalogMatchJudgePost,
  searchAudioStandaloneApiAudioSearchSearchStandalonePost,
  validateJobUrlApiJobsValidateUrlPost,
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

/** gen's verdict kinds: `none` (already right), `cosmetic` (formatting only), `content` (a real fix), `ambiguous`. */
export type MatchKind = 'none' | 'cosmetic' | 'content' | 'ambiguous';
const KINDS: readonly string[] = ['none', 'cosmetic', 'content', 'ambiguous'];

export type MatchVerdict = {
  kind: MatchKind;
  confident: boolean;
  canonical_artist: string;
  canonical_title: string;
  alternatives: { artist: string; title: string }[];
  engine: string;
  reason: string;
  /** The fast (catalogue-only) pass couldn't decide: run the full pass. */
  needs_ai: boolean;
};

/**
 * gen's artist/title match judge (a /api/catalog/* route: 20/min per user, shared; never per keystroke).
 * `fast` is catalogue-only; `full` may use AI and takes the audio search's confidence tier.
 */
export async function matchJudge(body: {
  artist: string;
  title: string;
  audio_confidence_tier?: 1 | 2 | 3;
  stage: 'fast' | 'full';
}): Promise<MatchVerdict> {
  const { data } = await matchJudgeApiCatalogMatchJudgePost({ body });
  return {
    ...data,
    // An unknown kind from a newer gen is treated as "nothing to change".
    kind: KINDS.includes(data.kind) ? (data.kind as MatchKind) : 'none',
    alternatives: data.alternatives ?? [],
    reason: data.reason ?? '',
    needs_ai: data.needs_ai ?? false,
  };
}

export type CommunityCheck = CommunityCheckResponse;

/** Does a community karaoke version of this song already exist on YouTube? (a /api/catalog/* route.) */
export async function communityCheck(body: { artist: string; title: string }): Promise<CommunityCheck> {
  const { data } = await checkCommunityVersionsApiCatalogCommunityCheckPost({ body });
  return data;
}

/** Pre-flight check of a link before making a job from it: `detail` says why one isn't supported. */
export async function validateUrl(url: string): Promise<{ supported: boolean; detail?: string }> {
  const { data } = await validateJobUrlApiJobsValidateUrlPost({ body: { url } });
  return data.detail ? { supported: data.supported, detail: data.detail } : { supported: data.supported };
}
