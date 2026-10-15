import { ActivityIndicator, Pressable } from 'react-native';

import { Text } from './Text';
import { colors } from './tokens';

export type ButtonProps = {
  label: string;
  onPress: () => void;
  testID: string;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
  loading?: boolean;
};

export function Button({ label, onPress, testID, variant = 'primary', disabled, loading }: ButtonProps) {
  const inactive = Boolean(disabled || loading);
  const base = variant === 'primary' ? 'bg-primary' : 'bg-card border border-border';
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: inactive, busy: Boolean(loading) }}
      disabled={inactive}
      onPress={onPress}
      className={`${base} min-h-12 items-center justify-center rounded-lg px-4 ${inactive ? 'opacity-50' : ''}`}
    >
      {loading ? (
        <ActivityIndicator testID={`${testID}-spinner`} color={colors.primaryFg} />
      ) : (
        <Text className="font-semibold">{label}</Text>
      )}
    </Pressable>
  );
}
