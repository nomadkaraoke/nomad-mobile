import { renderHook } from '@testing-library/react-native';
import * as audio from 'expo-audio';
import { useMicPitchSource } from '../useMicPitchSource';

jest.mock('expo-audio', () => {
  const stream = { start: jest.fn(async () => {}), stop: jest.fn() };
  return {
    setAudioModeAsync: jest.fn(async () => {}),
    requestRecordingPermissionsAsync: jest.fn(),
    useAudioStream: jest.fn(() => ({ stream, isStreaming: false })),
    __stream: stream,
  };
});

const mocked = audio as unknown as {
  setAudioModeAsync: jest.Mock;
  requestRecordingPermissionsAsync: jest.Mock;
  useAudioStream: jest.Mock;
  __stream: { start: jest.Mock; stop: jest.Mock };
};

beforeEach(() => jest.clearAllMocks());

const perm = (granted: boolean, canAskAgain: boolean) => ({ granted, canAskAgain, status: granted ? 'granted' : 'denied' });

it('asks for a mono float32 48 kHz stream', () => {
  renderHook(() => useMicPitchSource());
  expect(mocked.useAudioStream).toHaveBeenCalledWith(
    expect.objectContaining({ sampleRate: 48000, channels: 1, encoding: 'float32' }),
  );
});

it('maps permission results to granted / denied / blocked', async () => {
  const { result } = renderHook(() => useMicPitchSource());
  expect(result.current.kind).toBe('mic');
  mocked.requestRecordingPermissionsAsync.mockResolvedValueOnce(perm(true, true));
  await expect(result.current.requestPermission()).resolves.toBe('granted');
  mocked.requestRecordingPermissionsAsync.mockResolvedValueOnce(perm(false, true));
  await expect(result.current.requestPermission()).resolves.toBe('denied');
  mocked.requestRecordingPermissionsAsync.mockResolvedValueOnce(perm(false, false));
  await expect(result.current.requestPermission()).resolves.toBe('blocked');
});

it('start enables recording mode before starting the stream; stop stops it and turns recording mode off', async () => {
  const order: string[] = [];
  mocked.setAudioModeAsync.mockImplementation(async (m: { allowsRecording: boolean }) => void order.push(`mode:${m.allowsRecording}`));
  mocked.__stream.start.mockImplementation(async () => void order.push('start'));
  mocked.__stream.stop.mockImplementation(() => void order.push('stop'));
  const { result } = renderHook(() => useMicPitchSource());
  await result.current.start(() => {}, 'low');
  expect(mocked.setAudioModeAsync).toHaveBeenCalledWith({ allowsRecording: true, playsInSilentMode: true });
  result.current.stop();
  expect(order).toEqual(['mode:true', 'start', 'stop', 'mode:false']);
  expect(mocked.setAudioModeAsync).toHaveBeenLastCalledWith({ allowsRecording: false });
});

it('forwards float32 buffers as PcmBuffer and takes channel 0 of interleaved stereo', async () => {
  const { result } = renderHook(() => useMicPitchSource());
  const got: { samples: Float32Array; sampleRate: number; timestamp: number }[] = [];
  await result.current.start((b) => got.push(b), 'sing');
  const { onBuffer } = mocked.useAudioStream.mock.calls.at(-1)![0] as { onBuffer: (b: unknown) => void };
  onBuffer({ data: Float32Array.of(0.1, 9, 0.2, 9, 0.3, 9).buffer, sampleRate: 44100, channels: 2, timestamp: 1.5 });
  expect(got).toHaveLength(1);
  expect(got[0]!.sampleRate).toBe(44100);
  expect(got[0]!.timestamp).toBe(1.5);
  expect(Array.from(got[0]!.samples).map((v) => Math.round(v * 10) / 10)).toEqual([0.1, 0.2, 0.3]);
});

it('unmount does not throw when expo-audio already released the stream', () => {
  mocked.__stream.stop.mockImplementationOnce(() => {
    throw Object.assign(new Error('Cannot use shared object that was already released'), {
      code: 'ERR_USING_RELEASED_SHARED_OBJECT',
    });
  });
  const { unmount } = renderHook(() => useMicPitchSource());
  expect(() => unmount()).not.toThrow();
  expect(mocked.setAudioModeAsync).toHaveBeenLastCalledWith({ allowsRecording: false });
});

it('drops buffers after stop', async () => {
  const { result } = renderHook(() => useMicPitchSource());
  const got: unknown[] = [];
  await result.current.start((b) => got.push(b), 'low');
  result.current.stop();
  const { onBuffer } = mocked.useAudioStream.mock.calls.at(-1)![0] as { onBuffer: (b: unknown) => void };
  onBuffer({ data: Float32Array.of(0.1).buffer, sampleRate: 48000, channels: 1, timestamp: 0 });
  expect(got).toHaveLength(0);
});

describe('stop() during an in-flight start()', () => {
  it('undoes recording mode and the stream when stop lands while setAudioModeAsync is pending', async () => {
    let release!: () => void;
    mocked.setAudioModeAsync.mockImplementationOnce(() => new Promise<void>((r) => (release = r)));
    const { result } = renderHook(() => useMicPitchSource());
    const started = result.current.start(() => {}, 'low');
    result.current.stop();
    release();
    await started;
    expect(mocked.__stream.start).not.toHaveBeenCalled();
    expect(mocked.setAudioModeAsync).toHaveBeenLastCalledWith({ allowsRecording: false });
  });

  it('stops the stream when stop lands while stream.start is pending', async () => {
    let release!: () => void;
    mocked.__stream.start.mockImplementationOnce(() => new Promise<void>((r) => (release = r)));
    const { result } = renderHook(() => useMicPitchSource());
    const started = result.current.start(() => {}, 'low');
    await Promise.resolve();
    await Promise.resolve();
    result.current.stop();
    mocked.__stream.stop.mockClear();
    release();
    await started;
    expect(mocked.__stream.stop).toHaveBeenCalledTimes(1);
    expect(mocked.setAudioModeAsync).toHaveBeenLastCalledWith({ allowsRecording: false });
  });
});

it('stops the stream on unmount', () => {
  const { unmount } = renderHook(() => useMicPitchSource());
  mocked.__stream.stop.mockClear();
  unmount();
  expect(mocked.__stream.stop).toHaveBeenCalled();
});
