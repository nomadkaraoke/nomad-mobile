// Device check (h): expo-audio releases the mic stream in useAudioStream's own unmount cleanup, after which
// stream.stop() throws ERR_USING_RELEASED_SHARED_OBJECT (3c's release app closed on it). Our stop calls that can run
// after the release (the quiet second's timer, the setup screen's unmount cleanup, the song recorder) must not throw.
import { IntlProvider } from '@nomad/i18n';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import type { PitchSource } from '../../voice/pitchSource';
import { measureQuietSecond } from '../quietSecond';
import { EMPTY_DRAFT, SetupScreen } from '../screens/SetupScreen';
import { stopSourceQuietly } from '../stopSource';

const released = () => {
  const e = new Error('Cannot use shared object that was already released') as Error & { code: string };
  e.code = 'ERR_USING_RELEASED_SHARED_OBJECT';
  return e;
};

/** A mic source whose stream was released: start() never delivers, stop() throws like expo-audio's. */
const releasedSource = (): PitchSource & { stop: jest.Mock } => ({
  kind: 'mic',
  requestPermission: jest.fn(async () => 'granted' as const),
  checkPermission: jest.fn(async () => 'granted' as const),
  start: jest.fn(() => new Promise<void>(() => {})),
  stop: jest.fn(() => {
    throw released();
  }),
});

afterEach(() => jest.useRealTimers());

describe('stopping a released mic stream', () => {
  it('stopSourceQuietly swallows the released-stream error', () => {
    const source = releasedSource();
    expect(() => stopSourceQuietly(source)).not.toThrow();
    expect(source.stop).toHaveBeenCalledTimes(1);
  });

  it('the quiet second still resolves when its timeout stops a released stream', async () => {
    jest.useFakeTimers();
    const source = releasedSource();
    const floor = measureQuietSecond(source);
    act(() => jest.advanceTimersByTime(3000));
    await expect(floor).resolves.toEqual(expect.any(Number));
    expect(source.stop).toHaveBeenCalled();
  });

  it('closing the setup screen during the quiet second (stream already released) does not throw', async () => {
    jest.useFakeTimers();
    const source = releasedSource();
    render(
      <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
        <IntlProvider locale="en">
          <SetupScreen
            draft={{ ...EMPTY_DRAFT, posture: 'standing', warmth: 'warm', record: true, headphones: true }}
            onDraft={() => {}}
            source={source}
            floor={null}
            onFloor={() => {}}
            mic={null}
            onMic={() => {}}
            afterWarmup={false}
            busy={false}
            onBegin={() => {}}
            onWarmup={() => {}}
          />
        </IntlProvider>
      </SafeAreaProvider>,
    );
    await act(async () => void fireEvent.press(screen.getByTestId('vs-setup-go')));
    expect(screen.getByTestId('vs-setup-quiet')).toBeTruthy();
    expect(() => screen.unmount()).not.toThrow();
    expect(source.stop).toHaveBeenCalled();
    // The quiet second's own timeout fires after the screen has gone: it stops the released stream again.
    expect(() => act(() => jest.advanceTimersByTime(3000))).not.toThrow();
  });
});
