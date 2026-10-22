import type { ReactNode } from 'react';
import { Pressable, ScrollView, Text } from 'react-native';

export type ChipProps = {
  label: string;
  selected: boolean;
  onPress: () => void;
  testID: string;
  accessibilityHint?: string;
  /** 'radio' for a single-choice group (also reports checked); default 'button'. */
  role?: 'button' | 'radio';
};

/** A selectable pill (filters, segmented choices). Selected = the primary pink, as gen web's active filter. */
export function Chip({ label, selected, onPress, testID, accessibilityHint, role = 'button' }: ChipProps) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole={role}
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={role === 'radio' ? { selected, checked: selected } : { selected }}
      onPress={onPress}
      className={`min-h-11 items-center justify-center rounded-full border px-4 py-2 ${
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
