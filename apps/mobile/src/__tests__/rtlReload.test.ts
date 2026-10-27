import { I18nManager } from 'react-native';

const mockUpdates = { isEnabled: true, reloadAsync: jest.fn(async () => {}) };
jest.mock('expo-updates', () => ({
  get isEnabled() {
    return mockUpdates.isEnabled;
  },
  reloadAsync: () => mockUpdates.reloadAsync(),
}));

// eslint-disable-next-line import/first
import { syncLayoutDirection } from '../locale';

let nativeRTL = false;
beforeAll(() => {
  Object.defineProperty(I18nManager, 'isRTL', { configurable: true, get: () => nativeRTL });
});
beforeEach(() => {
  (jest.requireMock('react-native-mmkv') as { __resetMMKV(): void }).__resetMMKV();
  nativeRTL = false;
  mockUpdates.isEnabled = true;
  mockUpdates.reloadAsync.mockClear();
  jest.spyOn(I18nManager, 'allowRTL').mockImplementation(() => {});
  jest.spyOn(I18nManager, 'forceRTL').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

it('RTL change reloads when updates enabled', () => {
  syncLayoutDirection('he');
  expect(I18nManager.allowRTL).toHaveBeenCalledWith(true);
  expect(I18nManager.forceRTL).toHaveBeenCalledWith(true);
  expect(mockUpdates.reloadAsync).toHaveBeenCalledTimes(1);
});

it('back to LTR reloads too', () => {
  nativeRTL = true;
  syncLayoutDirection('en');
  expect(I18nManager.forceRTL).toHaveBeenCalledWith(false);
  expect(mockUpdates.reloadAsync).toHaveBeenCalledTimes(1);
});

it('applies on the next launch (no reload) when updates are disabled', () => {
  mockUpdates.isEnabled = false;
  syncLayoutDirection('ar');
  expect(I18nManager.forceRTL).toHaveBeenCalledWith(true);
  expect(mockUpdates.reloadAsync).not.toHaveBeenCalled();
});

it('does nothing when the direction already matches', () => {
  syncLayoutDirection('en');
  nativeRTL = true;
  syncLayoutDirection('he');
  expect(I18nManager.forceRTL).not.toHaveBeenCalled();
  expect(mockUpdates.reloadAsync).not.toHaveBeenCalled();
});

it('reloads at most once per direction if the change does not stick (no reload loop)', () => {
  syncLayoutDirection('he'); // reloads; after the reload the native flag is still LTR
  syncLayoutDirection('he');
  expect(mockUpdates.reloadAsync).toHaveBeenCalledTimes(1);
  // once the direction matches, a later change reloads again
  nativeRTL = true;
  syncLayoutDirection('he');
  nativeRTL = false;
  syncLayoutDirection('he');
  expect(mockUpdates.reloadAsync).toHaveBeenCalledTimes(2);
});

it('swallows a rejected reload (the change still applies on the next launch)', async () => {
  mockUpdates.reloadAsync.mockRejectedValueOnce(new Error('ERR_UPDATES_DISABLED'));
  expect(() => syncLayoutDirection('he')).not.toThrow();
  await Promise.resolve();
  expect(I18nManager.forceRTL).toHaveBeenCalledWith(true);
});
