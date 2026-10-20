import { useContext, type ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

import { Text } from './Text';

export type SheetProps = {
  visible: boolean;
  onClose: () => void;
  /** Already translated by the caller. */
  title: string;
  testID: string;
  /** Accessibility label for the tap-to-close backdrop (already translated by the caller). */
  closeLabel: string;
  children: ReactNode;
  fullHeight?: boolean;
  /** iOS only (RN Modal): fires once the sheet has finished closing. Present a follow-up alert from here. */
  onDismiss?: () => void;
};

/** The panel's own bottom padding (Tailwind pb-6), before the safe-area inset is added. */
export const SHEET_BOTTOM_PADDING = 24;

/** A non-word glyph: the button's meaning comes from its accessibility label. */
const CLOSE_GLYPH = '\u2715';

/**
 * Bottom sheet on RN's Modal: slides up over the screen; tapping the dimmed backdrop or the header's close
 * button closes it. The close button matters once the keyboard is up: the backdrop is then a thin strip.
 */
export function Sheet({ visible, onClose, title, testID, closeLabel, children, fullHeight, onDismiss }: SheetProps) {
  // The modal draws under the Android gesture/nav bar and the iOS home indicator (navigationBarTranslucent):
  // pad the panel by the bottom inset so its last row clears them. Read from the context, not
  // useSafeAreaInsets(), so a Sheet outside a SafeAreaProvider (tests, previews) gets 0 instead of throwing.
  const bottomInset = useContext(SafeAreaInsetsContext)?.bottom ?? 0;
  return (
    <Modal visible={visible} animationType="slide" transparent statusBarTranslucent navigationBarTranslucent onRequestClose={onClose} onDismiss={onDismiss} testID={testID}>
      {/*
        An RN Modal is outside the app root's GestureHandlerRootView, so this gives RNGH a root inside it.
        It is not enough on iOS (RNGH gestures inside an RN Modal got no touches on iOS 26): sheet content
        uses Pressable or the responder system instead (e.g. the Tap To Sync pad).
      */}
      <GestureHandlerRootView testID={`${testID}-gesture-root`} style={{ flex: 1 }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        className="flex-1 justify-end"
      >
        <Pressable
          testID={`${testID}-backdrop`}
          accessibilityRole="button"
          accessibilityLabel={closeLabel}
          onPress={onClose}
          className="absolute inset-0 bg-black/60"
        />
        <View
          testID={`${testID}-panel`}
          className={`rounded-t-3xl border border-border bg-card px-4 pt-3 ${fullHeight ? 'h-[92%]' : 'max-h-[85%]'}`}
          style={{ paddingBottom: SHEET_BOTTOM_PADDING + bottomInset }}
        >
          <View className="mb-1 flex-row items-center gap-2">
            <Text className="flex-1 font-bold" accessibilityRole="header">
              {title}
            </Text>
            <Pressable
              testID={`${testID}-close`}
              accessibilityRole="button"
              accessibilityLabel={closeLabel}
              onPress={onClose}
              hitSlop={4}
              className="-me-2 h-11 w-11 items-center justify-center rounded-full"
            >
              <Text className="text-lg text-muted" importantForAccessibility="no" accessibilityElementsHidden>
                {CLOSE_GLYPH}
              </Text>
            </Pressable>
          </View>
          {children}
        </View>
      </KeyboardAvoidingView>
      </GestureHandlerRootView>
    </Modal>
  );
}
