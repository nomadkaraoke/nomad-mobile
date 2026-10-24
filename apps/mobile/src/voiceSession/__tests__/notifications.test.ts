// Voice session "Done singing?" local notification (Phase 3d D3), on 3b's expo-notifications. A tap is routed by 3b's
// useReminderTapRouting (data.url), not by a listener of our own.
import { renderHook } from '@testing-library/react-native';

type Listener = (r: unknown) => void;

const mockN = {
  requestPermissionsAsync: jest.fn(async () => ({ granted: true, status: 'granted', canAskAgain: true })),
  setNotificationChannelAsync: jest.fn(async () => null),
  scheduleNotificationAsync: jest.fn(async (_request: unknown) => 'back-id'),
  cancelScheduledNotificationAsync: jest.fn(async () => {}),
  getLastNotificationResponse: jest.fn((): unknown => null),
  clearLastNotificationResponse: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn((_l: Listener) => ({ remove: jest.fn() })),
  AndroidImportance: { DEFAULT: 3, HIGH: 4 },
  SchedulableTriggerInputTypes: { TIME_INTERVAL: 'timeInterval' },
};

jest.mock('expo-notifications', () => mockN);
const mockPush = jest.fn();
jest.mock('expo-router', () => ({ router: { push: mockPush } }));

// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the mocks are set up
const load = () => require('../player/notifications') as typeof import('../player/notifications');

const COPY = { title: 'Done singing?', body: 'Tap to rate it and get your next song', channelName: 'Voice session' };
const response = (url: unknown) => ({ notification: { request: { content: { data: { url } } } } });

beforeEach(() => {
  jest.clearAllMocks();
});

describe('ensureLocalPermission', () => {
  it('creates the voice-session Android channel BEFORE asking (Android 13 only prompts once a channel exists)', async () => {
    expect(await load().ensureLocalPermission(COPY.channelName)).toBe(true);
    expect(mockN.setNotificationChannelAsync).toHaveBeenCalledWith('voice-session', expect.objectContaining({ name: 'Voice session' }));
    expect(mockN.setNotificationChannelAsync.mock.invocationCallOrder[0]!).toBeLessThan(mockN.requestPermissionsAsync.mock.invocationCallOrder[0]!);
  });

  it('is false when the user declines', async () => {
    mockN.requestPermissionsAsync.mockResolvedValueOnce({ granted: false, status: 'denied', canAskAgain: false });
    expect(await load().ensureLocalPermission(COPY.channelName)).toBe(false);
  });

  it('is false when asking throws', async () => {
    mockN.requestPermissionsAsync.mockRejectedValueOnce(new Error('no native module'));
    expect(await load().ensureLocalPermission(COPY.channelName)).toBe(false);
  });
});

describe('scheduleBackNotification', () => {
  it('linkout schedules notification at duration+10 with the quiz route', async () => {
    expect(await load().scheduleBackNotification(200, COPY)).toBe('back-id');
    expect(mockN.scheduleNotificationAsync).toHaveBeenCalledWith({
      content: { title: 'Done singing?', body: 'Tap to rate it and get your next song', data: { url: '/discover/voice-session' } },
      trigger: { type: 'timeInterval', seconds: 210, channelId: 'voice-session' },
    });
  });

  it('rounds a fractional duration up', async () => {
    await load().scheduleBackNotification(199.2, COPY);
    expect(mockN.scheduleNotificationAsync.mock.calls[0]![0]).toMatchObject({ trigger: { seconds: 210 } });
  });

  it.each([null, 0, -5, Number.NaN])('defaults to 240 s without a usable duration (%p)', async (d) => {
    await load().scheduleBackNotification(d, COPY);
    expect(mockN.scheduleNotificationAsync.mock.calls[0]![0]).toMatchObject({ trigger: { seconds: 240 } });
  });

  it('is null (and never throws) when scheduling fails', async () => {
    mockN.scheduleNotificationAsync.mockRejectedValueOnce(new Error('not allowed'));
    expect(await load().scheduleBackNotification(100, COPY)).toBeNull();
  });
});

describe('cancelBackNotification', () => {
  it('cancels by id, and ignores a null id or an already-fired one', async () => {
    const m = load();
    await m.cancelBackNotification('back-id');
    expect(mockN.cancelScheduledNotificationAsync).toHaveBeenCalledWith('back-id');
    await m.cancelBackNotification(null);
    expect(mockN.cancelScheduledNotificationAsync).toHaveBeenCalledTimes(1);
    mockN.cancelScheduledNotificationAsync.mockRejectedValueOnce(new Error('gone'));
    await expect(m.cancelBackNotification('old')).resolves.toBeUndefined();
  });
});

describe("3b's useReminderTapRouting", () => {
  it('opens the voice session from a tapped "Done singing?" notification (the single tap router)', () => {
    let listener: Listener = () => {};
    mockN.addNotificationResponseReceivedListener.mockImplementationOnce((l) => ((listener = l), { remove: jest.fn() }));
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the mocks are set up
    const { useReminderTapRouting } = require('../../discover/connect/reminders') as typeof import('../../discover/connect/reminders');
    renderHook(() => useReminderTapRouting());
    listener(response(load().VOICE_SESSION_URL));
    expect(mockPush).toHaveBeenCalledWith('/discover/voice-session');
  });
});
