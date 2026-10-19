// Review Focus 4: a 401 mid make flow (session expired) signs out but keeps the make intent,
// so sign-in can pick the flow back up.
import { getMe } from '@nomad/api-gen';

import { setupApiClients } from '../api/setup';
import { useAuth } from '../auth/store';
import { useMakeIntent } from '../make/intentStore';
import { session } from '../test-utils/genAuthMock';

const fetchMock = jest.fn();

beforeEach(() => {
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  setupApiClients();
});

it('a gen 401 signs out and keeps the make intent', async () => {
  await useAuth.getState().signInWithSession(session());
  useMakeIntent.getState().set({ artist: 'Adele', title: 'Hello', source: 'typed', editedFields: [], createdAt: Date.now() });
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ detail: 'Invalid session' }), { status: 401, headers: { 'Content-Type': 'application/json' } }),
  );

  await expect(getMe()).rejects.toMatchObject({ status: 401 });

  expect(useAuth.getState().state.status).toBe('signedOut');
  expect(useMakeIntent.getState().get()).toMatchObject({ title: 'Hello' });
});
