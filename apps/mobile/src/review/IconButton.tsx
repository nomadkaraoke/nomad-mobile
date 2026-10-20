import { Ionicons } from '@expo/vector-icons';
import { colors } from '@nomad/ui';
import type { ComponentProps } from 'react';
import { Pressable } from 'react-native';

export type IconName = ComponentProps<typeof Ionicons>['name'];

type Props = {
  icon: IconName;
  /** Already translated. */
  label: string;
  testID: string;
  onPress: () => void;
  disabled?: boolean;
  color?: string;
  size?: number;
};

/** A 44 pt icon-only button (spec §4.8 touch target), labelled for screen readers. */
export function IconButton({ icon, label, testID, onPress, disabled, color = colors.text, size = 22 }: Props) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={4}
      className={`h-11 w-11 items-center justify-center rounded-full ${disabled ? 'opacity-40' : ''}`}
    >
      <Ionicons name={icon} size={size} color={color} />
    </Pressable>
  );
}
