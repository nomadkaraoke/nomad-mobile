// Decide accepts the gen session token (spec §4.2) and its 401 / 5xx never ends the gen session.
import { getRecommendationsV2, popularSongs } from '@nomad/api-decide';

import { setupApiClients } from '../api/setup';
import { useAuth } from '../auth/store';
import { useDiscoverStale } from '../discover/staleStore';
import { session } from '../test-utils/genAuthMock';

const fetchMock = jest.fn();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const requestOf = (i = 0) => fetchMock.mock.calls[i]![0] as Request;

beforeEach(async () => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  setupApiClients();
  useDiscoverStale.getState().clear();
  await useAuth.getState().signInWithSession(session());
});

it('decide requests carry the gen token', async () => {
  fetchMock.mockImplementation(async () => json({ sections: [] }));
  await getRecommendationsV2({}).catch(() => {});
  expect(requestOf().headers.get('Authorization')).toBe(`Bearer ${session().token}`);
});

it('decide 401 does not sign out', async () => {
  fetchMock.mockImplementation(async () => json({ detail: 'nope' }, 401));
  await expect(getRecommendationsV2({})).rejects.toMatchObject({ status: 401 });
  expect(useAuth.getState().state.status).toBe('signedIn');
  expect(useDiscoverStale.getState().stale).toBe(true);
});

it('decide 5xx leaves the session alone and does not mark stale', async () => {
  fetchMock.mockImplementation(async () => json({ detail: 'down' }, 503));
  await expect(popularSongs(5)).rejects.toMatchObject({ status: 503 });
  expect(useAuth.getState().state.status).toBe('signedIn');
  expect(useDiscoverStale.getState().stale).toBe(false);
});
