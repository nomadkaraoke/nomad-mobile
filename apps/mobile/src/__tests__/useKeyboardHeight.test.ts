import { act, renderHook } from '@testing-library/react-native';
import { createElement, type ReactNode } from 'react';
import { Keyboard, Platform, type KeyboardEvent } from 'react-native';

import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

import { useKeyboardHeight } from '../ui/useKeyboardHeight';

type Handler = (e: KeyboardEvent) => void;

function captureListeners() {
  const handlers: Record<string, Handler> = {};
  const remove = jest.fn();
  jest.spyOn(Keyboard, 'addListener').mockImplementation(((name: string, fn: Handler) => {
    handlers[name] = fn;
    return { remove } as never;
  }) as never);
  return { handlers, remove };
}

const shown = (height: number) => ({ endCoordinates: { height, screenX: 0, screenY: 800 - height, width: 400 } }) as KeyboardEvent;

afterEach(() => jest.restoreAllMocks());

it('is the keyboard height while it is up and 0 once it hides (iOS: the will-events, no inset added)', () => {
  const { handlers, remove } = captureListeners();
  const { result, unmount } = renderHook(() => useKeyboardHeight());
  expect(result.current).toBe(0);
  act(() => handlers.keyboardWillShow!(shown(335)));
  expect(result.current).toBe(335);
  act(() => handlers.keyboardWillHide!(shown(0)));
  expect(result.current).toBe(0);
  unmount();
  expect(remove).toHaveBeenCalledTimes(2);
});

it('listens to the did-events on Android and adds the navigation bar under the keyboard', () => {
  const os = Platform.OS;
  Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
  try {
    const { handlers } = captureListeners();
    const insets = { top: 0, right: 0, bottom: 24, left: 0 };
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(SafeAreaInsetsContext.Provider, { value: insets }, children);
    const { result } = renderHook(() => useKeyboardHeight(), { wrapper });
    act(() => handlers.keyboardDidShow!(shown(300)));
    expect(result.current).toBe(324);
    act(() => handlers.keyboardDidHide!(shown(0)));
    expect(result.current).toBe(0);
  } finally {
    Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
  }
});
