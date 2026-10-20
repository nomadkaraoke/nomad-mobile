import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

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

/** A non-word glyph: the button's meaning comes from its accessibility label. */
const CLOSE_GLYPH = '\u2715';

/**
 * Bottom sheet on RN's Modal: slides up over the screen; tapping the dimmed backdrop or the header's close
 * button closes it. The close button matters once the keyboard is up: the backdrop is then a thin strip.
 */
export function Sheet({ visible, onClose, title, testID, closeLabel, children, fullHeight, onDismiss }: SheetProps) {
  return (
    <Modal visible={visible} animationType="slide" transparent statusBarTranslucent navigationBarTranslucent onRequestClose={onClose} onDismiss={onDismiss} testID={testID}>
      {/* An RN Modal is outside the app root's GestureHandlerRootView: gestures inside need their own. */}
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
          className={`rounded-t-3xl border border-border bg-card px-4 pb-6 pt-3 ${fullHeight ? 'h-[92%]' : 'max-h-[85%]'}`}
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
