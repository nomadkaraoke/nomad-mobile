import { Canvas, Group, Path } from '@shopify/react-native-skia';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

export type SocialButtonProps = {
  label: string;
  onPress: () => void;
  testID: string;
  /** apple: Apple's white style for dark backgrounds; google: Google's dark style; outline: everything else. */
  variant: 'apple' | 'google' | 'outline';
  /** Drawn at the button's left edge (the label stays centred), like other apps' sign-in buttons. */
  icon?: ReactNode;
  disabled?: boolean;
  loading?: boolean;
};

// Colours from Apple's HIG (Sign in with Apple, white on dark) and Google's sign-in branding (dark theme).
const VARIANTS = {
  apple: { box: { backgroundColor: '#FFFFFF' }, label: '#000000' },
  google: { box: { backgroundColor: '#131314', borderWidth: 1, borderColor: '#8E918F' }, label: '#E3E3E3' },
  outline: { box: { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#3F3F46' }, label: '#F4F4F5' },
} as const;

/** A provider sign-in button: full-width pill, provider icon left, label centred. */
export function SocialButton({ label, onPress, testID, variant, icon, disabled, loading }: SocialButtonProps) {
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
      style={v.box}
      className={`min-h-13 flex-row items-center justify-center rounded-full px-12 py-3 ${inactive ? 'opacity-50' : ''}`}
    >
      {icon ? <View className="absolute left-5 h-6 w-6 items-center justify-center">{icon}</View> : null}
      {loading ? (
        <ActivityIndicator testID={`${testID}-spinner`} color={v.label} />
      ) : (
        <Text style={{ color: v.label }} className="text-center text-base font-semibold">
          {label}
        </Text>
      )}
    </Pressable>
  );
}

// Google's four-colour "G" (48 × 48 units), from Google's sign-in branding assets.
const G_PATHS = [
  { color: '#EA4335', d: 'M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z' },
  { color: '#4285F4', d: 'M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z' },
  { color: '#FBBC05', d: 'M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z' },
  { color: '#34A853', d: 'M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z' },
] as const;

/** Google's "G" logo, `size` px square. */
export function GoogleLogo({ size = 20 }: { size?: number }) {
  return (
    <Canvas style={{ width: size, height: size }} accessibilityElementsHidden importantForAccessibility="no">
      <Group transform={[{ scale: size / 48 }]}>
        {G_PATHS.map((p) => (
          <Path key={p.color} path={p.d} color={p.color} />
        ))}
      </Group>
    </Canvas>
  );
}
