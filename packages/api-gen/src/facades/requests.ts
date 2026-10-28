import { listRequestsApiRequestsBoardRequestsGet, submitRequestApiRequestsBoardRequestsPost } from '../client';
import type { SongRequestPublic } from '../client';
import { isApiError, type ApiError } from '../configure';

/**
 * The result of "Request it free". `created` / `already_exists` both mean done. `vote_used`: today's free vote is
 * already spent on another request. `submission_limit`: one free request a day.
 */
export type RequestOutcome =
  | { status: 'created' | 'already_exists'; request: SongRequestPublic }
  | { status: 'vote_used' }
  | { status: 'submission_limit' };

const errorCode = (e: ApiError): unknown =>
  e.detail && typeof e.detail === 'object' && 'code' in e.detail ? (e.detail as { code: unknown }).code : e.detail;

/**
 * Submit a song to gen's requests board. This is ONE call and never a vote: gen's submit already spends the day's
 * vote, and voting again after `already_exists` would toggle it off. Other errors throw ApiError.
 */
export async function submitSongRequest(artist: string, title: string): Promise<RequestOutcome> {
  try {
    const { data } = await submitRequestApiRequestsBoardRequestsPost({ body: { artist, title } });
    if (data.status !== 'created' && data.status !== 'already_exists') {
      throw new Error(`Unexpected requests-board submit status "${data.status}"`);
    }
    return { status: data.status, request: data.request };
  } catch (e) {
    if (isApiError(e, 409) && errorCode(e) === 'vote_already_used') return { status: 'vote_used' };
    if (isApiError(e, 429)) return { status: 'submission_limit' };
    throw e;
  }
}

/** The board's active (votable) requests; recently published ones are left out. */
export async function listBoardRequests(): Promise<SongRequestPublic[]> {
  const { data } = await listRequestsApiRequestsBoardRequestsGet();
  return data.requests;
}
