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

/** Bottom sheet on RN's Modal: slides up over the screen; tapping the dimmed backdrop closes it. */
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
          className={`rounded-t-3xl border border-border bg-card px-4 pb-6 pt-4 ${fullHeight ? 'h-[92%]' : 'max-h-[85%]'}`}
        >
          <Text className="mb-3 font-bold" accessibilityRole="header">
            {title}
          </Text>
          {children}
        </View>
      </KeyboardAvoidingView>
      </GestureHandlerRootView>
    </Modal>
  );
}
