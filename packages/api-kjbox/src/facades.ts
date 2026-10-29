import * as sdk from './client';
import { fetchWithTimeout, MAKE_TIMEOUT_MS } from './configure';
import { KjboxError } from './errors';
import type {
  ChangeSongRequest,
  HistoryClaimResult,
  HistorySuggestions,
  MakeCheckRequest,
  PushTokenRequest,
  ReorderItem,
  SearchEventRequest,
  PreviewRequest,
  SongConsentRequest,
  SubmitRequest,
  TipClaimRequest,
  UpdateMeRequest,
} from './client';

// Readable facades over the generated operation names. Every call carries the event code `t` (query for GET, JSON
// body for POST/PUT) and the optional `night_id` the app last saw (a mismatch is a 409 `night_changed`). All reject
// with KjboxError.

const q = (t: string, nightId?: string) => ({ t, night_id: nightId });

// Night + identity
export const getNight = async (t: string, nightId?: string) => (await sdk.getNight({ query: q(t, nightId) })).data;
export const joinNight = async (t: string, name: string, nightId?: string) =>
  (await sdk.joinNight({ body: { ...q(t, nightId), name } })).data;
export const getMe = async (t: string, nightId?: string) => (await sdk.getMe({ query: q(t, nightId) })).data;
export const updateMe = async (t: string, patch: Omit<UpdateMeRequest, 't'>) =>
  (await sdk.updateMe({ body: { ...patch, t } })).data;

// Song search
/** `sid` is the client's search-session id (kjbox logs it with the search). */
export const searchSongs = async (t: string, query: string, sid?: string, nightId?: string) =>
  (await sdk.searchSongs({ query: { ...q(t, nightId), q: query, sid } })).data;
export const identify = async (t: string, query: string, sid?: string, nightId?: string) =>
  (await sdk.identifySong({ query: { ...q(t, nightId), q: query, sid } })).data;
export const resolve = async (t: string, query: string, sid?: string, nightId?: string) =>
  (await sdk.resolveSearch({ query: { ...q(t, nightId), q: query, sid } })).data;
/** Fire-and-forget telemetry: never throws, whatever the network or server does. */
export const logSearchEvent = async (t: string, e: Omit<SearchEventRequest, 't'>): Promise<void> => {
  try {
    await sdk.logSearchEvent({ body: { ...e, t } });
  } catch {
    /* telemetry must never break search */
  }
};

/** Make-it calls wait on gen, so they get MAKE_TIMEOUT_MS instead of the 10 s default. */
const makeFetch = fetchWithTimeout(MAKE_TIMEOUT_MS);

// Requests. `body.client_request_id` makes a retried submit idempotent: reuse the same id when retrying. A make-it
// submit waits on gen's create-job, so it gets the longer make timeout.
export const submitRequest = async (t: string, body: Omit<SubmitRequest, 't'>) =>
  (await sdk.createRequest({ body: { ...body, t }, ...(body.source_type === 'make' ? { fetch: makeFetch } : {}) })).data;
export const cancelRequest = async (t: string, id: number, nightId?: string) =>
  (await sdk.cancelRequest({ path: { id }, body: q(t, nightId) })).data;
export const changeRequest = async (t: string, id: number, body: Omit<ChangeSongRequest, 't'>) =>
  (await sdk.changeRequest({ path: { id }, body: { ...body, t } })).data;
export const reorder = async (t: string, items: ReorderItem[], nightId?: string) =>
  (await sdk.reorderRequests({ body: { ...q(t, nightId), items } })).data;
export const setSongConsent = async (t: string, id: number, consent: SongConsentRequest['consent'], nightId?: string) =>
  (await sdk.setRequestConsent({ path: { id }, body: { ...q(t, nightId), consent } })).data;

// Rotation / now playing / singers
export type RotationResponse = Awaited<ReturnType<typeof getRotationData>>;
const getRotationData = async (t: string, etag?: string, nightId?: string) =>
  await sdk.getRotation({
    query: q(t, nightId),
    headers: etag ? { 'If-None-Match': etag } : undefined,
    throwOnError: false,
  });

/**
 * Conditional rotation fetch. A 304 resolves `{ notModified: true }` (it is not an error); a 200 resolves the
 * new `etag` (as sent by the server, quotes included, ready to pass back) with `data`.
 */
export const getRotation = async (
  t: string,
  etag?: string,
  nightId?: string,
): Promise<{ notModified: true } | { notModified?: false; etag: string | undefined; data: NonNullable<RotationResponse['data']> }> => {
  const res = await getRotationData(t, etag, nightId);
  if (res.response?.status === 304) return { notModified: true };
  // throwOnError:false hands back the interceptor's KjboxError instead of throwing.
  if (res.error !== undefined || !res.response?.ok) throw res.error;
  return { etag: res.response.headers.get('ETag') ?? undefined, data: res.data! };
};
export const getNow = async (t: string, nightId?: string) => (await sdk.getNow({ query: q(t, nightId) })).data;
export const getSingers = async (t: string, nightId?: string) => (await sdk.listSingers({ query: q(t, nightId) })).data;

// Preview
/**
 * `extra` carries the search result's own source fields (the web's descriptor: local `file_path`, divebar `file_id` +
 * `format`, youtube `youtube_url`, plus a display `title`); entry sources need only `entryId`.
 */
export const previewResolve = async (
  t: string,
  source: PreviewRequest['source'],
  entryId?: number,
  nightId?: string,
  extra?: Record<string, unknown>,
) => (await sdk.resolvePreview({ body: { ...extra, ...q(t, nightId), source, entry_id: entryId } })).data;
export const previewClose = async (t: string, token?: string, nightId?: string) =>
  (await sdk.closePreview({ body: { ...q(t, nightId), token } })).data;

// Tips + stats
export const getTips = async (t: string, nightId?: string) => (await sdk.getTips({ query: q(t, nightId) })).data;
/** `body.client_request_id` makes a retried claim idempotent. */
export const claimTip = async (t: string, body: Omit<TipClaimRequest, 't'>) =>
  (await sdk.claimTip({ body: { ...body, t } })).data;
export const getMyStats = async (t: string, nightId?: string) => (await sdk.getMyStats({ query: q(t, nightId) })).data;

// "Make it" (generate a missing karaoke version through gen)
export const makeCheck = async (t: string, body: Omit<MakeCheckRequest, 't'>) =>
  (await sdk.checkMake({ body: { ...body, t } })).data;
export const makeSearch = async (t: string, artist: string, title: string, nightId?: string) =>
  (await sdk.makeSearch({ body: { ...q(t, nightId), artist, title }, fetch: makeFetch })).data;
export const makeValidateUrl = async (t: string, url: string, nightId?: string) =>
  (await sdk.validateMakeUrl({ body: { ...q(t, nightId), url } })).data;
export const useQuick = async (t: string, id: number, nightId?: string) =>
  (await sdk.useQuickVersion({ path: { id }, body: q(t, nightId) })).data;

// Push
export const registerPushToken = async (t: string, token: string, platform: PushTokenRequest['platform'], nightId?: string) =>
  (await sdk.registerPushToken({ body: { ...q(t, nightId), expo_push_token: token, platform } })).data;

// Past-night history. The only routes without `t` or `night_id`: they need just the bearer and work any day, even
// while the box's night is closed. A box older than these routes answers 404 (a KjboxError, `not_found` when JSON).

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const isInt = (v: unknown) => typeof v === 'number' && Number.isInteger(v);
/** A 2xx whose body isn't the contract's shape (a proxy page, an older or broken box) rejects like any failure. */
const malformed = (status: number | undefined) =>
  new KjboxError('internal', status ?? 0, undefined, { message: 'malformed reply' });

const isStrings = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === 'string');
const isHistorySong = (s: unknown) =>
  isObj(s) && isInt(s.entry_id) && typeof s.singer_name === 'string' && isStrings(s.members) &&
  typeof s.artist === 'string' && typeof s.title === 'string' && (s.started_at === null || typeof s.started_at === 'string') &&
  (s.state === 'sung' || s.state === 'sung_unplayed');
const isHistoryNight = (n: unknown) =>
  isObj(n) && typeof n.night_id === 'string' && typeof n.date === 'string' && (n.venue === null || typeof n.venue === 'string') &&
  isStrings(n.names) && isInt(n.unmatched) &&
  Array.isArray(n.songs) && n.songs.every(isHistorySong);

/** Past nights at this box with songs this account may have sung (nothing is claimed until claimHistory). */
export const getHistorySuggestions = async (): Promise<HistorySuggestions> => {
  const { data, response } = await sdk.getHistorySuggestions();
  if (!isObj(data) || !Array.isArray(data.nights) || !isInt(data.more_nights) || !data.nights.every(isHistoryNight))
    throw malformed(response?.status);
  return data;
};

/**
 * Save one night's ticked songs as `mine` and the rest as `notMine` (never suggested again). Idempotent: re-sending
 * the same body answers `already_saved`, so a retry after a timeout is safe.
 */
export const claimHistory = async (nightId: string, mine: number[], notMine: number[]): Promise<HistoryClaimResult> => {
  const { data, response } = await sdk.claimHistory({ body: { night_id: nightId, mine, not_mine: notMine } });
  if (!isObj(data) || !isInt(data.saved) || !isInt(data.already_saved) || !isInt(data.rejected) || !Array.isArray(data.taken))
    throw malformed(response?.status);
  return data;
};
