import { colors } from '@nomad/ui';
import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** A voice-test screen: scrolling content over a sticky footer of buttons (the quiz modal's layout). */
export function StepLayout({ testID, children, footer }: { testID: string; children: ReactNode; footer: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View testID={testID} style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerClassName="gap-5 p-4">{children}</ScrollView>
      <View className="gap-2 border-t border-border bg-bg px-4 pt-3" style={{ paddingBottom: Math.max(insets.bottom, 12) }}>
        {footer}
      </View>
    </View>
  );
}
