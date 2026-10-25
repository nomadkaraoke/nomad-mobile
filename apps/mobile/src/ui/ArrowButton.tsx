import { Text } from '@nomad/ui';
import { Pressable } from 'react-native';

export type ArrowButtonProps = { testID: string; glyph: '▲' | '▼'; label: string; disabled: boolean; onPress: () => void };

/** A 44pt bordered ▲/▼ move button; the glyph is hidden from screen readers, the label carries the meaning. */
export function ArrowButton({ testID, glyph, label, disabled, onPress }: ArrowButtonProps) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      className={`h-11 w-11 items-center justify-center rounded-md border border-border ${disabled ? 'opacity-30' : ''}`}
    >
      <Text importantForAccessibility="no" accessibilityElementsHidden className="text-lg">
        {glyph}
      </Text>
    </Pressable>
  );
}
