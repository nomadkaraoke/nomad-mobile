import type { ReactNode } from 'react';
import { Pressable, ScrollView, Text } from 'react-native';

export type ChipProps = {
  label: string;
  selected: boolean;
  onPress: () => void;
  testID: string;
  accessibilityHint?: string;
  /** Read instead of `label` (e.g. when a glyph adds meaning the label alone doesn't carry). */
  accessibilityLabel?: string;
  /** A short glyph before the label ("+"), hidden from accessibility: the label/hint say what it means. */
  leading?: string;
  /** 'radio' for a single-choice group (also reports checked); default 'button'. */
  role?: 'button' | 'radio';
};

/** A selectable pill (filters, segmented choices). Selected = the primary pink, as gen web's active filter. */
export function Chip({ label, selected, onPress, testID, accessibilityHint, accessibilityLabel, leading, role = 'button' }: ChipProps) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole={role}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={role === 'radio' ? { selected, checked: selected } : { selected }}
      onPress={onPress}
      className={`min-h-11 flex-row items-center justify-center gap-1.5 rounded-full border px-4 py-2 ${
        selected ? 'border-primary bg-primary' : 'border-border bg-card'
      }`}
    >
      {leading ? (
        <Text
          testID={`chip-leading-${testID}`}
          importantForAccessibility="no"
          accessibilityElementsHidden
          className="text-base font-bold text-primary"
        >
          {leading}
        </Text>
      ) : null}
      <Text className={`text-sm ${selected ? 'font-bold text-primary-fg' : 'font-semibold text-text'}`}>{label}</Text>
    </Pressable>
  );
}

export type ChipRowProps = { children: ReactNode; testID: string };

/** The row stays one chip high: a ScrollView grows by default, and in a flex column it stretched the chips tall. */
const ROW_STYLE = { flexGrow: 0 } as const;

/** Chips in one horizontally scrolling line, aligned with the screen's content (no inset of its own). */
export function ChipRow({ children, testID }: ChipRowProps) {
  return (
    <ScrollView
      testID={testID}
      horizontal
      showsHorizontalScrollIndicator={false}
      style={ROW_STYLE}
      contentContainerClassName="gap-2"
      // With the keyboard up (a search field above), the first tap picks the chip instead of only closing it.
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  );
}
