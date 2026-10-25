// Voice session screens at /discover/voice-session (Phase 3d Task D6): each step over a mocked useVoiceSession, one
// run through the real hook (mocked decide, fake recorder, fake player), the entry points and RTL isolation.
import type { NextSongOut, ResultOut, SessionSetup } from '@nomad/api-decide';
import { EMPTY_SESSION_QUIZ } from '@nomad/core';
import { IntlProvider, isolate } from '@nomad/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import { createRef, type ReactNode } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useAuth } from '../auth/store';
import { ImproveCard } from '../discover/components/ImproveCard';
import { appStorage } from '../storage';
import { gen, session } from '../test-utils/genAuthMock';
import { appRoutes } from '../test-utils/routes';
import type { MicPermission, PcmBuffer, PitchSource } from '../voice/pitchSource';
import { useVoiceStore, VOICE_STORAGE_KEY } from '../voice/voiceStore';
import type { PlayerHandle } from '../voiceSession/player/KaraokePlayer';
import type { SongTake } from '../voiceSession/recording/useSongRecorder';
import { PickCard } from '../voiceSession/screens/PickCard';
import { QuizScreen } from '../voiceSession/screens/QuizScreen';
import { useVoiceSessionStore, VOICE_SESSION_KEY } from '../voiceSession/sessionStore';
import type { VoiceSession } from '../voiceSession/useVoiceSession';

jest.setTimeout(20_000);

// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories can't use imports
jest.mock('expo-file-system', () => require('../test-utils/memoryFs'));

jest.mock('@nomad/api-gen', () => ({
  ...jest.requireActual('@nomad/api-gen'),
  getMe: jest.fn(),
}));

const mockApi = {
  getVoiceFlags: jest.fn(),
  createVoiceSession: jest.fn(),
  getVoiceSession: jest.fn(),
  patchVoiceSession: jest.fn(),
  nextVoiceSong: jest.fn(),
  skipVoiceSong: jest.fn(),
  postVoiceAttempt: jest.fn(),
  getVoiceResult: jest.fn(),
  uploadVoiceRecording: jest.fn(),
  getVoiceProfiles: jest.fn(async () => ({ profile: null, mic: null, latestSession: null })),
};
jest.mock('@nomad/api-decide', () => ({
  ...jest.requireActual('@nomad/api-decide'),
  getVoiceFlags: (...a: unknown[]) => mockApi.getVoiceFlags(...a),
  createVoiceSession: (...a: unknown[]) => mockApi.createVoiceSession(...a),
  getVoiceSession: (...a: unknown[]) => mockApi.getVoiceSession(...a),
  patchVoiceSession: (...a: unknown[]) => mockApi.patchVoiceSession(...a),
  nextVoiceSong: (...a: unknown[]) => mockApi.nextVoiceSong(...a),
  skipVoiceSong: (...a: unknown[]) => mockApi.skipVoiceSong(...a),
  postVoiceAttempt: (...a: unknown[]) => mockApi.postVoiceAttempt(...a),
  getVoiceResult: (...a: unknown[]) => mockApi.getVoiceResult(...a),
  uploadVoiceRecording: (...a: unknown[]) => mockApi.uploadVoiceRecording(...a),
  getVoiceProfiles: () => mockApi.getVoiceProfiles(),
}));

// The fake player (FAKE_YT): ready on mount, `ended` 20 ms after play().
jest.mock('../config', () => ({ ...jest.requireActual('../config'), FAKE_YT: true, FAKE_YT_SECONDS: 0.02 }));
// KaraokePlayer reads `config.FAKE_YT` at render: the link-out test switches it off.
const config = jest.requireMock('../config') as { FAKE_YT: boolean };

const mockRec = {
  start: jest.fn(async () => {}),
  stop: jest.fn(async (): Promise<SongTake> => ({ pitch: null, file: null, contour: null, held: [], takeOffsetS: 0 })),
};
jest.mock('../voiceSession/recording/useSongRecorder', () => ({
  useSongRecorder: () => ({ start: mockRec.start, stop: mockRec.stop, livePitch: null }),
}));

/** A quiet microphone: the setup screen's quiet second reads it. */
/** `permission`: what asking returns; `current`: what a no-prompt check reads. `asks` / `checks` count the calls. */
type Quiet = PitchSource & { permission: MicPermission; current: MicPermission; sections: string[]; asks: number; checks: number };
const RATE = 16000;
function quietSource(): Quiet {
  const src: Quiet = {
    kind: 'fake',
    permission: 'granted',
    sections: [],
    current: 'granted',
    asks: 0,
    checks: 0,
    requestPermission: async () => {
      src.asks++;
      return src.permission;
    },
    checkPermission: async () => {
      src.checks++;
      return src.current;
    },
    start: async (onBuffer: (b: PcmBuffer) => void, section) => {
      src.sections.push(section);
      const s = new Float32Array(RATE * 1.2);
      for (let off = 0; off < s.length; off += 1600) {
        onBuffer({ samples: s.subarray(off, off + 1600), sampleRate: RATE, timestamp: off / RATE });
      }
    },
    stop: () => {},
  };
  return src;
}
const mockSource: { current: Quiet | null } = { current: null };
jest.mock('../voice/usePitchSource', () => ({ usePitchSource: () => mockSource.current }));

/** Per test: a scripted session instead of the real hook (null = the real one). */
const mockVs: { current: VoiceSession | null } = { current: null };
jest.mock('../voiceSession/useVoiceSession', () => {
  const actual = jest.requireActual('../voiceSession/useVoiceSession');
  return { ...actual, useVoiceSession: () => mockVs.current ?? actual.useVoiceSession() };
});

const SETUP: SessionSetup = { posture: 'standing', warmth: 'bit_warm', record: true, headphones: true };

const SONG: NextSongOut = {
  song_key: 'alpha band|invented tune',
  artist: 'Alpha Band',
  title: 'Invented Tune',
  duration_s: 200,
  reason_type: 'upper_range',
  version: { video_id: 'vid-1', brand_code: 'NK', brand_name: 'Nomad', embeddable: true },
  alternatives: [],
  song_range: { low: 48, high: 67, p10: 50, p50: 57, p90: 64 } as never,
  attempt_n: 1,
  max_attempts: 12,
};

const RESULT: ResultOut = {
  voice_type: 'baritone',
  between: null,
  confidence_label: 'medium',
  top_p: 0.8,
  low: 45,
  high: 64,
  comfort_low: 48,
  comfort_high: 60,
  attempts: 3,
  partial: false,
  improve_hint: 'sing_higher_warm',
  done_reason: 'confident',
  profile_saved: true,
  suited: [
    {
      song_key: 'beta|invented two',
      artist: 'Beta',
      title: 'Invented Two',
      reason: '',
      reason_type: 'fit',
      reason_artist: null,
      score: 1,
      has_karaoke_version: true,
      karaoke: {} as never,
      facets: {} as never,
    },
  ],
  loved: [{ song_key: 'gamma|invented three', artist: 'Gamma', title: 'Invented Three' }],
};

function fakeVs(over: Partial<VoiceSession> = {}): VoiceSession {
  const async = () => jest.fn(async () => {});
  return {
    step: 'intro',
    setup: SETUP,
    song: null,
    attemptN: 0,
    maxAttempts: null,
    quiz: EMPTY_SESSION_QUIZ,
    prefill: null,
    result: null,
    falsettoChip: null,
    answerFalsetto: jest.fn(),
    catchUp: [],
    noteLabels: [],
    take: null,
    takeOffsetS: 0,
    livePitch: null,
    pitchSource: mockSource.current!,
    playerMode: 'embed-hosted',
    playerRef: createRef<PlayerHandle>(),
    error: null,
    restoring: false,
    busy: false,
    openSetup: jest.fn(),
    begin: async(),
    startWarmup: async(),
    endWarmup: async(),
    pickKnow: async(),
    pickSkip: async(),
    onPlayer: async(),
    stopEarly: async(),
    setAnswer: jest.fn(),
    submitQuiz: async(),
    finish: async(),
    patchContext: async(),
    retry: async(),
    reset: jest.fn(),
    ...over,
  };
}

const open = () => {
  const r = renderRouter(appRoutes(), { initialUrl: '/discover/voice-session' });
  jest.useRealTimers();
  return r;
};
const signIn = () => act(() => useAuth.getState().signInWithSession(session()));
const press = (id: string) => act(async () => void fireEvent.press(screen.getByTestId(id)));
const text = (id: string) => {
  const kids = screen.getByTestId(id).props.children;
  return Array.isArray(kids) ? kids.join('') : String(kids);
};
const METRICS_EN = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
const Shell = ({ children }: { children: ReactNode }) => (
  <SafeAreaProvider initialMetrics={METRICS_EN}>
    <IntlProvider locale="en">{children}</IntlProvider>
  </SafeAreaProvider>
);
const flags = (session_enabled: boolean) => ({ session_enabled, is_admin: false, voice_data: true, active_session_id: null });

beforeEach(async () => {
  jest.clearAllMocks();
  jest.useRealTimers();
  mockVs.current = null;
  mockSource.current = quietSource();
  appStorage.remove(VOICE_SESSION_KEY);
  appStorage.remove('voiceSession.recordDefault');
  appStorage.remove('voiceSession.background.v1');
  appStorage.remove(VOICE_STORAGE_KEY);
  act(() => useVoiceSessionStore.getState().clear());
  act(() => useVoiceStore.getState().clear());
  await useAuth.getState().signOut();
  gen.getMe.mockResolvedValue({ email: 'me@example.com', credits: 3 } as never);
  mockApi.getVoiceFlags.mockResolvedValue(flags(true));
});
afterEach(() => jest.useRealTimers());

// The full walk through the real hook is slow on loaded CI runners (36 s seen): give each step room.
const SLOW = { timeout: 10_000 };

describe('voiceSessionScreens: steps', () => {
  it('intro: pinned copy; Start opens the setup when signed in', async () => {
    await signIn();
    const vs = fakeVs();
    mockVs.current = vs;
    open();
    await screen.findByTestId('vs-intro');
    expect(screen.getByText('Find your voice', { exact: true })).toBeTruthy();
    expect(screen.getByText('Sing 5–10 songs you know, about 30 minutes. Best at home, with headphones.')).toBeTruthy();
    await press('vs-intro-start');
    expect(vs.openSetup).toHaveBeenCalled();
  });

  it('intro: signed out, Start opens sign-in returning here', async () => {
    mockVs.current = fakeVs();
    const r = open();
    await screen.findByTestId('vs-intro');
    await press('vs-intro-start');
    await waitFor(() => expect(r.getPathname()).toBe('/sign-in'));
  });

  it('setup: Go stays off until every question is answered; then measures the quiet second and begins', async () => {
    const vs = fakeVs({ step: 'setup', setup: null });
    mockVs.current = vs;
    open();
    await screen.findByTestId('vs-setup');
    expect(screen.getByText(/We upload the recording and keep it privately/)).toBeTruthy();
    expect(screen.getByTestId('vs-setup-go')).toBeDisabled();
    await press('vs-posture-sitting');
    await press('vs-warmth-bit_warm');
    await press('vs-record-no');
    await press('vs-headphones-no');
    expect(screen.getByText('The backing track will leak into the mic, so recordings count for less.')).toBeTruthy();
    expect(screen.getByTestId('vs-setup-go')).toBeEnabled();
    await press('vs-setup-go');
    await waitFor(() => expect(vs.begin).toHaveBeenCalled());
    const [setup, floor] = (vs.begin as jest.Mock).mock.calls[0];
    expect(setup).toMatchObject({ posture: 'sitting', warmth: 'bit_warm', record: false, headphones: false });
    expect(floor).toBeCloseTo(0.003);
    expect(mockSource.current!.sections).toEqual(['low']);
  });

  it('setup: the Record-me default from Me pre-fills the question', async () => {
    appStorage.set('voiceSession.recordDefault', true);
    const vs = fakeVs({ step: 'setup', setup: null });
    mockVs.current = vs;
    open();
    await screen.findByTestId('vs-setup');
    await press('vs-posture-sitting');
    await press('vs-warmth-bit_warm');
    await press('vs-headphones-yes');
    // Not asked by hand: the stored default answers it.
    expect(screen.getByTestId('vs-setup-go')).toBeEnabled();
    await press('vs-setup-go');
    await waitFor(() => expect(vs.begin).toHaveBeenCalled());
    expect((vs.begin as jest.Mock).mock.calls[0][0]).toMatchObject({ record: true });
  });

  it('setup: background optional, sent when answered', async () => {
    const vs = fakeVs({ step: 'setup', setup: null });
    mockVs.current = vs;
    open();
    await screen.findByTestId('vs-setup');
    await press('vs-posture-sitting');
    await press('vs-warmth-warm');
    await press('vs-record-no');
    await press('vs-headphones-yes');
    // Collapsed until opened; Go doesn't wait for it.
    expect(screen.queryByTestId('vs-setup-experience-some')).toBeNull();
    expect(screen.getByTestId('vs-setup-go')).toBeEnabled();
    await press('vs-setup-background');
    expect(screen.getByText('Do you use falsetto or head voice?')).toBeTruthy();
    await press('vs-setup-experience-some');
    await press('vs-setup-falsetto-yes');
    await press('vs-setup-go');
    await waitFor(() => expect(vs.begin).toHaveBeenCalled());
    expect((vs.begin as jest.Mock).mock.calls[0][0]).toMatchObject({ experience: 'some', uses_falsetto: 'yes' });
    // Remembered for next time.
    expect(JSON.parse(appStorage.getString('voiceSession.background.v1')!)).toEqual({ experience: 'some', usesFalsetto: 'yes' });
  });

  it('setup: background not answered, not sent', async () => {
    const vs = fakeVs({ step: 'setup', setup: null });
    mockVs.current = vs;
    open();
    await screen.findByTestId('vs-setup');
    await press('vs-posture-sitting');
    await press('vs-warmth-warm');
    await press('vs-record-no');
    await press('vs-headphones-yes');
    await press('vs-setup-go');
    await waitFor(() => expect(vs.begin).toHaveBeenCalled());
    const sent = (vs.begin as jest.Mock).mock.calls[0][0];
    expect(sent).not.toHaveProperty('experience');
    expect(sent).not.toHaveProperty('uses_falsetto');
  });

  it('setup: background prefilled from last session', async () => {
    appStorage.set('voiceSession.background.v1', JSON.stringify({ experience: 'trained', usesFalsetto: 'no' }));
    const vs = fakeVs({ step: 'setup', setup: null });
    mockVs.current = vs;
    open();
    await screen.findByTestId('vs-setup');
    await press('vs-setup-background');
    expect(screen.getByTestId('vs-setup-experience-trained').props.accessibilityState).toEqual(expect.objectContaining({ selected: true }));
    expect(screen.getByTestId('vs-setup-falsetto-no').props.accessibilityState).toEqual(expect.objectContaining({ selected: true }));
    await press('vs-posture-sitting');
    await press('vs-warmth-warm');
    await press('vs-record-no');
    await press('vs-headphones-yes');
    await press('vs-setup-go');
    await waitFor(() => expect(vs.begin).toHaveBeenCalled());
    expect((vs.begin as jest.Mock).mock.calls[0][0]).toMatchObject({ experience: 'trained', uses_falsetto: 'no' });
  });

  it('setup: cold offers the warm-up', async () => {
    const vs = fakeVs({ step: 'setup', setup: null });
    mockVs.current = vs;
    open();
    await screen.findByTestId('vs-setup');
    await press('vs-posture-standing');
    await press('vs-warmth-cold');
    await press('vs-record-yes');
    await press('vs-headphones-yes');
    await press('vs-setup-go');
    await screen.findByTestId('vs-warmup-start');
    expect(vs.begin).not.toHaveBeenCalled();
    await press('vs-warmup-start');
    expect(vs.startWarmup).toHaveBeenCalledWith(expect.any(Number));
  });

  it('setup: a blocked mic shows "Microphone is off" and forces recording off', async () => {
    mockSource.current!.permission = 'blocked';
    const vs = fakeVs({ step: 'setup', setup: null });
    mockVs.current = vs;
    open();
    await screen.findByTestId('vs-setup');
    await press('vs-posture-standing');
    await press('vs-warmth-warm');
    await press('vs-record-yes');
    await press('vs-headphones-yes');
    await press('vs-setup-go');
    expect(await screen.findByText('Microphone is off')).toBeTruthy();
    expect(screen.getByTestId('vs-open-settings')).toBeTruthy();
    expect(screen.queryByTestId('vs-record-yes')).toBeNull();
    await press('vs-setup-go');
    await waitFor(() => expect(vs.begin).toHaveBeenCalled());
    expect((vs.begin as jest.Mock).mock.calls[0][0]).toMatchObject({ record: false });
  });

  it('warm-up: hum prompt, live keyboard, Done ends it and asks warmth again', async () => {
    const vs = fakeVs({ step: 'warmup', livePitch: 52 });
    mockVs.current = vs;
    open();
    await screen.findByTestId('vs-warmup');
    expect(screen.getByText('Hum a comfortable note')).toBeTruthy();
    expect(screen.getByTestId('vs-warmup-keys')).toBeTruthy();
    await press('vs-warmup-done');
    expect(vs.endWarmup).toHaveBeenCalled();
  });

  it('pick: song, reason, skip reasons; Finish only after the first song; buttons off while busy', async () => {
    const vs = fakeVs({ step: 'pick', song: SONG, attemptN: 1 });
    mockVs.current = vs;
    open();
    await screen.findByTestId('vs-pick');
    expect(screen.getByText('Checks your upper range')).toBeTruthy();
    expect(screen.getByText('Song 1')).toBeTruthy();
    expect(screen.queryByTestId('vs-finish')).toBeNull();
    await press('vs-pick-dont-know');
    expect(vs.pickSkip).toHaveBeenCalledWith('dont_know');
    await press('vs-pick-else');
    expect(vs.pickSkip).toHaveBeenCalledWith('something_else');
    await press('vs-pick-know');
    expect(vs.pickKnow).toHaveBeenCalled();

    mockVs.current = fakeVs({ step: 'pick', song: { ...SONG, attempt_n: 2 }, attemptN: 2, busy: true });
    screen.rerender(<></>);
    open();
    await screen.findByTestId('vs-pick');
    expect(screen.getByTestId('vs-finish')).toBeTruthy();
    expect(screen.getByTestId('vs-pick-know')).toBeDisabled();
    expect(screen.getByTestId('vs-finish')).toBeDisabled();
  });

  it('play: the player, recording dot, stop early; the context sheet patches the session', async () => {
    const vs = fakeVs({ step: 'play', song: SONG, attemptN: 1 });
    mockVs.current = vs;
    open();
    await screen.findByTestId('vs-play');
    expect(screen.getByTestId('vs-player')).toBeTruthy();
    // Recording is consented and the mic is on (read on arrival without a prompt: this visit skipped the setup).
    expect(await screen.findByTestId('vs-recording')).toBeTruthy();
    expect(mockSource.current!.checks).toBe(1);
    expect(mockSource.current!.asks).toBe(0);
    await press('vs-ribbon-toggle');
    expect(screen.getByTestId('vs-play-keys')).toBeTruthy();
    expect(screen.getByText('Standing · A bit warmed up')).toBeTruthy();
    await press('vs-context-chip');
    await screen.findByTestId('vs-context-sheet');
    await press('vs-ctx-warmth-warm');
    expect(vs.patchContext).toHaveBeenCalledWith({ warmth: 'warm' });
    await press('vs-ctx-record-off');
    expect(vs.patchContext).toHaveBeenCalledWith({ record: false });
    await press('vs-stop-early');
    expect(vs.stopEarly).toHaveBeenCalled();
  });

  it('play: with recording off, no dot and the sheet only says so (no way to turn it back on)', async () => {
    mockVs.current = fakeVs({ step: 'play', song: SONG, attemptN: 1, setup: { ...SETUP, record: false } });
    open();
    await screen.findByTestId('vs-play');
    expect(screen.queryByTestId('vs-recording')).toBeNull();
    await press('vs-context-chip');
    await screen.findByTestId('vs-context-sheet');
    expect(screen.getByText('Recording off')).toBeTruthy();
    expect(screen.queryByTestId('vs-ctx-record-off')).toBeNull();
    expect(screen.queryByTestId('vs-ctx-record-on')).toBeNull();
    expect(screen.queryByTestId('vs-ctx-record-yes')).toBeNull();
  });

  it('play (resumed): the mic is only read, never asked for; not granted keeps the dot off', async () => {
    mockSource.current!.current = 'denied';
    mockVs.current = fakeVs({ step: 'play', song: SONG, attemptN: 1 });
    open();
    await screen.findByTestId('vs-play');
    await waitFor(() => expect(mockSource.current!.checks).toBe(1));
    expect(mockSource.current!.asks).toBe(0);
    expect(screen.queryByTestId('vs-recording')).toBeNull();
  });

  it('setup: a double tap on Go runs one permission ask and one quiet second', async () => {
    const vs = fakeVs({ step: 'setup', setup: null });
    mockVs.current = vs;
    open();
    await screen.findByTestId('vs-setup');
    await press('vs-posture-standing');
    await press('vs-warmth-warm');
    await press('vs-record-yes');
    await press('vs-headphones-yes');
    await act(async () => {
      fireEvent.press(screen.getByTestId('vs-setup-go'));
      fireEvent.press(screen.getByTestId('vs-setup-go'));
    });
    await waitFor(() => expect(vs.begin).toHaveBeenCalledTimes(1));
    expect(mockSource.current!.asks).toBe(1);
    expect(mockSource.current!.sections).toEqual(['low']);
  });

  it('setup: back from Settings with the mic now on, the record question returns', async () => {
    const handlers: ((s: AppStateStatus) => void)[] = [];
    // RN's jest AppState.addEventListener is already a mock: spyOn returns it, and mockRestore would drop its
    // implementation for later tests. Keep the original and put it back instead.
    const original = (AppState.addEventListener as unknown as jest.Mock).getMockImplementation();
    const spy = jest.spyOn(AppState, 'addEventListener').mockImplementation((_t, h) => {
      handlers.push(h as (s: AppStateStatus) => void);
      return { remove: () => {} } as never;
    });
    try {
      mockSource.current!.permission = 'blocked';
      mockVs.current = fakeVs({ step: 'setup', setup: null });
      open();
      await screen.findByTestId('vs-setup');
      await press('vs-posture-standing');
      await press('vs-warmth-warm');
      await press('vs-record-yes');
      await press('vs-headphones-yes');
      await press('vs-setup-go');
      await screen.findByTestId('vs-mic-off');
      expect(screen.queryByTestId('vs-record-yes')).toBeNull();

      mockSource.current!.permission = 'granted';
      await act(async () => handlers.forEach((h) => h('active')));
      expect(await screen.findByTestId('vs-record-yes')).toBeTruthy();
      expect(screen.getByText(/We upload the recording and keep it privately/)).toBeTruthy();
      expect(screen.queryByTestId('vs-mic-off')).toBeNull();
    } finally {
      if (original) spy.mockImplementation(original);
    }
  });

  it('quiz: Next stays off until Q1 and Q2; the prefill line shows note names', async () => {
    const vs = fakeVs({ step: 'quiz', song: SONG, attemptN: 1, prefill: { highest: 67, lowest: 48, suggested: null } });
    mockVs.current = vs;
    open();
    await screen.findByTestId('vs-quiz');
    expect(text('vs-prefill')).toBe(`Your highest held note was ${isolate('G4')}, lowest ${isolate('C3')}`);
    expect(screen.getByText('Where did it sit for your voice?')).toBeTruthy();
    expect(screen.getByText('Only if I\'m in the mood')).toBeTruthy();
    expect(screen.getByTestId('vs-quiz-next')).toBeDisabled();
    await press('vs-q-feel-loved');
    expect(vs.setAnswer).toHaveBeenCalledWith({ feel: 'loved' });
    await press('vs-q-work-warmer');
    expect(vs.setAnswer).toHaveBeenCalledWith(expect.objectContaining({ wouldWorkIf: ['warmer'] }));

    mockVs.current = fakeVs({ ...vs, quiz: { ...EMPTY_SESSION_QUIZ, feel: 'loved', position: 'comfortable' } });
    screen.rerender(<></>);
    open();
    await screen.findByTestId('vs-quiz');
    expect(screen.getByTestId('vs-quiz-next')).toBeEnabled();
    await press('vs-quiz-next');
    expect(mockVs.current.submitQuiz).toHaveBeenCalled();
  });

  it('quiz: the falsetto catch-up shows only with missed high notes, answers go to the session as quiz labels, Next is not blocked', async () => {
    const c = { tStart: 151.2, tEnd: 152.7, midi: 69 };
    const vs = fakeVs({
      step: 'quiz',
      song: SONG,
      attemptN: 1,
      catchUp: [c],
      quiz: { ...EMPTY_SESSION_QUIZ, feel: 'loved', position: 'comfortable' },
    });
    mockVs.current = vs;
    open();
    await screen.findByTestId('vs-falsetto-catchup');
    expect(screen.getByText('Were these high notes falsetto?')).toBeTruthy();
    expect(screen.queryByTestId('vs-falsetto-q-0-play')).toBeNull(); // no take: no replay
    expect(screen.getByTestId('vs-quiz-next')).toBeEnabled();
    await press('vs-falsetto-q-0-unsure');
    expect(vs.answerFalsetto).toHaveBeenCalledWith(c, 'unsure', 'quiz');
    await press('vs-quiz-next');
    expect(vs.submitQuiz).toHaveBeenCalled();
  });

  it('quiz: no missed notes, no catch-up', async () => {
    mockVs.current = fakeVs({ step: 'quiz', song: SONG, attemptN: 1 });
    open();
    await screen.findByTestId('vs-quiz');
    expect(screen.queryByTestId('vs-falsetto-catchup')).toBeNull();
  });

  it('quiz: a "comfortable" prefill pre-selects Q2 once, unless already answered', async () => {
    const setAnswer = jest.fn();
    const props = { song: SONG, prefill: { highest: 67, lowest: 48, suggested: 'comfortable' as const }, busy: false, setAnswer, onNext: jest.fn() };
    const first = render(
      <Shell>
        <QuizScreen {...props} quiz={EMPTY_SESSION_QUIZ} />
      </Shell>,
    );
    expect(setAnswer).toHaveBeenCalledWith({ position: 'comfortable' });
    first.unmount();
    setAnswer.mockClear();
    render(
      <Shell>
        <QuizScreen {...props} quiz={{ ...EMPTY_SESSION_QUIZ, position: 'too_high' }} />
      </Shell>,
    );
    expect(setAnswer).not.toHaveBeenCalled();
  });

  it('quiz: "Not great" shows the version issue chips', async () => {
    mockVs.current = fakeVs({ step: 'quiz', song: SONG, quiz: { ...EMPTY_SESSION_QUIZ, versionQuality: 'not_great' } });
    open();
    await screen.findByTestId('vs-quiz');
    expect(screen.getByTestId('vs-q-issue-bad_sync')).toBeTruthy();
  });

  it('result: low confidence wording, range, hint, songs; Done forgets the session', async () => {
    const vs = fakeVs({ step: 'result', result: { ...RESULT, confidence_label: 'low' } });
    mockVs.current = vs;
    open();
    await screen.findByTestId('vs-result');
    expect(text('vs-result-type')).toBe('Probably Baritone, but we need more songs to be sure');
    expect(text('vs-result-range')).toBe(`${isolate('A2–E4')}, comfortable ${isolate('C3–C4')}`);
    expect(text('vs-result-confidence')).toBe('Low confidence');
    expect(text('vs-result-hint')).toBe("Sing 2 more higher songs when you're warmed up");
    expect(screen.getByTestId('vs-result-song-0')).toBeTruthy();
    expect(screen.getByTestId('vs-result-loved-0')).toBeTruthy();
    // done_reason set: the session is over, no "Keep going".
    expect(screen.queryByTestId('vs-result-more')).toBeNull();
    await press('vs-result-done');
    expect(vs.reset).toHaveBeenCalled();
  });

  it('result: between two types; Keep going when the singer finished early', async () => {
    const vs = fakeVs({ step: 'result', result: { ...RESULT, between: 'tenor', done_reason: null } });
    mockVs.current = vs;
    open();
    await screen.findByTestId('vs-result');
    expect(text('vs-result-type')).toBe('Between Baritone and Tenor');
    await press('vs-result-more');
    expect(vs.openSetup).toHaveBeenCalled();
  });

  it('result: a voice type this app does not know reads "Your voice type", never the raw value', async () => {
    mockVs.current = fakeVs({ step: 'result', result: { ...RESULT, voice_type: 'countertenor' } });
    open();
    await screen.findByTestId('vs-result');
    expect(text('vs-result-type')).toBe('Your voice type');
  });

  it('result: a song closes the session modal first, then opens its page on the root stack (back: Discover)', async () => {
    mockVs.current = fakeVs({ step: 'result', result: RESULT });
    const r = renderRouter(appRoutes(), { initialUrl: '/discover' });
    jest.useRealTimers();
    await signIn();
    act(() => router.push('/discover/voice-session'));
    await screen.findByTestId('vs-result');
    const dismiss = jest.spyOn(router, 'dismiss');
    const push = jest.spyOn(router, 'push');
    await press('vs-result-loved-0');
    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith({ pathname: '/song/[id]', params: { id: RESULT.loved[0]!.song_key } });
    expect(dismiss.mock.invocationCallOrder[0]).toBeLessThan(push.mock.invocationCallOrder[0]!);
    await waitFor(() => expect(r.getPathname()).toBe(`/song/${RESULT.loved[0]!.song_key}`));
    // The session modal is gone: back from the song page lands on Discover, not on the result.
    act(() => router.back());
    await waitFor(() => expect(r.getPathname()).toBe('/discover'));
    expect(screen.queryByTestId('vs-result')).toBeNull();
    dismiss.mockRestore();
    push.mockRestore();
  });

  it('result: tapping a suited song opens its song page', async () => {
    mockVs.current = fakeVs({ step: 'result', result: RESULT });
    const r = open();
    await screen.findByTestId('vs-result');
    await press('vs-result-song-0');
    await waitFor(() => expect(r.getPathname()).toBe('/song/beta|invented two'));
  });

  it('errors: network offers retry; warming up says so; a lost session starts again', async () => {
    const vs = fakeVs({ step: 'loading', error: 'network' });
    mockVs.current = vs;
    open();
    await screen.findByTestId('vs-error');
    await press('vs-retry');
    expect(vs.retry).toHaveBeenCalled();

    mockVs.current = fakeVs({ step: 'loading', error: 'warming_up' });
    screen.rerender(<></>);
    open();
    expect(await screen.findByText('Getting songs ready, try again in a minute')).toBeTruthy();

    const lost = fakeVs({ step: 'error', error: 'session_lost' });
    mockVs.current = lost;
    screen.rerender(<></>);
    open();
    await screen.findByTestId('vs-error');
    expect(screen.queryByTestId('vs-retry')).toBeNull();
    await press('vs-restart');
    expect(lost.reset).toHaveBeenCalled();
  });

  it('disabled: "Coming soon"', async () => {
    mockVs.current = fakeVs({ step: 'disabled' });
    open();
    expect(await screen.findByText('Coming soon')).toBeTruthy();
  });
});

describe('voiceSessionScreens: through the real hook', () => {
  it('intro → setup → pick → play (fake) → quiz → result', async () => {
    await signIn();
    mockApi.createVoiceSession.mockResolvedValue({ session_id: 's1' });
    mockApi.nextVoiceSong.mockResolvedValue({ ...SONG, kind: 'song' });
    mockApi.postVoiceAttempt.mockResolvedValue({ attempt_id: 's1:1', n: 1, done: true, done_reason: 'confident', top_p: 0.8 });
    mockApi.getVoiceResult.mockResolvedValue(RESULT);
    open();
    await screen.findByTestId('vs-intro', {}, SLOW);
    await press('vs-intro-start');
    await screen.findByTestId('vs-setup', {}, SLOW);
    await press('vs-posture-standing');
    await press('vs-warmth-bit_warm');
    await press('vs-record-no');
    await press('vs-headphones-yes');
    await press('vs-setup-go');
    await screen.findByTestId('vs-pick', {}, SLOW);
    expect(screen.getByText(isolate('Invented Tune'))).toBeTruthy();
    expect(mockApi.createVoiceSession).toHaveBeenCalledWith(expect.objectContaining({ posture: 'standing', record: false }));
    await press('vs-pick-know');
    await screen.findByTestId('vs-fake-player', {}, SLOW);
    // ready → recorder → play() → ended after FAKE_YT_SECONDS: the quiz.
    await screen.findByTestId('vs-quiz', {}, SLOW);
    expect(mockRec.start).toHaveBeenCalled();
    await press('vs-q-feel-fine');
    await press('vs-q-position-too_high');
    await press('vs-quiz-next');
    await screen.findByTestId('vs-result', {}, SLOW);
    expect(text('vs-result-type')).toBe('Likely Baritone');
    expect(mockApi.postVoiceAttempt).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({ quiz: expect.objectContaining({ feel: 'fine', position: 'too_high' }) }),
    );
  });
});

describe('voiceSessionScreens: link-out', () => {

  it('a version decide marks not embeddable plays through the link-out card', async () => {
    config.FAKE_YT = false;
    try {
      await signIn();
      useVoiceSessionStore.getState().update({
        sessionId: 's1',
        setup: SETUP,
        step: 'pick',
        song: { ...SONG, version: { ...SONG.version, embeddable: false } },
        attemptN: 1,
      });
      mockApi.getVoiceSession.mockResolvedValue({ state: 'active', attempts: 0 });
      open();
      await screen.findByTestId('vs-pick');
      await press('vs-pick-know');
      expect(await screen.findByTestId('vs-linkout')).toBeTruthy();
      expect(screen.getByTestId('vs-linkout-open')).toBeTruthy();
    } finally {
      config.FAKE_YT = true;
    }
  });
});

describe('voiceSessionScreens: entry points', () => {
  const Providers = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <IntlProvider locale="en">{children}</IntlProvider>
    </QueryClientProvider>
  );

  it('Discover improve card: the session entry only when session_enabled', async () => {
    await signIn();
    mockApi.getVoiceFlags.mockResolvedValue(flags(false));
    const first = render(
      <Providers>
        <ImproveCard onAddArtists={jest.fn()} />
      </Providers>,
    );
    await waitFor(() => expect(mockApi.getVoiceFlags).toHaveBeenCalled());
    expect(screen.queryByTestId('vs-entry-discover')).toBeNull();
    first.unmount();

    mockApi.getVoiceFlags.mockResolvedValue(flags(true));
    render(
      <Providers>
        <ImproveCard onAddArtists={jest.fn()} />
      </Providers>,
    );
    expect(await screen.findByText('Find your voice (30 min)')).toBeTruthy();
    expect(screen.getByTestId('vs-entry-discover')).toBeTruthy();
  });
});

describe('voiceSessionScreens: RTL (ar)', () => {
  const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
  const Ar = ({ children }: { children: ReactNode }) => (
    <SafeAreaProvider initialMetrics={METRICS}>
      <IntlProvider locale="ar">{children}</IntlProvider>
    </SafeAreaProvider>
  );

  it('isolates the title, the artist and the note names', () => {
    render(
      <Ar>
        <PickCard song={SONG} attemptN={1} busy={false} onKnow={jest.fn()} onSkip={jest.fn()} onFinish={jest.fn()} />
      </Ar>,
    );
    expect(text('vs-pick-title')).toBe(isolate('Invented Tune'));
    expect(text('vs-pick-artist')).toBe(isolate('Alpha Band'));
  });

  it('isolates the prefill notes', () => {
    render(
      <Ar>
        <QuizScreen
          song={SONG}
          quiz={EMPTY_SESSION_QUIZ}
          prefill={{ highest: 67, lowest: 48, suggested: null }}
          busy={false}
          setAnswer={jest.fn()}
          onNext={jest.fn()}
        />
      </Ar>,
    );
    const line = text('vs-prefill');
    expect(line).toContain(isolate('G4'));
    expect(line).toContain(isolate('C3'));
  });
});
