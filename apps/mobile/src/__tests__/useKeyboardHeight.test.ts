import { act, renderHook } from '@testing-library/react-native';
import { createElement, type ReactNode } from 'react';
import { Dimensions, Keyboard, Platform, type KeyboardEvent } from 'react-native';

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

const WINDOW = { width: 400, height: 800, scale: 2, fontScale: 1 };

beforeEach(() => {
  jest.spyOn(Dimensions, 'get').mockReturnValue(WINDOW);
  jest.spyOn(Keyboard, 'isVisible').mockReturnValue(false);
});

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
  expect(remove).toHaveBeenCalledTimes(3); // show, hide and change-frame
});

it('follows keyboardWillChangeFrame on iOS (taller with the suggestion bar, 0 once the frame is off screen)', () => {
  const { handlers } = captureListeners();
  const { result } = renderHook(() => useKeyboardHeight());
  act(() => handlers.keyboardWillShow!(shown(300)));
  act(() => handlers.keyboardWillChangeFrame!(shown(345)));
  expect(result.current).toBe(345);
  // A hardware keyboard docks it away: the frame keeps its height but sits below the window.
  act(() => handlers.keyboardWillChangeFrame!({ endCoordinates: { height: 345, screenX: 0, screenY: 800, width: 400 } } as KeyboardEvent));
  expect(result.current).toBe(0);
  // Only the accessory bar left on screen.
  act(() => handlers.keyboardWillChangeFrame!({ endCoordinates: { height: 345, screenX: 0, screenY: 755, width: 400 } } as KeyboardEvent));
  expect(result.current).toBe(45);
});

it('counts a keyboard that is already up when it mounts', () => {
  captureListeners();
  jest.spyOn(Keyboard, 'isVisible').mockReturnValue(true);
  jest.spyOn(Keyboard, 'metrics').mockReturnValue(shown(320).endCoordinates);
  const { result } = renderHook(() => useKeyboardHeight());
  expect(result.current).toBe(320);
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
    expect(handlers.keyboardWillChangeFrame).toBeUndefined();
  } finally {
    Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
  }
});
