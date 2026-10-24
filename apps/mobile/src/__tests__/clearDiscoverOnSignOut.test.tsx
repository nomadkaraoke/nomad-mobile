// clearDiscoverOnSignOut: signing out wipes everything personal Discover keeps (offline picks, cached picks and
// music profile, the quiz draft, the stale flag) even with Discover unmounted, so the next person never sees it.
import { renderHook } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { useAuth } from '../auth/store';
import { PROFILE_KEY } from '../discover/profile/useMusicProfile';
import { QUIZ_STORAGE_KEY, useQuizDraft } from '../discover/quizStore';
import { loadRecsSnapshot, saveRecsSnapshot } from '../discover/recsSnapshot';
import { useDiscoverStale } from '../discover/staleStore';
import { useClearDiscoverOnSignOut } from '../discover/useClearDiscoverOnSignOut';
import { RECS_KEY } from '../discover/useRecommendations';
import { appStorage } from '../storage';
import { profileFromSelfReport, useVoiceStore, VOICE_STORAGE_KEY } from '../voice/voiceStore';

const data = { sections: [], has_profile: true } as never;
const signedIn = { status: 'signedIn', session: { token: 't', email: 'me@example.com', createdAt: 0 } } as const;

let queryClient: QueryClient;
const render = () =>
  renderHook(() => useClearDiscoverOnSignOut(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });

beforeEach(() => {
  appStorage.clearAll();
  queryClient = new QueryClient();
  useQuizDraft.getState().reset();
  useDiscoverStale.getState().clear();
  useAuth.setState({ state: signedIn, hydrated: true });
});

it('clears the snapshot when the session ends', () => {
  render();
  saveRecsSnapshot('me@example.com\nk', data);
  expect(loadRecsSnapshot()).not.toBeNull();
  useAuth.setState({ state: { status: 'signedOut' } });
  expect(loadRecsSnapshot()).toBeNull();
});

it('removes cached picks and music profile, the quiz draft and the stale flag when the session ends', async () => {
  render();
  queryClient.setQueryData([...RECS_KEY, 'k'], { pages: [], pageParams: [] });
  queryClient.setQueryData([...PROFILE_KEY, 'artists'], { artists: [{ artist_name: 'Alpha Band' }] });
  await useQuizDraft.getState().load('me@example.com').catch(() => {});
  useQuizDraft.setState({ owner: 'me@example.com', listed: [{ name: 'Alpha Band' }] });
  appStorage.set(QUIZ_STORAGE_KEY, JSON.stringify({ owner: 'me@example.com', progress: {} }));
  useDiscoverStale.getState().markStale();
  useVoiceStore.getState().save(profileFromSelfReport('tenor', '2026-10-22T00:00:00.000Z'));

  useAuth.setState({ state: { status: 'signedOut' } });

  expect(queryClient.getQueriesData({ queryKey: RECS_KEY })).toEqual([]);
  expect(queryClient.getQueriesData({ queryKey: PROFILE_KEY })).toEqual([]);
  expect(useQuizDraft.getState().owner).toBeNull();
  expect(useQuizDraft.getState().listed).toEqual([]);
  expect(appStorage.getString(QUIZ_STORAGE_KEY)).toBeUndefined();
  expect(useDiscoverStale.getState().stale).toBe(false);
  // The voice profile is personal too.
  expect(useVoiceStore.getState().profile).toBeNull();
  expect(appStorage.getString(VOICE_STORAGE_KEY)).toBeUndefined();
});

it('keeps everything while signed in', () => {
  render();
  saveRecsSnapshot('me@example.com\nk', data);
  queryClient.setQueryData([...PROFILE_KEY, 'artists'], { artists: [] });
  useAuth.setState({ state: signedIn });
  expect(loadRecsSnapshot()).not.toBeNull();
  expect(queryClient.getQueryData([...PROFILE_KEY, 'artists'])).toBeDefined();
});
