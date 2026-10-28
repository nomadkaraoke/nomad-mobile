// The live falsetto chip (Phase 3d batch 1, M7): copy, answers, a polite live region, and PlayScreen's placement.
import type { NextSongOut, SessionSetup } from '@nomad/api-decide';
import { IntlProvider } from '@nomad/i18n';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, Platform } from 'react-native';
import { createRef } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { FalsettoChip } from '../FalsettoChip';
import type { PlayerHandle } from '../player/KaraokePlayer';
import { PlayScreen } from '../screens/PlayScreen';

jest.mock('../../config', () => ({ ...jest.requireActual('../../config'), FAKE_YT: true, FAKE_YT_SECONDS: 60 }));

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
const C = { tStart: 20, tEnd: 21.5, midi: 69 };

describe('FalsettoChip', () => {
  it('asks about the note by name; Yes is falsetto, No is full voice', () => {
    const onAnswer = jest.fn();
    render(
      <IntlProvider locale="en">
        <FalsettoChip candidate={C} onAnswer={onAnswer} />
      </IntlProvider>,
    );
    expect(screen.getByText(/High note \(.*A4.*\): falsetto\?/)).toBeTruthy();
    const chip = screen.getByTestId('vs-falsetto-chip');
    expect(chip.props.accessibilityLiveRegion).toBe('polite');
    expect(chip.props.accessibilityLabel).toMatch(/A4/);
    fireEvent.press(screen.getByTestId('vs-falsetto-yes'));
    fireEvent.press(screen.getByTestId('vs-falsetto-no'));
    expect(onAnswer.mock.calls).toEqual([['falsetto'], ['full']]);
  });
});

describe('FalsettoChip announcements', () => {
  const renderChip = () =>
    render(
      <IntlProvider locale="en">
        <FalsettoChip candidate={C} onAnswer={jest.fn()} />
      </IntlProvider>,
    );
  let os: { restore(): void } | null = null;
  afterEach(() => {
    os?.restore();
    os = null;
    jest.restoreAllMocks();
  });

  it('iOS: VoiceOver gets a queued announcement on mount (no live regions there)', () => {
    os = jest.replaceProperty(Platform, 'OS', 'ios');
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions').mockImplementation(() => {});
    announce.mockClear(); // jest-expo's AccessibilityInfo methods are already mocks: spyOn returns that same mock
    renderChip();
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith(expect.stringMatching(/A4.*Was it\?$/), { queue: true });
  });

  it('Android: the polite live region speaks it, no extra announcement', () => {
    os = jest.replaceProperty(Platform, 'OS', 'android');
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions').mockImplementation(() => {});
    announce.mockClear(); // jest-expo's AccessibilityInfo methods are already mocks: spyOn returns that same mock
    renderChip();
    expect(announce).not.toHaveBeenCalled();
  });
});

describe('PlayScreen with a falsetto chip', () => {
  const SONG = {
    song_key: 'a|b',
    artist: 'Alpha Band',
    title: 'Invented Tune',
    duration_s: 200,
    reason_type: 'upper_range',
    version: { video_id: 'vid-1', brand_code: 'NK', brand_name: 'Nomad', embeddable: true },
    alternatives: [],
    attempt_n: 1,
    max_attempts: 12,
  } as unknown as NextSongOut;
  const SETUP: SessionSetup = { posture: 'standing', warmth: 'warm', record: false, headphones: true };
  const renderPlay = (chip: typeof C | null, onFalsetto = jest.fn()) =>
    render(
      <SafeAreaProvider initialMetrics={METRICS}>
      <IntlProvider locale="en">
        <PlayScreen
          song={SONG}
          setup={SETUP}
          playerMode="embed-hosted"
          playerRef={createRef<PlayerHandle>()}
          onPlayer={jest.fn()}
          livePitch={null}
          micGranted
          onStopEarly={jest.fn()}
          onPatch={jest.fn()}
          falsettoChip={chip}
          onFalsetto={onFalsetto}
        />
      </IntlProvider>
      </SafeAreaProvider>,
    );

  it('shows the chip with Stop early still there, and passes the answer with its note', () => {
    const onFalsetto = jest.fn();
    renderPlay(C, onFalsetto);
    expect(screen.getByTestId('vs-falsetto-chip')).toBeTruthy();
    expect(screen.getByTestId('vs-stop-early')).toBeTruthy();
    fireEvent.press(screen.getByTestId('vs-falsetto-yes'));
    expect(onFalsetto).toHaveBeenCalledWith(C, 'falsetto');
  });

  it('no chip, nothing shown', () => {
    renderPlay(null);
    expect(screen.queryByTestId('vs-falsetto-chip')).toBeNull();
  });
});
