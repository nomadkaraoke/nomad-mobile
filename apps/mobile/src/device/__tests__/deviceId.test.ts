import { randomUUID } from 'expo-crypto';

import { appStorage } from '../../storage';

jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }));

const uuidMock = randomUUID as jest.Mock;
const KEY = 'device.id.v1';
const A = '0b7c6f5e-3d1a-4c2b-9e8f-7a6b5c4d3e2f';
const B = '1c8d7a6f-4e2b-4d3c-8f9a-8b7c6d5e4f3a';

// The module caches the id: a fresh copy simulates an app relaunch.
const relaunch = () => {
  let mod!: typeof import('../deviceId');
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require('../deviceId');
  });
  return mod.getDeviceId;
};

beforeEach(() => {
  appStorage.remove(KEY);
  uuidMock.mockReset();
});

it('creates a random UUID once and keeps it across relaunches (MMKV)', () => {
  uuidMock.mockReturnValueOnce(A).mockReturnValueOnce(B);
  const getDeviceId = relaunch();
  expect(getDeviceId()).toBe(A);
  expect(getDeviceId()).toBe(A);
  expect(relaunch()()).toBe(A);
  expect(uuidMock).toHaveBeenCalledTimes(1);
  expect(appStorage.getString(KEY)).toBe(A);
});

it('replaces a stored value that is not a UUID', () => {
  appStorage.set(KEY, 'mgk1x2-abc');
  uuidMock.mockReturnValueOnce(B);
  expect(relaunch()()).toBe(B);
  expect(appStorage.getString(KEY)).toBe(B);
});

it('a reinstall (MMKV wiped) gets a new id', () => {
  uuidMock.mockReturnValueOnce(A).mockReturnValueOnce(B);
  expect(relaunch()()).toBe(A);
  appStorage.clearAll();
  expect(relaunch()()).toBe(B);
});
