import type { ReactNode } from 'react';
import { Pressable, ScrollView, Text } from 'react-native';

export type ChipProps = {
  label: string;
  selected: boolean;
  onPress: () => void;
  testID: string;
  accessibilityHint?: string;
};

/** A selectable pill (filters, segmented choices). Selected = the primary pink, as gen web's active filter. */
export function Chip({ label, selected, onPress, testID, accessibilityHint }: ChipProps) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ selected }}
      onPress={onPress}
      className={`min-h-10 items-center justify-center rounded-full border px-4 py-2 ${
        selected ? 'border-primary bg-primary' : 'border-border bg-card'
      }`}
    >
      <Text className={`text-sm ${selected ? 'font-bold text-primary-fg' : 'font-semibold text-text'}`}>{label}</Text>
    </Pressable>
  );
}

export type ChipRowProps = { children: ReactNode; testID: string };

/** Chips in one horizontally scrolling line. */
export function ChipRow({ children, testID }: ChipRowProps) {
  return (
    <ScrollView
      testID={testID}
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerClassName="gap-2 px-4"
    >
      {children}
    </ScrollView>
  );
}
