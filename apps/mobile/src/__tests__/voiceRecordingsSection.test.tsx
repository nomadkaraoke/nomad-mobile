// Me -> music profile -> voice recordings (Phase 3d Task D7): the count, "delete all" (queue first, then decide),
// the default-consent toggle, and the section's gating.
import * as decide from '@nomad/api-decide';
import { IntlProvider } from '@nomad/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { useAudioPlayer } from 'expo-audio';
import { File } from 'expo-file-system';
import { renderRouter } from 'expo-router/testing-library';
import { Alert } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useAuth } from '../auth/store';
import { appStorage } from '../storage';
import { gen, session } from '../test-utils/genAuthMock';
import { appRoutes } from '../test-utils/routes';
import { RECS_KEY } from '../discover/useRecommendations';
import { VOICE_KEY } from '../voice/useVoiceProfile';
import { RECORD_DEFAULT_KEY } from '../voiceSession/recordDefault';
import { useRecordingQueue } from '../voiceSession/recording/recordingQueue';
import { RECORDING_COUNT_KEY, RecordingsSection } from '../voiceSession/RecordingsSection';

jest.setTimeout(20_000);

// The section runs outside a navigator here: a focus effect is just an effect (the first call is mount).
jest.mock('expo-router', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useEffect } = require('react');
  return { ...jest.requireActual('expo-router'), useFocusEffect: (cb: () => void) => useEffect(cb, [cb]) };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories can't use imports
jest.mock('expo-file-system', () => require('../test-utils/memoryFs'));
jest.mock('@nomad/api-gen', () => ({ ...jest.requireActual('@nomad/api-gen'), getMe: jest.fn() }));
jest.mock('@nomad/api-decide', () => ({
  ...jest.requireActual('@nomad/api-decide'),
  popularSongs: jest.fn(async () => []),
  pingSearch: jest.fn(async () => true),
  logSearchEvent: jest.fn(async () => {}),
  configureClient: jest.fn(),
  getOfflineIndexManifest: jest.fn(async () => ({ bytes: 1 })),
  getPreferences: jest.fn(async () => ({ genres: [], decades: [] })),
  listMyArtists: jest.fn(async () => ({ artists: [], total: 0, page: 1, per_page: 50, has_more: false })),
  listLovedSongs: jest.fn(async () => []),
  listHiddenSongs: jest.fn(async () => []),
  getQuizProgress: jest.fn(async () => null),
  listMusicServices: jest.fn(async () => []),
  getVoiceProfile: jest.fn(async () => null),
  getVoiceFlags: jest.fn(),
  voiceRecordingCount: jest.fn(),
  uploadVoiceRecording: jest.fn(),
  deleteVoiceRecordings: jest.fn(),
  getVoiceHistory: jest.fn(),
  patchVoiceAttempt: jest.fn(),
  deleteVoiceRecording: jest.fn(),
  voiceRecordingAudioUrl: jest.fn((id: string) => `https://decide.test/api/voice/recordings/${encodeURIComponent(id)}/audio`),
}));

const m = (f: unknown) => f as jest.Mock;
const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
const flags = (session_enabled: boolean) => ({ session_enabled, is_admin: false, voice_data: true, active_session_id: null });

let client: QueryClient;
const renderSection = () => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <IntlProvider locale="en">
        <QueryClientProvider client={client}>
          <RecordingsSection />
        </QueryClientProvider>
      </IntlProvider>
    </SafeAreaProvider>,
  );
};

/** Taps the confirmation's destructive button. */
const confirmDelete = async () => {
  const alert = Alert.alert as jest.Mock;
  await waitFor(() => expect(alert).toHaveBeenCalled());
  const buttons = alert.mock.calls[alert.mock.calls.length - 1][2] as { style?: string; onPress?: () => void }[];
  await act(async () => buttons.find((b) => b.style === 'destructive')!.onPress?.());
};

const SUMMARY = {
  session_id: 'sB',
  voice_type: 'baritone',
  between: null,
  confidence_label: 'low',
  top_p: 0.5,
  low: 45,
  high: 69,
  comfort_low: 50,
  comfort_high: 60,
  attempts: 2,
  evidence_attempts: 1,
  profile_saved: false,
  computed_at: '2026-10-25T18:00:00Z',
} as const;
const attempt = (session: string, n: number, over: Record<string, unknown> = {}) => ({
  attempt_id: `${session}:${n}`,
  n,
  song_key: `song-${n}`,
  artist: 'Alpha Band',
  title: `Invented Song ${n}`,
  sung_at: null,
  feel: 'fine',
  position: 'comfortable',
  excluded: false,
  recording: null,
  falsetto_notes: 0,
  ...over,
});
const REC = (id: string) => ({ recording_id: id, duration_s: 30, content_type: 'audio/mp4', bytes: 1000 });
const HISTORY = {
  sessions: [
    {
      session_id: 'sB',
      created_at: '2026-10-25T17:00:00Z',
      state: 'done',
      result: SUMMARY,
      attempts: [attempt('sB', 1, { recording: REC('rB1') }), attempt('sB', 2, { excluded: true, title: 'Made Up Tune' })],
    },
    { session_id: 'sA', created_at: '2026-10-20T17:00:00Z', state: 'abandoned', result: null, attempts: [attempt('sA', 1)] },
  ],
};

beforeEach(async () => {
  jest.clearAllMocks();
  appStorage.remove(RECORD_DEFAULT_KEY);
  useRecordingQueue.getState().clearAll();
  m(decide.getVoiceHistory).mockResolvedValue(HISTORY);
  m(decide.voiceRecordingCount).mockResolvedValue(3);
  m(decide.deleteVoiceRecordings).mockResolvedValue({ deleted: 3 });
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  await useAuth.getState().signOut();
  gen.getMe.mockResolvedValue({ email: 'me@example.com', credits: 3 } as never);
  await act(() => useAuth.getState().signInWithSession(session()));
});
afterEach(() => (Alert.alert as jest.Mock).mockRestore());

describe('RecordingsSection', () => {
  it('count renders', async () => {
    renderSection();
    expect(await screen.findByTestId('vs-recordings-count')).toHaveTextContent('3 recordings kept privately');
  });

  it('one recording reads in the singular', async () => {
    m(decide.voiceRecordingCount).mockResolvedValue(1);
    renderSection();
    expect(await screen.findByTestId('vs-recordings-count')).toHaveTextContent('1 recording kept privately');
  });

  it('delete asks first, and cancelling deletes nothing', async () => {
    renderSection();
    await screen.findByTestId('vs-recordings-count');
    fireEvent.press(screen.getByTestId('vs-recordings-delete'));
    expect(Alert.alert).toHaveBeenCalledTimes(1);
    expect(decide.deleteVoiceRecordings).not.toHaveBeenCalled();
  });

  it('delete clears queue then calls API, then the count is 0', async () => {
    const order: string[] = [];
    const clearAll = jest.spyOn(useRecordingQueue.getState(), 'clearAll').mockImplementation(() => void order.push('queue'));
    m(decide.deleteVoiceRecordings).mockImplementation(async () => {
      order.push('api');
      return { deleted: 3 };
    });
    renderSection();
    await screen.findByTestId('vs-recordings-count');
    fireEvent.press(screen.getByTestId('vs-recordings-delete'));
    await confirmDelete();
    await waitFor(() => expect(screen.getByTestId('vs-recordings-count')).toHaveTextContent('0 recordings kept privately'));
    expect(order).toEqual(['queue', 'api']);
    clearAll.mockRestore();
  });

  it('invalidating the count key shows the new count', async () => {
    renderSection();
    await screen.findByText('3 recordings kept privately');
    m(decide.voiceRecordingCount).mockResolvedValue(5);
    await act(async () => void client.invalidateQueries({ queryKey: RECORDING_COUNT_KEY }));
    expect(await screen.findByText('5 recordings kept privately')).toBeTruthy();
  });

  it('refetches the count when the queue uploaded something', async () => {
    renderSection();
    await screen.findByText('3 recordings kept privately');
    m(decide.voiceRecordingCount).mockResolvedValue(4);
    m(decide.uploadVoiceRecording).mockResolvedValue({ recording_id: 'r1' });
    const { fsState } = jest.requireActual('../test-utils/memoryFs');
    fsState.files.set('file:///document/voice-recordings/s1-1.m4a', new Uint8Array(10));
    useRecordingQueue.getState().enqueue({
      sessionId: 's1', attemptN: 1, uri: 'file:///document/voice-recordings/s1-1.m4a', contentType: 'audio/mp4', durationS: 60, device: null,
    });
    await act(async () => void (await useRecordingQueue.getState().flush()));
    expect(await screen.findByText('4 recordings kept privately')).toBeTruthy();
  });

  it('deleting turns the record default off', async () => {
    appStorage.set(RECORD_DEFAULT_KEY, true);
    renderSection();
    await screen.findByTestId('vs-recordings-count');
    fireEvent.press(screen.getByTestId('vs-recordings-delete'));
    await confirmDelete();
    await waitFor(() => expect(appStorage.getBoolean(RECORD_DEFAULT_KEY)).toBe(false));
    expect(screen.getByTestId('vs-record-default').props.value).toBe(false);
  });

  it('a failed delete keeps the count and says so', async () => {
    m(decide.deleteVoiceRecordings).mockRejectedValue(new Error('offline'));
    renderSection();
    await screen.findByTestId('vs-recordings-count');
    fireEvent.press(screen.getByTestId('vs-recordings-delete'));
    await confirmDelete();
    expect(await screen.findByTestId('vs-recordings-error')).toBeTruthy();
    // Unknown how far the server got: the count is read again.
    await waitFor(() => expect(decide.voiceRecordingCount).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('vs-recordings-count')).toHaveTextContent('3 recordings kept privately');
  });

  it('the default-consent toggle is off until chosen and persists to MMKV', async () => {
    renderSection();
    const toggle = await screen.findByTestId('vs-record-default');
    expect(toggle.props.value).toBe(false);
    fireEvent(toggle, 'valueChange', true);
    expect(appStorage.getBoolean(RECORD_DEFAULT_KEY)).toBe(true);
    expect(screen.getByTestId('vs-record-default').props.value).toBe(true);
    fireEvent(screen.getByTestId('vs-record-default'), 'valueChange', false);
    expect(appStorage.getBoolean(RECORD_DEFAULT_KEY)).toBe(false);
  });
});

describe('Your sessions (history)', () => {
  type Player = { play: jest.Mock; pause: jest.Mock; replace: jest.Mock };
  const player = () => m(useAudioPlayer).mock.results.at(-1)!.value as Player;
  beforeEach(() => jest.requireActual('../test-utils/memoryFs').fsState.reset());

  it('lists sessions and songs from history', async () => {
    renderSection();
    const s0 = await screen.findByTestId('vs-rec-session-0');
    expect(screen.getByTestId('vs-rec-session-0-result')).toHaveTextContent('Likely Baritone · Low confidence');
    expect(screen.getByTestId('vs-rec-session-0-date')).toHaveTextContent(/2026/);
    expect(screen.getByTestId('vs-rec-session-1-result')).toHaveTextContent('No result yet');
    expect(within(s0).getByTestId('vs-rec-0-1')).toHaveTextContent(/Invented Song 1.*Alpha Band/);
    expect(screen.getByTestId('vs-rec-0-1-state')).toHaveTextContent('Counted');
    expect(screen.getByTestId('vs-rec-0-2-state')).toHaveTextContent('Not counted');
    expect(screen.getByTestId('vs-rec-0-2-exclude')).toHaveTextContent('Count it again');
    // ▶ and Delete only where decide has the recording.
    expect(screen.getByTestId('vs-rec-0-1-play')).toBeTruthy();
    expect(screen.getByTestId('vs-rec-0-1-delete')).toBeTruthy();
    expect(screen.queryByTestId('vs-rec-0-2-play')).toBeNull();
    expect(screen.queryByTestId('vs-rec-0-2-delete')).toBeNull();
    expect(screen.getByTestId('vs-rec-1-1')).toBeTruthy();
  });

  it('no sessions: no list', async () => {
    m(decide.getVoiceHistory).mockResolvedValue({ sessions: [] });
    renderSection();
    await screen.findByTestId('vs-recordings-count');
    await waitFor(() => expect(decide.getVoiceHistory).toHaveBeenCalled());
    expect(screen.queryByTestId('vs-rec-sessions')).toBeNull();
  });

  it('play downloads and plays own recording', async () => {
    const { fsState } = jest.requireActual('../test-utils/memoryFs');
    fsState.remote.set('https://decide.test/api/voice/recordings/rB1/audio', new Uint8Array(12));
    renderSection();
    fireEvent.press(await screen.findByTestId('vs-rec-0-1-play'));
    await waitFor(() => expect(player().play).toHaveBeenCalled());
    const [url, , opts] = m(File.downloadFileAsync).mock.calls[0] as [string, unknown, { headers: unknown }];
    expect(url).toBe('https://decide.test/api/voice/recordings/rB1/audio');
    expect(opts.headers).toEqual({ Authorization: `Bearer ${useAuth.getState().getToken()}` });
    expect(player().replace).toHaveBeenCalledWith('file:///cache/voice-playback/rB1.m4a');
    expect(screen.getByTestId('vs-rec-0-1-play')).toHaveTextContent('Stop');
  });

  it('a failed download says so', async () => {
    renderSection();
    fireEvent.press(await screen.findByTestId('vs-rec-0-1-play'));
    expect(await screen.findByTestId('vs-rec-play-error')).toBeTruthy();
  });

  it('exclude confirms, patches, refetches voice and recs', async () => {
    m(decide.patchVoiceAttempt).mockResolvedValue({ attempt_id: 'sB:1', excluded: true, result: SUMMARY, profile: 'reverted_to_mic' });
    renderSection();
    fireEvent.press(await screen.findByTestId('vs-rec-0-1-exclude'));
    expect(Alert.alert).toHaveBeenCalledWith("Don't count this song?", expect.stringMatching(/again without it/), expect.anything());
    expect(decide.patchVoiceAttempt).not.toHaveBeenCalled();
    const invalidate = jest.spyOn(client, 'invalidateQueries');
    await confirmDelete();
    expect(decide.patchVoiceAttempt).toHaveBeenCalledWith('sB:1', { excluded: true });
    expect(await screen.findByTestId('vs-rec-outcome')).toHaveTextContent('Your voice is back to your mic test result.');
    const keys = invalidate.mock.calls.map((c) => c[0]?.queryKey);
    expect(keys).toEqual(expect.arrayContaining([VOICE_KEY, RECS_KEY]));
    await waitFor(() => expect(decide.getVoiceHistory).toHaveBeenCalledTimes(2));
  });

  it('count it again needs no destructive confirm and sends excluded: false', async () => {
    m(decide.patchVoiceAttempt).mockResolvedValue({ attempt_id: 'sB:2', excluded: false, result: SUMMARY, profile: 'unchanged' });
    renderSection();
    fireEvent.press(await screen.findByTestId('vs-rec-0-2-exclude'));
    const alert = Alert.alert as jest.Mock;
    const buttons = alert.mock.calls.at(-1)[2] as { style?: string; onPress?: () => void }[];
    expect(buttons.some((b) => b.style === 'destructive')).toBe(false);
    await act(async () => buttons.find((b) => b.style !== 'cancel')!.onPress?.());
    expect(decide.patchVoiceAttempt).toHaveBeenCalledWith('sB:2', { excluded: false });
    expect(await screen.findByTestId('vs-rec-outcome')).toHaveTextContent('Your session result was worked out again.');
  });

  it('delete confirms, drops queued take first, then calls API', async () => {
    const order: string[] = [];
    const drop = jest.spyOn(useRecordingQueue.getState(), 'dropAttempt').mockImplementation((sid, n) => void order.push(`queue ${sid}:${n}`));
    m(decide.deleteVoiceRecording).mockImplementation(async (id: string) => void order.push(`api ${id}`));
    renderSection();
    fireEvent.press(await screen.findByTestId('vs-rec-0-1-delete'));
    expect(decide.deleteVoiceRecording).not.toHaveBeenCalled();
    await confirmDelete();
    await waitFor(() => expect(order).toEqual(['queue sB:1', 'api rB1']));
    // The list and the count are read again.
    await waitFor(() => expect(decide.getVoiceHistory).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(decide.voiceRecordingCount).toHaveBeenCalledTimes(2));
    drop.mockRestore();
  });

  it('pending upload row shown', async () => {
    const { fsState } = jest.requireActual('../test-utils/memoryFs');
    fsState.files.set('file:///document/voice-recordings/sA-1.m4a', new Uint8Array(10));
    m(decide.uploadVoiceRecording).mockImplementation(() => new Promise(() => {}));
    act(() =>
      useRecordingQueue.getState().enqueue({
        sessionId: 'sA', attemptN: 1, uri: 'file:///document/voice-recordings/sA-1.m4a', contentType: 'audio/mp4', durationS: 60, device: null,
      }),
    );
    renderSection();
    expect(await screen.findByTestId('vs-rec-1-1-pending')).toHaveTextContent('Uploading…');
    // A queued take can be deleted before it reaches decide.
    expect(screen.getByTestId('vs-rec-1-1-delete')).toBeTruthy();
    expect(screen.queryByTestId('vs-rec-1-1-play')).toBeNull();
  });

  it('deleting a take that was still uploading: drops it and deletes it on decide if the upload landed', async () => {
    const landed = { sessions: [HISTORY.sessions[0], { ...HISTORY.sessions[1], attempts: [attempt('sA', 1, { recording: REC('rA1') })] }] };
    m(decide.getVoiceHistory).mockResolvedValueOnce(HISTORY).mockResolvedValue(landed);
    const { fsState } = jest.requireActual('../test-utils/memoryFs');
    fsState.files.set('file:///document/voice-recordings/sA-1.m4a', new Uint8Array(10));
    act(() =>
      useRecordingQueue.getState().enqueue({
        sessionId: 'sA', attemptN: 1, uri: 'file:///document/voice-recordings/sA-1.m4a', contentType: 'audio/mp4', durationS: 60, device: null,
      }),
    );
    m(decide.deleteVoiceRecording).mockResolvedValue(undefined);
    renderSection();
    fireEvent.press(await screen.findByTestId('vs-rec-1-1-delete'));
    await confirmDelete();
    await waitFor(() => expect(decide.deleteVoiceRecording).toHaveBeenCalledWith('rA1'));
    expect(useRecordingQueue.getState().items).toEqual([]);
  });

  it('failure shows error and keeps row', async () => {
    m(decide.patchVoiceAttempt).mockRejectedValue(new Error('offline'));
    renderSection();
    fireEvent.press(await screen.findByTestId('vs-rec-0-1-exclude'));
    await confirmDelete();
    expect(await screen.findByTestId('vs-rec-error')).toBeTruthy();
    expect(screen.getByTestId('vs-rec-0-1')).toBeTruthy();
    expect(screen.getByTestId('vs-rec-0-1-state')).toHaveTextContent('Counted');
    expect(screen.queryByTestId('vs-rec-outcome')).toBeNull();
  });
});

describe('Me -> music profile gating', () => {
  const open = () => renderRouter(appRoutes(), { initialUrl: '/me/music-profile' });

  it('shows the section when decide enables the voice session', async () => {
    m(decide.getVoiceFlags).mockResolvedValue(flags(true));
    open();
    expect(await screen.findByTestId('vs-recordings')).toBeTruthy();
  });

  it('still shows it when the session is not enabled, so recordings can be deleted', async () => {
    m(decide.getVoiceFlags).mockResolvedValue(flags(false));
    open();
    await screen.findByTestId('voice-section');
    await waitFor(() => expect(decide.getVoiceFlags).toHaveBeenCalled());
    expect(await screen.findByTestId('vs-recordings')).toBeTruthy();
  });
});
