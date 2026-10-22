import * as sdk from './client';
import type {
  ChangeSongRequest,
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

// Requests. `body.client_request_id` makes a retried submit idempotent: reuse the same id when retrying.
export const submitRequest = async (t: string, body: Omit<SubmitRequest, 't'>) =>
  (await sdk.createRequest({ body: { ...body, t } })).data;
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
  (await sdk.makeSearch({ body: { ...q(t, nightId), artist, title } })).data;
export const makeValidateUrl = async (t: string, url: string, nightId?: string) =>
  (await sdk.validateMakeUrl({ body: { ...q(t, nightId), url } })).data;
export const useQuick = async (t: string, id: number, nightId?: string) =>
  (await sdk.useQuickVersion({ path: { id }, body: q(t, nightId) })).data;

// Push
export const registerPushToken = async (t: string, token: string, platform: PushTokenRequest['platform'], nightId?: string) =>
  (await sdk.registerPushToken({ body: { ...q(t, nightId), expo_push_token: token, platform } })).data;
