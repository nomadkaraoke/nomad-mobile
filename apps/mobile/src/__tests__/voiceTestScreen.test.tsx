// Voice test screens at /discover/voice (Phase 3c Task 18a): mic test, self-report, result, local save.
import { IntlProvider, isolate } from '@nomad/i18n';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import type { ReactNode } from 'react';
import { AppState, Linking, type AppStateStatus } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useAuth } from '../auth/store';
import { appStorage } from '../storage';
import { gen, session } from '../test-utils/genAuthMock';
import { appRoutes } from '../test-utils/routes';
import type { MicPermission, PcmBuffer, PitchSource, VoiceSection } from '../voice/pitchSource';
import { VoiceResult } from '../voice/VoiceResult';
import { profileFromSelfReport, toVoiceProfileIn, useVoiceStore, VOICE_STORAGE_KEY } from '../voice/voiceStore';

jest.mock('@nomad/api-gen', () => ({
  ...jest.requireActual('@nomad/api-gen'),
  getMe: jest.fn(),
}));

const RATE = 16000;
const CHUNK = 1600;
const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
function tone(midi: number | null, secs: number): Float32Array {
  const n = Math.round(secs * RATE);
  const out = new Float32Array(n);
  if (midi !== null) for (let i = 0; i < n; i++) out[i] = 0.3 * Math.sin((2 * Math.PI * hz(midi) * i) / RATE);
  return out;
}
function concat(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** A baritone run: A2 held low, A4 held high, then a short tune around the middle. */
// The voice test's sections ('song' is the voice session's, never played here: it falls back to 'sing').
const SCRIPT: Record<Exclude<VoiceSection, 'song'>, Float32Array> = {
  low: concat(tone(null, 1), tone(45, 1.2)),
  high: concat(tone(null, 1), tone(69, 1.2)),
  sing: concat(tone(null, 1), ...[52, 55, 59, 62, 57, 54].map((m) => tone(m, 0.8))),
};

type Scripted = PitchSource & { permission: MicPermission; stops: number; sections: VoiceSection[] };
function scripted(): Scripted {
  const src: Scripted = {
    kind: 'fake',
    permission: 'granted',
    stops: 0,
    sections: [],
    requestPermission: async () => src.permission,
    // Plays the whole section at once, as the real source would over a few seconds.
    start: async (onBuffer: (b: PcmBuffer) => void, section: VoiceSection) => {
      src.sections.push(section);
      const s = SCRIPT[section === 'song' ? 'sing' : section];
      for (let off = 0; off < s.length; off += CHUNK) {
        onBuffer({ samples: s.subarray(off, off + CHUNK), sampleRate: RATE, timestamp: off / RATE });
      }
    },
    stop: () => {
      src.stops++;
    },
  };
  return src;
}

const mockSource: { current: Scripted | null } = { current: null };
jest.mock('../voice/usePitchSource', () => ({ usePitchSource: () => mockSource.current }));

const API_KEYS = [
  'comfort_high',
  'comfort_low',
  'confidence',
  'high_midi',
  'low_midi',
  'measured_at',
  'method',
  'register',
  'voice_type',
  'voice_type_between',
];

const open = () => renderRouter(appRoutes(), { initialUrl: '/discover/voice' });
const signIn = () => act(() => useAuth.getState().signInWithSession(session()));
const press = (id: string) => act(async () => void fireEvent.press(screen.getByTestId(id)));
const text = (id: string) => {
  const node = screen.getByTestId(id);
  const kids = node.props.children;
  return Array.isArray(kids) ? kids.join('') : String(kids);
};

async function runToResult() {
  await press('voice-start');
  expect(screen.getByTestId('voice-low-done')).toBeEnabled();
  await press('voice-low-done');
  expect(await screen.findByTestId('voice-high-done')).toBeEnabled();
  await press('voice-high-done');
  await screen.findByTestId('voice-sing-skip');
  await press('voice-sing-skip');
  await screen.findByTestId('voice-result-type');
}

beforeEach(async () => {
  jest.clearAllMocks();
  jest.useRealTimers();
  mockSource.current = scripted();
  appStorage.remove(VOICE_STORAGE_KEY);
  act(() => useVoiceStore.getState().clear());
  await useAuth.getState().signOut();
  gen.getMe.mockResolvedValue({ email: 'me@example.com', credits: 3 } as never);
});
afterEach(() => jest.useRealTimers());

describe('voice test', () => {
  it('intro shows the pinned copy, Start and the self-report way out', async () => {
    open();
    expect(await screen.findByText('Find a quiet spot. Sing "laaa". Takes about a minute.')).toBeTruthy();
    expect(screen.getByTestId('voice-start')).toBeTruthy();
    expect(screen.getByTestId('voice-skip')).toBeTruthy();
  });

  it('a full run shows "Likely Baritone"; Save keeps the API payload locally, pending', async () => {
    await signIn();
    open();
    await screen.findByTestId('voice-start');
    await press('voice-start');
    expect(screen.getByText('Slide down to the lowest note you can hold comfortably')).toBeTruthy();
    await press('voice-low-done');
    expect(screen.getByText('Now slide up to the highest note you can hold comfortably')).toBeTruthy();
    await press('voice-high-done');
    expect(screen.getByText('Sing something you know')).toBeTruthy();
    await press('voice-sing-skip');

    expect(text('voice-result-type')).toBe('Likely Baritone');
    expect(text('voice-result-range')).toBe(isolate('A2–A4'));
    expect(screen.getByTestId('voice-result-confidence')).toBeTruthy();
    expect(mockSource.current!.sections).toEqual(['low', 'high', 'sing']);

    await press('voice-save');
    expect(screen.getByTestId('voice-saved')).toBeTruthy();
    const { profile, pending } = useVoiceStore.getState();
    expect(pending).toBe(true);
    const body = toVoiceProfileIn(profile!);
    expect(Object.keys(body).sort()).toEqual(API_KEYS);
    expect(body).toMatchObject({ low_midi: 45, high_midi: 69, voice_type: 'baritone', method: 'mic' });
    expect(Number.isNaN(Date.parse(body.measured_at))).toBe(false);
  });

  it('Done is disabled until the step has a held note', async () => {
    mockSource.current!.start = async () => {};
    open();
    await screen.findByTestId('voice-start');
    await press('voice-start');
    expect(screen.getByText('Stay quiet for a second…')).toBeTruthy();
    expect(screen.getByTestId('voice-low-done')).toBeDisabled();
  });

  it('20 s without a held note: "We couldn\'t hear a held note", Try again or self-report', async () => {
    mockSource.current!.start = async () => {};
    open();
    await screen.findByTestId('voice-start');
    jest.useFakeTimers();
    await press('voice-start');
    act(() => void jest.advanceTimersByTime(20_100));
    expect(screen.getByText("We couldn't hear a held note")).toBeTruthy();
    expect(screen.getByTestId('voice-skip')).toBeTruthy();
    await press('voice-retry');
    expect(screen.getByTestId('voice-low-done')).toBeTruthy();
    act(() => void jest.advanceTimersByTime(20_100));
    await press('voice-skip');
    expect(screen.getByTestId('voice-self-save')).toBeTruthy();
  });

  it('blocked permission: Open Settings and the self-report way out', async () => {
    mockSource.current!.permission = 'blocked';
    const settings = jest.spyOn(Linking, 'openSettings').mockResolvedValue();
    open();
    await screen.findByTestId('voice-start');
    await press('voice-start');
    expect(screen.getByText('Microphone is off')).toBeTruthy();
    expect(screen.getByTestId('voice-skip')).toBeTruthy();
    await press('voice-open-settings');
    expect(settings).toHaveBeenCalled();
  });

  it('blocked permission: coming back from Settings with the mic allowed starts the test', async () => {
    const handlers: ((s: AppStateStatus) => void)[] = [];
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_t, h) => {
      handlers.push(h as (s: AppStateStatus) => void);
      return { remove: () => {} } as never;
    });
    mockSource.current!.permission = 'blocked';
    open();
    await screen.findByTestId('voice-start');
    await press('voice-start');
    expect(screen.getByTestId('voice-permission-blocked')).toBeTruthy();
    // Still off in Settings: back to the app, still blocked (and no loop).
    await act(async () => handlers.forEach((h) => h('active')));
    expect(screen.getByTestId('voice-permission-blocked')).toBeTruthy();
    mockSource.current!.permission = 'granted';
    await act(async () => handlers.forEach((h) => h('active')));
    expect(await screen.findByTestId('voice-low-done')).toBeTruthy();
    expect(mockSource.current!.sections).toEqual(['low']);
  });

  it('a busy mic (start() throws) shows its own copy with Try again and the self-report way out', async () => {
    const src = mockSource.current!;
    const realStart = src.start;
    let busy = true;
    src.start = async (onBuffer, section) => {
      if (busy) throw new Error('mic in use');
      return realStart(onBuffer, section);
    };
    open();
    await screen.findByTestId('voice-start');
    await press('voice-start');
    expect(screen.getByTestId('voice-mic-busy')).toBeTruthy();
    expect(screen.getByText('The microphone is busy')).toBeTruthy();
    expect(screen.queryByText('Microphone is off')).toBeNull();
    expect(screen.getByTestId('voice-skip')).toBeTruthy();
    busy = false;
    await press('voice-retry');
    expect(screen.getByTestId('voice-low-done')).toBeTruthy();
  });

  it('denied permission: Try again asks again', async () => {
    mockSource.current!.permission = 'denied';
    open();
    await screen.findByTestId('voice-start');
    await press('voice-start');
    expect(screen.getByText('Microphone is off')).toBeTruthy();
    mockSource.current!.permission = 'granted';
    await press('voice-retry');
    expect(screen.getByTestId('voice-low-done')).toBeTruthy();
  });

  it('self-report tenor saves method self, confidence low, voice_type tenor', async () => {
    await signIn();
    open();
    await screen.findByTestId('voice-skip');
    await press('voice-skip');
    expect(screen.getByTestId('voice-self-save')).toBeDisabled();
    await press('voice-self-tenor');
    await press('voice-self-save');
    expect(screen.getByTestId('voice-saved')).toBeTruthy();
    expect(text('voice-result-type')).toBe('Likely Tenor');
    const body = toVoiceProfileIn(useVoiceStore.getState().profile!);
    expect(body).toMatchObject({ method: 'self', confidence: 'low', voice_type: 'tenor', register: null });
    expect(Object.keys(body).sort()).toEqual(API_KEYS);
  });

  it('self-report "not sure": a register, worded as likely', async () => {
    await signIn();
    open();
    await screen.findByTestId('voice-skip');
    await press('voice-skip');
    await press('voice-self-higher');
    await press('voice-self-save');
    expect(text('voice-result-type')).toBe('Likely a higher voice');
    expect(useVoiceStore.getState().profile).toMatchObject({ register: 'higher', voiceType: null });
  });

  it('signed out, Save keeps the result locally and opens sign-in; back signed in, it is saved', async () => {
    const app = open();
    await screen.findByTestId('voice-start');
    await runToResult();
    await press('voice-save');
    await waitFor(() => expect(app.getPathname()).toBe('/sign-in'));
    expect(app.getSearchParams()).toEqual(expect.objectContaining({ returnTo: '/discover/voice' }));
    expect(useVoiceStore.getState()).toMatchObject({ pending: true, profile: expect.objectContaining({ voiceType: 'baritone' }) });

    await signIn();
    act(() => router.dismissTo('/discover/voice'));
    expect(await screen.findByTestId('voice-saved')).toBeTruthy();
    expect(text('voice-result-type')).toBe('Likely Baritone');
  });

  it('leaving the screen mid-test stops the mic and starts over', async () => {
    const app = open();
    await screen.findByTestId('voice-start');
    await press('voice-start');
    const stops = mockSource.current!.stops;
    act(() => router.push('/sign-in'));
    await waitFor(() => expect(app.getPathname()).toBe('/sign-in'));
    expect(mockSource.current!.stops).toBeGreaterThan(stops);
    act(() => router.back());
    expect(await screen.findByTestId('voice-start')).toBeTruthy();
  });

  it('going to the background mid-test cancels it; the result survives', async () => {
    const handlers: ((s: AppStateStatus) => void)[] = [];
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_t, h) => {
      handlers.push(h as (s: AppStateStatus) => void);
      return { remove: () => {} } as never;
    });
    open();
    await screen.findByTestId('voice-start');
    await press('voice-start');
    // "inactive" (the iOS permission prompt, Control Centre) is not leaving.
    act(() => handlers.forEach((h) => h('inactive')));
    expect(screen.getByTestId('voice-low-done')).toBeTruthy();
    act(() => handlers.forEach((h) => h('background')));
    expect(screen.getByTestId('voice-start')).toBeTruthy();

    await runToResult();
    act(() => handlers.forEach((h) => h('background')));
    expect(text('voice-result-type')).toBe('Likely Baritone');
  });

  it('a "background" during the permission request (the Android dialog) does not cancel the test', async () => {
    const handlers: ((s: AppStateStatus) => void)[] = [];
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_t, h) => {
      handlers.push(h as (s: AppStateStatus) => void);
      return { remove: () => {} } as never;
    });
    let allow: (p: MicPermission) => void = () => {};
    mockSource.current!.requestPermission = () => new Promise<MicPermission>((r) => (allow = r));
    open();
    await screen.findByTestId('voice-start');
    await press('voice-start');
    // Android pauses the activity for the permission dialog; RN reports that as "background".
    act(() => handlers.forEach((h) => h('background')));
    await act(async () => allow('granted'));
    expect(screen.getByTestId('voice-low-done')).toBeTruthy();
    expect(mockSource.current!.sections).toEqual(['low']);
  });

  it('sing shows a 15 s countdown and captions the keys already lit', async () => {
    open();
    await screen.findByTestId('voice-start');
    jest.useFakeTimers();
    await press('voice-start');
    await press('voice-low-done');
    await press('voice-high-done');
    expect(screen.getByText('Your low and high so far')).toBeTruthy();
    const progress = () => screen.getByTestId('voice-sing-progress');
    expect(progress().props.accessibilityValue).toMatchObject({ min: 0, max: 15, now: 0 });
    expect(screen.getByText('15 seconds left')).toBeTruthy();
    act(() => void jest.advanceTimersByTime(5000));
    expect(progress().props.accessibilityValue).toMatchObject({ now: 5 });
    expect(screen.getByText('10 seconds left')).toBeTruthy();
    act(() => void jest.advanceTimersByTime(9000));
    expect(screen.getByText('1 second left')).toBeTruthy();
  });

  it('Try again from the result starts a new measurement', async () => {
    open();
    await screen.findByTestId('voice-start');
    await runToResult();
    await press('voice-try-again');
    expect(screen.getByTestId('voice-low-done')).toBeTruthy();
    expect(mockSource.current!.sections).toEqual(['low', 'high', 'sing', 'low']);
  });
});

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
const Shell = ({ locale, children }: { locale: 'ar' | 'en'; children: ReactNode }) => (
  <SafeAreaProvider initialMetrics={METRICS}>
    <IntlProvider locale={locale}>{children}</IntlProvider>
  </SafeAreaProvider>
);

describe('VoiceResult', () => {
  it('RTL (ar): the range and comfort notes are bidi-isolated', () => {
    render(
      <Shell locale="ar">
        <VoiceResult profile={profileFromSelfReport('baritone', '')} saved={false} signedIn onSave={jest.fn()} onTryAgain={jest.fn()} onClose={jest.fn()} />
      </Shell>,
    );
    expect(text('voice-result-range')).toBe(isolate('A2–A4'));
    expect(screen.getByTestId('voice-result-comfort').props.children).toContain(isolate('D3–E4'));
  });

  it('between two types', () => {
    render(
      <Shell locale="en">
        <VoiceResult
          profile={{ ...profileFromSelfReport('tenor', ''), method: 'mic', voiceType: 'tenor', voiceTypeBetween: 'baritone', confidence: 'medium' }}
          saved={false}
          signedIn
          onSave={jest.fn()}
          onTryAgain={jest.fn()}
          onClose={jest.fn()}
        />
      </Shell>,
    );
    expect(text('voice-result-type')).toBe('Between Baritone and Tenor');
    // Hierarchy: the type first, then the range, the keyboard, comfort and confidence.
    const ids = screen
      .getByTestId('voice-result')
      .findAll((n) => typeof n.props.testID === 'string' && n.props.testID.startsWith('voice-result-'), { deep: true })
      .map((n) => n.props.testID as string)
      .filter((id, i, all) => all.indexOf(id) === i);
    expect(ids).toEqual(['voice-result-type', 'voice-result-range', 'voice-result-keys', 'voice-result-comfort', 'voice-result-confidence']);
    expect(screen.getByText('Medium confidence. Try again somewhere quiet for a sharper read.')).toBeTruthy();
  });
});
