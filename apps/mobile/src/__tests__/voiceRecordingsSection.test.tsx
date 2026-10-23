// Me -> music profile -> voice recordings (Phase 3d Task D7): the count, "delete all" (queue first, then decide),
// the default-consent toggle, and the section's gating.
import * as decide from '@nomad/api-decide';
import { IntlProvider } from '@nomad/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { Alert } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useAuth } from '../auth/store';
import { appStorage } from '../storage';
import { gen, session } from '../test-utils/genAuthMock';
import { appRoutes } from '../test-utils/routes';
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

beforeEach(async () => {
  jest.clearAllMocks();
  appStorage.remove(RECORD_DEFAULT_KEY);
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

describe('Me -> music profile gating', () => {
  const open = () => renderRouter(appRoutes(), { initialUrl: '/me/music-profile' });

  it('shows the section when decide enables the voice session', async () => {
    m(decide.getVoiceFlags).mockResolvedValue(flags(true));
    open();
    expect(await screen.findByTestId('vs-recordings')).toBeTruthy();
  });

  it('hides it when the session is not enabled', async () => {
    m(decide.getVoiceFlags).mockResolvedValue(flags(false));
    open();
    await screen.findByTestId('voice-section');
    await waitFor(() => expect(decide.getVoiceFlags).toHaveBeenCalled());
    expect(screen.queryByTestId('vs-recordings')).toBeNull();
  });
});
