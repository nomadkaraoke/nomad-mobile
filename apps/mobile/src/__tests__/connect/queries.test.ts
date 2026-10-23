// Connect hub queries + import error mapping (Phase 3b Task 17).
import * as decide from '@nomad/api-decide';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

import { useAuth } from '../../auth/store';
import { importErrorKey } from '../../discover/connect/importErrors';
import {
  SERVICES_SUMMARY_KEY,
  useCapabilities,
  useInvalidateAfterImport,
  useServicesSummary,
} from '../../discover/connect/queries';
import { NotAnExportError } from '../../discover/connect/readExport';
import { RECS_KEY } from '../../discover/useRecommendations';

jest.mock('@nomad/api-decide', () => ({
  ...jest.requireActual('@nomad/api-decide'),
  getServicesSummary: jest.fn(),
  getServiceCapabilities: jest.fn(),
}));

const api = decide as jest.Mocked<typeof decide>;
const { ApiError } = jest.requireActual<typeof decide>('@nomad/api-decide');

const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const wrapper = (client: QueryClient) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };

beforeEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
  useAuth.setState({ state: { status: 'signedIn', session: { token: 't', email: 'a@example.com', createdAt: 0 } } });
});

describe('useCapabilities', () => {
  it('returns the server flags', async () => {
    api.getServiceCapabilities.mockResolvedValue({ screenshot_import: true, listenbrainz_oauth: true, listenbrainz_upload_max_bytes: 31_457_280 });
    const { result } = renderHook(() => useCapabilities(), { wrapper: wrapper(newClient()) });
    await waitFor(() => expect(result.current.data?.screenshot_import).toBe(true));
    expect(result.current.data?.listenbrainz_upload_max_bytes).toBe(31_457_280);
  });

  it('useCapabilities falls back to false on error', async () => {
    api.getServiceCapabilities.mockRejectedValue(new ApiError(503, 'down'));
    const { result } = renderHook(() => useCapabilities(), { wrapper: wrapper(newClient()) });
    await waitFor(() => expect(result.current.data).toEqual({ screenshot_import: false, listenbrainz_oauth: false }));
  });

  it('caches for an hour', async () => {
    api.getServiceCapabilities.mockResolvedValue({ screenshot_import: true, listenbrainz_oauth: false });
    const client = newClient();
    const first = renderHook(() => useCapabilities(), { wrapper: wrapper(client) });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    const second = renderHook(() => useCapabilities(), { wrapper: wrapper(client) });
    expect(second.result.current.data?.screenshot_import).toBe(true);
    expect(api.getServiceCapabilities).toHaveBeenCalledTimes(1);
  });
});

describe('useServicesSummary', () => {
  it('loads the summary when signed in', async () => {
    const summary = { sources: [], capabilities: { screenshot_import: false, listenbrainz_oauth: false } };
    api.getServicesSummary.mockResolvedValue(summary);
    const { result } = renderHook(() => useServicesSummary(), { wrapper: wrapper(newClient()) });
    await waitFor(() => expect(result.current.data).toEqual(summary));
  });

  it('does not ask while signed out', async () => {
    useAuth.setState({ state: { status: 'signedOut' } });
    const { result } = renderHook(() => useServicesSummary(), { wrapper: wrapper(newClient()) });
    await act(async () => {});
    expect(result.current.fetchStatus).toBe('idle');
    expect(api.getServicesSummary).not.toHaveBeenCalled();
  });
});

it('useInvalidateAfterImport refreshes the summary and the picks', () => {
  const client = newClient();
  const spy = jest.spyOn(client, 'invalidateQueries');
  const { result } = renderHook(() => useInvalidateAfterImport(), { wrapper: wrapper(client) });
  result.current();
  expect(spy).toHaveBeenCalledWith({ queryKey: SERVICES_SUMMARY_KEY });
  expect(spy).toHaveBeenCalledWith({ queryKey: RECS_KEY });
});

describe('importErrorKey', () => {
  const e = (status: number, detail: unknown = null) => new ApiError(status, detail);
  it.each([
    // [error, route, key]
    [new NotAnExportError(), 'export', 'notAnExport'],
    [e(400, 'not_a_zip'), 'listenbrainz', 'notAnExport'],
    [e(400, 'bad_chunk'), 'export', 'generic'],
    [e(400, 'Not a Spotify playlist link'), 'playlist', 'badUrl'],
    [e(404, 'Playlist not found or private'), 'playlist', 'private'],
    [e(422, 'Liked Music is always private - copy it into a public or unlisted playlist'), 'playlist', 'likedPrivate'],
    [e(422, 'Could not read this Spotify playlist right now'), 'playlist', 'unparseable'],
    [e(422, 'User not found'), 'lastfm', 'notFound'],
    [e(404, 'nope'), 'listenbrainz', 'notFound'],
    [e(422, 'User not found'), 'listenbrainz', 'notFound'],
    [e(429, 'daily_limit'), 'screenshot', 'rateLimited'],
    [e(429, 'Too many playlist imports'), 'playlist', 'rateLimited'],
    [e(413, 'image_too_large'), 'screenshot', 'tooLarge'],
    [e(413, 'too_large'), 'listenbrainz', 'tooLarge'],
    [e(503, 'screenshot_unavailable'), 'screenshot', 'unavailable'],
    [e(500), 'export', 'unavailable'],
    [e(0, 'network'), 'playlist', 'unavailable'],
    [e(400, 'not_an_image'), 'screenshot', 'generic'],
    [e(409, 'needs_reconnect'), 'listenbrainz', 'generic'],
    [e(401), 'lastfm', 'generic'],
    [new Error('boom'), 'export', 'generic'],
    [undefined, 'playlist', 'generic'],
    // A queue's stored lastError ({status, detail}) maps the same way.
    [{ status: 400, detail: 'bad_chunk' }, 'export', 'generic'],
  ] as const)('%p on %s → %s', (err, route, key) => {
    expect(importErrorKey(err, route)).toBe(`connect.errors.${key}`);
  });

  it('every key exists in en.json', () => {
    const en = require('../../../../../packages/i18n/messages/en.json');
    for (const k of ['badUrl', 'notFound', 'private', 'likedPrivate', 'unparseable', 'rateLimited', 'unavailable', 'tooLarge', 'notAnExport', 'generic']) {
      expect(typeof en.connect.errors[k]).toBe('string');
    }
  });
});
