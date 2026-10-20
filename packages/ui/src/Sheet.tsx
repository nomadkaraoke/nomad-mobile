import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, View } from 'react-native';

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
};

/** Bottom sheet on RN's Modal: slides up over the screen; tapping the dimmed backdrop closes it. */
export function Sheet({ visible, onClose, title, testID, closeLabel, children, fullHeight }: SheetProps) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose} testID={testID}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
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
    </Modal>
  );
}
