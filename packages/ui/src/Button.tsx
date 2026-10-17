import { ActivityIndicator, Pressable, Text } from 'react-native';

import { colors } from './tokens';

export type ButtonProps = {
  label: string;
  onPress: () => void;
  testID: string;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
  loading?: boolean;
};

const VARIANTS = {
  // Near-black on pink (tokens.primaryFg): 8:1, where gen web's white is 2.4:1.
  primary: { box: 'bg-primary', label: 'text-primary-fg font-bold', spinner: colors.primaryFg },
  secondary: { box: 'bg-card border border-border', label: 'text-text font-semibold', spinner: colors.text },
} as const;

export function Button({ label, onPress, testID, variant = 'primary', disabled, loading }: ButtonProps) {
  const inactive = Boolean(disabled || loading);
  const v = VARIANTS[variant];
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: inactive, busy: Boolean(loading) }}
      disabled={inactive}
      onPress={onPress}
      className={`${v.box} min-h-12 items-center justify-center rounded-lg px-4 ${inactive ? 'opacity-50' : ''}`}
    >
      {loading ? (
        <ActivityIndicator testID={`${testID}-spinner`} color={v.spinner} />
      ) : (
        // Its own Text (not ./Text): that one sets text-text, which would fight the label colour.
        <Text className={`text-center text-base ${v.label}`}>{label}</Text>
      )}
    </Pressable>
  );
}
