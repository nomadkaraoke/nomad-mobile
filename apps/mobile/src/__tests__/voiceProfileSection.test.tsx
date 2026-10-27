// Me → Your music profile → Your voice (Phase 3d tuning batch 1, Task M4): the mic test result and the latest session
// result side by side (decide `GET /api/my/voice` {profile, mic, latest_session}), the "Used for song fit" badge on
// the card behind the saved profile, and adopting a session result that wasn't saved.
import * as decide from '@nomad/api-decide';
import { IntlProvider } from '@nomad/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useAuth } from '../auth/store';
import { RECS_KEY } from '../discover/useRecommendations';
import { gen, session } from '../test-utils/genAuthMock';
import { VOICE_KEY } from '../voice/useVoiceProfile';
import { VoiceProfileSection } from '../voice/VoiceProfileSection';
import { useVoiceStore } from '../voice/voiceStore';

jest.setTimeout(20_000);

jest.mock('expo-router', () => ({ ...jest.requireActual('expo-router'), router: { push: jest.fn() } }));
jest.mock('@nomad/api-gen', () => ({ ...jest.requireActual('@nomad/api-gen'), getMe: jest.fn() }));
jest.mock('@nomad/api-decide', () => ({
  ...jest.requireActual('@nomad/api-decide'),
  configureClient: jest.fn(),
  getVoiceProfiles: jest.fn(),
  adoptVoiceSession: jest.fn(),
  deleteVoiceProfile: jest.fn(),
  getVoiceFlags: jest.fn(),
}));

const m = (f: unknown) => f as jest.Mock;
const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };

const MIC = {
  low_midi: 43,
  high_midi: 67,
  comfort_low: 48,
  comfort_high: 58,
  voice_type: 'bass',
  voice_type_between: null,
  register: null,
  confidence: 'medium',
  method: 'mic',
  measured_at: '2026-10-20T10:00:00Z',
  updated_at: '2026-10-20T10:00:01Z',
} as const;
const LATEST = {
  session_id: 's1',
  voice_type: 'baritone',
  between: 'tenor',
  confidence_label: 'low',
  top_p: 0.45,
  low: 46,
  high: 70,
  comfort_low: 50,
  comfort_high: 60,
  attempts: 4,
  evidence_attempts: 4,
  profile_saved: false,
  computed_at: '2026-10-25T18:00:00Z',
} as const;
const SESSION_PROFILE = {
  ...MIC,
  low_midi: 46,
  high_midi: 70,
  comfort_low: 50,
  comfort_high: 60,
  voice_type: 'baritone',
  confidence: 'low',
  method: 'session',
  session_id: 's1',
  evidence_count: 4,
  measured_at: '2026-10-25T18:00:00Z',
} as const;

let client: QueryClient;
const renderSection = () => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <IntlProvider locale="en">
        <QueryClientProvider client={client}>
          <VoiceProfileSection />
        </QueryClientProvider>
      </IntlProvider>
    </SafeAreaProvider>,
  );
};

const serve = (v: { profile: unknown; mic: unknown; latestSession: unknown }) => m(decide.getVoiceProfiles).mockResolvedValue(v);

beforeEach(async () => {
  jest.clearAllMocks();
  act(() => useVoiceStore.getState().clear());
  m(decide.getVoiceFlags).mockResolvedValue({ session_enabled: true, is_admin: false, voice_data: true, active_session_id: null });
  await useAuth.getState().signOut();
  gen.getMe.mockResolvedValue({ email: 'me@example.com', credits: 3 } as never);
  await act(() => useAuth.getState().signInWithSession(session()));
});

describe('VoiceProfileSection: both results', () => {
  it('shows mic and low-confidence session side by side', async () => {
    serve({ profile: MIC, mic: MIC, latestSession: LATEST });
    renderSection();
    const mic = await screen.findByTestId('voice-card-mic');
    expect(mic).toHaveTextContent(/From your mic test/);
    expect(mic).toHaveTextContent(/Likely Bass/);
    expect(mic).toHaveTextContent(/G2.*G4/); // range
    expect(mic).toHaveTextContent(/C3.*A#3/); // comfort
    expect(mic).toHaveTextContent(/2026/);
    const s = screen.getByTestId('voice-card-session');
    expect(s).toHaveTextContent(/From your voice session/);
    expect(s).toHaveTextContent(/Between Baritone and Tenor/);
    expect(s).toHaveTextContent(/Low confidence/);
    expect(s).toHaveTextContent(/D3.*C4/); // comfort 50–60
    expect(s).toHaveTextContent(/4 songs/);
    expect(screen.getByTestId('voice-session-unsaved')).toHaveTextContent('Not saved as your voice: we need more songs to be sure');
    expect(screen.getByTestId('voice-session-adopt')).toHaveTextContent('Use this as my voice');
    // The saved profile's own summary, Redo and Remove stay.
    expect(screen.getByTestId('voice-section-type')).toHaveTextContent('Likely Bass');
    expect(screen.getByTestId('voice-redo')).toBeTruthy();
    expect(screen.getByTestId('voice-remove')).toBeTruthy();
  });

  it('active badge on the profile\'s source', async () => {
    serve({ profile: MIC, mic: MIC, latestSession: LATEST });
    const view = renderSection();
    const mic = await screen.findByTestId('voice-card-mic');
    await waitFor(() => expect(screen.getAllByTestId('voice-active-badge')).toHaveLength(1));
    expect(mic).toHaveTextContent(/Used for song fit/);
    expect(screen.getByTestId('voice-card-session')).not.toHaveTextContent(/Used for song fit/);
    view.unmount();

    serve({ profile: SESSION_PROFILE, mic: MIC, latestSession: { ...LATEST, profile_saved: true } });
    renderSection();
    const s = await screen.findByTestId('voice-card-session');
    await waitFor(() => expect(s).toHaveTextContent(/Used for song fit/));
    expect(screen.getByTestId('voice-card-mic')).not.toHaveTextContent(/Used for song fit/);
    // Saved and in use: nothing to adopt.
    expect(screen.queryByTestId('voice-session-adopt')).toBeNull();
    expect(screen.queryByTestId('voice-session-unsaved')).toBeNull();
  });

  it('adopt saves and refetches', async () => {
    serve({ profile: MIC, mic: MIC, latestSession: LATEST });
    m(decide.adoptVoiceSession).mockResolvedValue(SESSION_PROFILE);
    renderSection();
    fireEvent.press(await screen.findByTestId('voice-session-adopt'));
    const invalidate = jest.spyOn(client, 'invalidateQueries');
    serve({ profile: SESSION_PROFILE, mic: MIC, latestSession: { ...LATEST, profile_saved: true } });
    await waitFor(() => expect(decide.adoptVoiceSession).toHaveBeenCalledWith('s1'));
    // The phone follows at once (badges use its copy).
    await waitFor(() => expect(useVoiceStore.getState().profile).toMatchObject({ method: 'session', voiceType: 'baritone' }));
    await waitFor(() => expect(invalidate.mock.calls.map((c) => c[0]?.queryKey)).toEqual(expect.arrayContaining([VOICE_KEY, RECS_KEY])));
    await waitFor(() => expect(screen.getByTestId('voice-card-session')).toHaveTextContent(/Used for song fit/));
    expect(screen.queryByTestId('voice-session-adopt')).toBeNull();
  });

  it('adopt failure says so and keeps the button', async () => {
    serve({ profile: MIC, mic: MIC, latestSession: LATEST });
    m(decide.adoptVoiceSession).mockRejectedValue(new decide.ApiError(409, 'no_evidence'));
    renderSection();
    fireEvent.press(await screen.findByTestId('voice-session-adopt'));
    expect(await screen.findByTestId('voice-session-adopt-error')).toBeTruthy();
    expect(screen.getByTestId('voice-session-adopt')).toBeTruthy();
    expect(useVoiceStore.getState().profile?.method).toBe('mic');
  });

  it('no adopt button while decide has the voice session off (adopt needs it)', async () => {
    m(decide.getVoiceFlags).mockResolvedValue({ session_enabled: false, is_admin: false, voice_data: true, active_session_id: null });
    serve({ profile: MIC, mic: MIC, latestSession: LATEST });
    renderSection();
    await screen.findByTestId('voice-card-session');
    await waitFor(() => expect(decide.getVoiceFlags).toHaveBeenCalled());
    expect(screen.getByTestId('voice-session-unsaved')).toBeTruthy();
    expect(screen.queryByTestId('voice-session-adopt')).toBeNull();
  });

  it('only mic', async () => {
    serve({ profile: MIC, mic: MIC, latestSession: null });
    renderSection();
    expect(await screen.findByTestId('voice-card-mic')).toBeTruthy();
    expect(screen.queryByTestId('voice-card-session')).toBeNull();
  });

  it('only mic, from an older decide without the mic copy: the mic card comes from the saved profile', async () => {
    serve({ profile: MIC, mic: null, latestSession: null });
    renderSection();
    expect(await screen.findByTestId('voice-card-mic')).toHaveTextContent(/Likely Bass/);
  });

  it('only session', async () => {
    serve({ profile: null, mic: null, latestSession: LATEST });
    renderSection();
    expect(await screen.findByTestId('voice-card-session')).toBeTruthy();
    expect(screen.queryByTestId('voice-card-mic')).toBeNull();
    // No saved voice: the empty state's test button stays, beside the session's adopt.
    expect(screen.getByTestId('voice-test')).toBeTruthy();
    expect(screen.getByTestId('voice-session-adopt')).toBeTruthy();
  });

  it('none', async () => {
    serve({ profile: null, mic: null, latestSession: null });
    renderSection();
    expect(await screen.findByTestId('voice-section')).toHaveTextContent(/No voice profile yet/);
    await waitFor(() => expect(decide.getVoiceProfiles).toHaveBeenCalled());
    expect(screen.queryByTestId('voice-card-mic')).toBeNull();
    expect(screen.queryByTestId('voice-card-session')).toBeNull();
    expect(screen.getByTestId('voice-test')).toBeTruthy();
  });
});
