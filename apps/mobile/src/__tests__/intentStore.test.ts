import { appStorage } from '../storage';
import { INTENT_TTL_MS, isFreshIntent, useMakeIntent, type MakeIntent } from '../make/intentStore';

const intent = (over: Partial<MakeIntent> = {}): MakeIntent => ({
  artist: 'Lionel Richie',
  title: 'Hello',
  decideSongId: 43362,
  createdAt: Date.now(),
  ...over,
});

// The store reads MMKV once at import: a fresh copy of the module simulates an app relaunch.
const relaunch = () => {
  let mod!: typeof import('../make/intentStore');
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require('../make/intentStore');
  });
  return mod.useMakeIntent;
};

beforeEach(() => useMakeIntent.getState().clear());

it('set / get / clear', () => {
  const i = intent();
  useMakeIntent.getState().set(i);
  expect(useMakeIntent.getState().intent).toEqual(i);
  expect(useMakeIntent.getState().get()).toEqual(i);
  useMakeIntent.getState().clear();
  expect(useMakeIntent.getState().get()).toBeNull();
});

it('survives an app kill (persisted to MMKV)', () => {
  const i = intent();
  useMakeIntent.getState().set(i);
  expect(relaunch().getState().get()).toEqual(i);
});

it('expires after 30 minutes, and an expired intent is cleared from storage', () => {
  useMakeIntent.getState().set(intent({ createdAt: Date.now() - INTENT_TTL_MS - 1000 }));
  expect(useMakeIntent.getState().get()).toBeNull();
  expect(useMakeIntent.getState().intent).toBeNull();
  expect(relaunch().getState().intent).toBeNull();
});

it('a 29-minute-old intent is still fresh', () => {
  const i = intent({ createdAt: Date.now() - 29 * 60 * 1000 });
  useMakeIntent.getState().set(i);
  expect(useMakeIntent.getState().get()).toEqual(i);
  expect(isFreshIntent(i)).toBe(true);
  expect(isFreshIntent(null)).toBe(false);
});

it('ignores a corrupt or foreign stored value on launch', () => {
  appStorage.set('make.intent.v1', '{nope');
  expect(relaunch().getState().intent).toBeNull();
  appStorage.set('make.intent.v1', JSON.stringify({ title: 3 }));
  expect(relaunch().getState().intent).toBeNull();
});

it('keeps an intent without a decide song id (free-text "make any song")', () => {
  const i = intent();
  delete i.decideSongId;
  useMakeIntent.getState().set(i);
  expect(relaunch().getState().get()).toEqual(i);
});
