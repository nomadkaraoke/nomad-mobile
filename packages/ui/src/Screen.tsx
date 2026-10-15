import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export type ScreenProps = { children: ReactNode; testID: string; scroll?: boolean };

export function Screen({ children, testID, scroll }: ScreenProps) {
  return (
    <SafeAreaView testID={testID} className="flex-1 bg-bg" edges={['top', 'left', 'right']}>
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
