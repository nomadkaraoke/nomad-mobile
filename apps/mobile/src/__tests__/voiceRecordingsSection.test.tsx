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
import { RecordingsSection } from '../voiceSession/RecordingsSection';

jest.setTimeout(20_000);

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
  deleteVoiceRecordings: jest.fn(),
}));

const m = (f: unknown) => f as jest.Mock;
const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
const flags = (session_enabled: boolean) => ({ session_enabled, is_admin: false, voice_data: true, active_session_id: null });

const renderSection = () =>
  render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <IntlProvider locale="en">
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <RecordingsSection />
        </QueryClientProvider>
      </IntlProvider>
    </SafeAreaProvider>,
  );

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

  it('a failed delete keeps the count and says so', async () => {
    m(decide.deleteVoiceRecordings).mockRejectedValue(new Error('offline'));
    renderSection();
    await screen.findByTestId('vs-recordings-count');
    fireEvent.press(screen.getByTestId('vs-recordings-delete'));
    await confirmDelete();
    expect(await screen.findByTestId('vs-recordings-error')).toBeTruthy();
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
