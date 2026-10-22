import { useContext, useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

/**
 * How much of the bottom of the screen the keyboard covers (0 while it is down). For a screen whose bottom is the
 * screen's bottom (a tab, a page-sheet modal), padding by this keeps a sticky footer just above the keyboard.
 *
 * Why not KeyboardAvoidingView with a measured offset: under an iOS 26 page-sheet modal, measureInWindow reported
 * the quiz footer 46 pt higher than it was drawn, so KAV left Finish half under the keyboard (simulator, Phase 3a
 * E12). On Android (edge-to-edge) the window no longer resizes for the keyboard at all, and React Native reports
 * the keyboard's height without the navigation bar under it, so the bottom inset is added back there (Finish sat
 * one nav bar too low on the emulator).
 */
export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);
  // The context, not useSafeAreaInsets(): outside a SafeAreaProvider (tests) this is 0 instead of a throw.
  const insets = useContext(SafeAreaInsetsContext);
  const navBar = Platform.OS === 'android' ? (insets?.bottom ?? 0) : 0;
  useEffect(() => {
    // iOS announces the keyboard before it animates in; Android only after.
    const show = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hide = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const subs = [
      Keyboard.addListener(show, (e) => setHeight(Math.max(0, e.endCoordinates.height))),
      Keyboard.addListener(hide, () => setHeight(0)),
    ];
    return () => subs.forEach((s) => s?.remove());
  }, []);
  return height > 0 ? height + navBar : 0;
}
