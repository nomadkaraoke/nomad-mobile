import { Text } from '@nomad/ui';
import type { ReactNode } from 'react';
import { View } from 'react-native';

/** One titled card on the music profile screen; `empty` shows instead of the rows when there are none. */
export function ProfileSection({
  testID,
  title,
  empty,
  isEmpty,
  action,
  children,
}: {
  testID: string;
  title: string;
  empty: string;
  isEmpty: boolean;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <View testID={testID} className="gap-2 rounded-xl border border-border bg-card p-3">
      <View className="flex-row items-center justify-between gap-2">
        <Text className="font-semibold">{title}</Text>
        {action}
      </View>
      {isEmpty ? <Text variant="muted">{empty}</Text> : children}
    </View>
  );
}
