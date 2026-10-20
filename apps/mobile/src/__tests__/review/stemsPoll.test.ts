import { act, renderHook } from '@testing-library/react-native';

import { useEncoderWarmup } from '../../review/useEncoderWarmup';
import { useStemsPoll } from '../../review/useStemsPoll';

const mockUrls = jest.fn();
const mockWarm = jest.fn();
const mockBeat = jest.fn();
jest.mock('@nomad/api-gen', () => ({
  getInstrumentalUrls: (...a: unknown[]) => mockUrls(...a),
  warmupEncoder: (...a: unknown[]) => mockWarm(...a),
  encoderHeartbeat: (...a: unknown[]) => mockBeat(...a),
}));

const opt = (id: string, url?: string) => ({ id, label: id, audio_url: url });
const PENDING = { options: [opt('clean')], audioComplete: false };
const READY = {
  options: [opt('clean', 'u1'), opt('with_backing', 'u2')],
  audioComplete: true,
  backingAnalysis: { x: 1 },
  autoApproval: { y: 1 },
};
const tick = async (ms: number) => {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
};

beforeEach(() => {
  jest.useFakeTimers();
  mockUrls.mockReset();
  mockWarm.mockReset();
  mockBeat.mockReset();
});
afterEach(() => jest.useRealTimers());

describe('useStemsPoll', () => {
  it('does not poll when already ready', async () => {
    const { result } = renderHook(() => useStemsPoll('j', { options: READY.options as never, audioComplete: true }));
    expect(result.current.ready).toBe(true);
    await tick(60_000);
    expect(mockUrls).not.toHaveBeenCalled();
  });

  it('polls every 15 s and stops once ready', async () => {
    mockUrls.mockResolvedValueOnce(PENDING).mockResolvedValue(READY);
    const { result } = renderHook(() => useStemsPoll('j', { options: [], audioComplete: false }));
    expect(result.current.ready).toBe(false);
    await tick(14_999);
    expect(mockUrls).not.toHaveBeenCalled();
    await tick(1);
    expect(mockUrls).toHaveBeenCalledTimes(1);
    expect(result.current.ready).toBe(false);
    await tick(15_000);
    expect(mockUrls).toHaveBeenCalledTimes(2);
    expect(result.current).toMatchObject({ ready: true, audioComplete: true, analysis: { x: 1 }, autoApproval: { y: 1 } });
    await tick(120_000);
    expect(mockUrls).toHaveBeenCalledTimes(2);
  });

  it('keeps polling through errors and gives up after 10 min', async () => {
    mockUrls.mockRejectedValue(new Error('net'));
    const { result } = renderHook(() => useStemsPoll('j', { options: [], audioComplete: false }));
    await tick(10 * 60_000);
    expect(mockUrls).toHaveBeenCalledTimes(40);
    await tick(5 * 60_000);
    expect(mockUrls).toHaveBeenCalledTimes(40);
    expect(result.current.ready).toBe(false);
  });

  it('stops on unmount', async () => {
    mockUrls.mockResolvedValue(PENDING);
    const { unmount } = renderHook(() => useStemsPoll('j', { options: [], audioComplete: false }));
    await tick(15_000);
    unmount();
    await tick(60_000);
    expect(mockUrls).toHaveBeenCalledTimes(1);
  });
});

describe('useEncoderWarmup', () => {
  it('warms up on mount, beats every 60 s and clears on unmount', async () => {
    const { unmount } = renderHook(() => useEncoderWarmup('j'));
    expect(mockWarm).toHaveBeenCalledWith('j');
    await tick(120_000);
    expect(mockBeat).toHaveBeenCalledTimes(2);
    unmount();
    await tick(300_000);
    expect(mockBeat).toHaveBeenCalledTimes(2);
  });
});
