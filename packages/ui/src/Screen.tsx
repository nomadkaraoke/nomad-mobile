import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors } from './tokens';

export type ScreenProps = {
  children: ReactNode;
  testID: string;
  scroll?: boolean;
  /**
   * The screen sits under a native stack header, which already clears the status bar: no top safe-area inset
   * (otherwise the content starts a status bar's height below the header).
   */
  underHeader?: boolean;
};

export function Screen({ children, testID, scroll, underHeader }: ScreenProps) {
  return (
    <SafeAreaView
      testID={testID}
      style={{ flex: 1, backgroundColor: colors.bg }}
      edges={underHeader ? ['left', 'right'] : ['top', 'left', 'right']}
    >
      {scroll ? (
        <ScrollView contentContainerClassName="gap-4 p-4" keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      ) : (
        <View className="flex-1 gap-4 p-4">{children}</View>
      )}
    </SafeAreaView>
  );
}
