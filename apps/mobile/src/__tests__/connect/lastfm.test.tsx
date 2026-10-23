// Connect -> Last.fm: username connect, then the sync wait (Phase 3b Task 23).
import * as decide from '@nomad/api-decide';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';

import { useAuth } from '../../auth/store';
import { syncPollConfig } from '../../discover/connect/useSyncWait';
import { gen, session } from '../../test-utils/genAuthMock';
import { appRoutes } from '../../test-utils/routes';

jest.setTimeout(20_000);

jest.mock('@react-native-community/netinfo', () => {
  const actual = jest.requireActual('@react-native-community/netinfo/jest/netinfo-mock.js');
  return { ...actual, useNetInfo: () => ({ isConnected: true, isInternetReachable: true }) };
});
jest.mock('../../../modules/apple-music-auth', () => ({
  nativeAppleMusicAvailable: () => false,
  requestAppleMusicUserToken: jest.fn(),
}));
jest.mock('@nomad/api-decide', () => ({
  ...jest.requireActual('@nomad/api-decide'),
  configureClient: jest.fn(),
  connectLastfm: jest.fn(),
  triggerSync: jest.fn(),
  getSyncStatus: jest.fn(),
  getServicesSummary: jest.fn(async () => ({ sources: [], capabilities: {} })),
  getServiceCapabilities: jest.fn(async () => ({ screenshot_import: false, listenbrainz_oauth: false })),
}));
jest.mock('@nomad/api-gen', () => ({ ...jest.requireActual('@nomad/api-gen'), getMe: jest.fn() }));

const m = (f: unknown) => f as jest.Mock;

const open = async () => {
  renderRouter(appRoutes(), { initialUrl: '/discover/connect/lastfm' });
  jest.useRealTimers();
  return screen.findByTestId('connect-lastfm-username');
};
const submit = async (name: string) => {
  const input = await open();
  await act(async () => fireEvent.changeText(input, name));
  await act(async () => fireEvent.press(screen.getByTestId('connect-lastfm-submit')));
};

beforeEach(async () => {
  jest.useRealTimers();
  jest.clearAllMocks();
  syncPollConfig.intervalMs = 5;
  syncPollConfig.timeoutMs = 2_000;
  await useAuth.getState().signOut();
  gen.getMe.mockResolvedValue({ email: 'me@example.com', credits: 3 } as never);
  m(decide.connectLastfm).mockResolvedValue({});
  m(decide.triggerSync).mockResolvedValue({ job_id: 'job-9', status: 'pending', message: '' });
  m(decide.getSyncStatus).mockResolvedValue({
    services: [],
    active_job: {
      job_id: 'job-9',
      status: 'completed',
      progress: null,
      results: [
        {
          service_type: 'lastfm',
          tracks_fetched: 100,
          tracks_matched: 30,
          user_songs_created: 30,
          user_songs_updated: 0,
          artists_stored: 8,
          error: null,
        },
      ],
      error: null,
      created_at: '2026-10-22T10:00:00Z',
      completed_at: '2026-10-22T10:02:00Z',
    },
  });
  await act(() => useAuth.getState().signInWithSession(session()));
});

describe('Last.fm connect', () => {
  it('username connect then sync result', async () => {
    await submit('fixture-user');
    expect(decide.connectLastfm).toHaveBeenCalledWith('fixture-user');
    await waitFor(() => expect(decide.triggerSync).toHaveBeenCalled());
    expect(await screen.findByText('Added 8 artists and 30 songs you know')).toBeTruthy();
  });

  it('lastfm unknown user shows 422 copy', async () => {
    m(decide.connectLastfm).mockRejectedValue(new decide.ApiError(422, 'User not found'));
    await submit('e2e-nobody');
    expect(await screen.findByText("We couldn't find that username. Check the spelling and try again.")).toBeTruthy();
    expect(decide.triggerSync).not.toHaveBeenCalled();
  });

  it('a failed sync says so', async () => {
    m(decide.getSyncStatus).mockResolvedValue({
      services: [],
      active_job: {
        job_id: 'job-9',
        status: 'failed',
        progress: null,
        results: null,
        error: 'boom',
        created_at: '2026-10-22T10:00:00Z',
        completed_at: '2026-10-22T10:02:00Z',
      },
    });
    await submit('fixture-user');
    expect(await screen.findByTestId('connect-sync-failed')).toBeTruthy();
  });
});
