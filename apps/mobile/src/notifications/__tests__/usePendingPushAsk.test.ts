// The in-context ask runs on the screen a flow lands on, once it has settled: iOS drops an Alert raised while a sheet
// or Modal is closing (review fix 1).
import { renderHook } from '@testing-library/react-native';
import { useFocusEffect } from 'expo-router';
import { InteractionManager } from 'react-native';

import { askPushPermissionInContext, requestPushAsk, takePendingPushAsk } from '../push';
import { PUSH_ASK_SETTLE_MS, usePendingPushAsk } from '../usePendingPushAsk';

jest.mock('expo-router', () => ({ ...jest.requireActual('expo-router'), useFocusEffect: jest.fn() }));
jest.mock('../push', () => ({ ...jest.requireActual('../push'), askPushPermissionInContext: jest.fn(async () => true) }));

const ask = askPushPermissionInContext as jest.Mock;
let focus: (() => (() => void) | void) | undefined;

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  takePendingPushAsk('make');
  takePendingPushAsk('night');
  (useFocusEffect as jest.Mock).mockImplementation((cb: () => (() => void) | void) => (focus = cb));
  jest.spyOn(InteractionManager, 'runAfterInteractions').mockImplementation(((fn: () => void) => {
    fn();
    return { cancel: jest.fn(), then: jest.fn(), done: jest.fn() };
  }) as never);
});
afterEach(() => jest.useRealTimers());

it('asks only after the landing screen has settled', () => {
  requestPushAsk('night');
  renderHook(() => usePendingPushAsk('night'));
  focus!();
  expect(ask).not.toHaveBeenCalled();
  jest.advanceTimersByTime(PUSH_ASK_SETTLE_MS);
  expect(ask).toHaveBeenCalledWith('night');
  // Once: a later focus doesn't ask again.
  focus!();
  jest.advanceTimersByTime(PUSH_ASK_SETTLE_MS);
  expect(ask).toHaveBeenCalledTimes(1);
});

it('nothing queued: nothing asked', () => {
  renderHook(() => usePendingPushAsk('make'));
  focus!();
  jest.advanceTimersByTime(PUSH_ASK_SETTLE_MS);
  expect(ask).not.toHaveBeenCalled();
});

it('leaving before it fired keeps the ask queued for the next focus', () => {
  requestPushAsk('make');
  renderHook(() => usePendingPushAsk('make'));
  const blur = focus!();
  blur?.();
  jest.advanceTimersByTime(PUSH_ASK_SETTLE_MS);
  expect(ask).not.toHaveBeenCalled();
  focus!();
  jest.advanceTimersByTime(PUSH_ASK_SETTLE_MS);
  expect(ask).toHaveBeenCalledWith('make');
});
