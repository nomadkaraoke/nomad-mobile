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
import { fsState } from '../test-utils/memoryFs';
import { VOICE_KEY } from '../voice/useVoiceProfile';
import { profileFromSelfReport, useVoiceStore, VOICE_STORAGE_KEY } from '../voice/voiceStore';
import { RECORDING_COUNT_KEY, VOICE_HISTORY_KEY } from '../voiceSession/useVoiceHistory';
import { RECORD_DEFAULT_KEY } from '../voiceSession/recordDefault';
import { RECORDING_QUEUE_KEY, useRecordingQueue } from '../voiceSession/recording/recordingQueue';
import { useVoiceSessionStore, VOICE_SESSION_KEY } from '../voiceSession/sessionStore';

// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories can't use imports
jest.mock('expo-file-system', () => require('../test-utils/memoryFs'));

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

it("drops the cached voice data (profiles, sessions history, recordings count) when the session ends", () => {
  render();
  queryClient.setQueryData([...VOICE_KEY, 'me@example.com'], { profile: null, mic: null, latestSession: null });
  queryClient.setQueryData([...VOICE_HISTORY_KEY, 'me@example.com'], { sessions: [] });
  queryClient.setQueryData([...RECORDING_COUNT_KEY, 'me@example.com'], 3);
  useAuth.setState({ state: { status: 'signedOut' } });
  expect(queryClient.getQueriesData({ queryKey: VOICE_KEY })).toEqual([]);
  expect(queryClient.getQueriesData({ queryKey: VOICE_HISTORY_KEY })).toEqual([]);
  expect(queryClient.getQueriesData({ queryKey: RECORDING_COUNT_KEY })).toEqual([]);
});

it('keeps everything while signed in', () => {
  render();
  saveRecsSnapshot('me@example.com\nk', data);
  queryClient.setQueryData([...PROFILE_KEY, 'artists'], { artists: [] });
  useAuth.setState({ state: signedIn });
  expect(loadRecsSnapshot()).not.toBeNull();
  expect(queryClient.getQueryData([...PROFILE_KEY, 'artists'])).toBeDefined();
});

it('drops the voice session in progress and the recording upload queue (and their files) when the session ends', () => {
  render();
  const queued = 'file:///document/voice-recordings/s1-1.wav';
  const take = 'file:///document/voice-recordings/s1-2.wav';
  fsState.files.set(queued, new Uint8Array(8));
  fsState.files.set(take, new Uint8Array(8));
  useRecordingQueue
    .getState()
    .enqueue({ sessionId: 's1', attemptN: 1, uri: queued, contentType: 'audio/wav', durationS: 9, device: null });
  useVoiceSessionStore.getState().update({
    sessionId: 's1',
    setup: { posture: 'sitting', warmth: 'warm', record: true, headphones: true },
    step: 'quiz',
    take: { uri: take, durationS: 9, contentType: 'audio/wav' },
  });
  expect(appStorage.getString(VOICE_SESSION_KEY)).toBeDefined();

  useAuth.setState({ state: { status: 'signedOut' } });

  expect(useRecordingQueue.getState().items).toEqual([]);
  expect(appStorage.getString(RECORDING_QUEUE_KEY)).toBeUndefined();
  expect(useVoiceSessionStore.getState().sessionId).toBeNull();
  expect(appStorage.getString(VOICE_SESSION_KEY)).toBeUndefined();
  expect(fsState.files.has(queued)).toBe(false);
  expect(fsState.files.has(take)).toBe(false);
});

it("forgets the previous person's record-my-takes default when the session ends", () => {
  render();
  appStorage.set(RECORD_DEFAULT_KEY, true);
  useAuth.setState({ state: { status: 'signedOut' } });
  expect(appStorage.getBoolean(RECORD_DEFAULT_KEY)).toBeUndefined();
});
