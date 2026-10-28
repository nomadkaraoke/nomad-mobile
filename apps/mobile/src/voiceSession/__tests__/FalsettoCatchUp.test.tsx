// The quiz's falsetto catch-up (Phase 3d batch 1, M8): rows, replay of the local take's moment, answers.
import { IntlProvider } from '@nomad/i18n';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { fsState } from '../../test-utils/memoryFs';
import { FalsettoCatchUp, REPLAY_PAD_S } from '../screens/FalsettoCatchUp';

// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories can't use imports
jest.mock('expo-file-system', () => require('../../test-utils/memoryFs'));
const mockPlay = jest.fn(async () => {});
const mockStop = jest.fn();
const mockState = { current: { key: null as string | null, status: 'idle' as string } };
jest.mock('../recording/useRecordingPlayback', () => ({
  useRecordingPlayback: () => ({ state: mockState.current, play: mockPlay, stop: mockStop }),
}));

const TAKE = { uri: 'file:///document/voice-recordings/t.m4a', durationS: 190, contentType: 'audio/mp4' as const };
const A4 = { tStart: 151.2, tEnd: 152.7, midi: 69 };
const G4 = { tStart: 40, tEnd: 41, midi: 67 };

const renderIt = (props: Partial<Parameters<typeof FalsettoCatchUp>[0]> = {}) => {
  const onAnswer = jest.fn();
  render(
    <IntlProvider locale="en">
      <FalsettoCatchUp candidates={[A4, G4]} labels={[]} take={TAKE} takeOffsetS={1.2} onAnswer={onAnswer} {...props} />
    </IntlProvider>,
  );
  return onAnswer;
};

beforeEach(() => {
  jest.clearAllMocks();
  fsState.reset();
  fsState.files.set(TAKE.uri, new Uint8Array(10));
  mockState.current = { key: null, status: 'idle' };
});

describe('FalsettoCatchUp', () => {
  it('catch-up lists the notes with their time, in the order given', () => {
    renderIt();
    expect(screen.getByTestId('vs-falsetto-catchup')).toBeTruthy();
    expect(screen.getByText(/A4.* at .*2:31/)).toBeTruthy();
    expect(screen.getByText(/G4.* at .*0:40/)).toBeTruthy();
    expect(screen.getByTestId('vs-falsetto-q-0-note').props.children).toMatch(/A4/);
    expect(screen.queryByTestId('vs-falsetto-q-2')).toBeNull();
  });

  it('replay plays local take segment with offset', () => {
    renderIt();
    fireEvent.press(screen.getByTestId('vs-falsetto-q-0-play'));
    expect(mockPlay).toHaveBeenCalledWith(TAKE.uri, {
      key: 'vs-falsetto-q-0',
      localUri: TAKE.uri,
      fromS: 151.2 - 1.2 - REPLAY_PAD_S,
      toS: 152.7 - 1.2 + REPLAY_PAD_S,
    });
  });

  it('a playing row offers Stop', () => {
    mockState.current = { key: 'vs-falsetto-q-1', status: 'playing' };
    renderIt();
    fireEvent.press(screen.getByTestId('vs-falsetto-q-1-play'));
    expect(mockStop).toHaveBeenCalled();
    expect(mockPlay).not.toHaveBeenCalled();
  });

  it('no ▶ without take, or when the file is gone', () => {
    renderIt({ take: null });
    expect(screen.queryByTestId('vs-falsetto-q-0-play')).toBeNull();
    screen.unmount();
    fsState.reset();
    renderIt();
    expect(screen.queryByTestId('vs-falsetto-q-0-play')).toBeNull();
    expect(screen.getByTestId('vs-falsetto-q-0-yes')).toBeTruthy();
  });

  it('Yes / No / Not sure answer falsetto / full / unsure; a given answer shows as selected', () => {
    const onAnswer = renderIt({ labels: [{ ...G4, label: 'unsure', source: 'quiz' }] });
    fireEvent.press(screen.getByTestId('vs-falsetto-q-0-yes'));
    fireEvent.press(screen.getByTestId('vs-falsetto-q-0-no'));
    fireEvent.press(screen.getByTestId('vs-falsetto-q-1-unsure'));
    expect(onAnswer.mock.calls).toEqual([
      [A4, 'falsetto'],
      [A4, 'full'],
      [G4, 'unsure'],
    ]);
    expect(screen.getByTestId('vs-falsetto-q-1-unsure').props.accessibilityState).toEqual(expect.objectContaining({ selected: true }));
  });
});
