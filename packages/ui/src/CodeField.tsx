import { TextInput, View, type TextInputProps } from 'react-native';

import { Text } from './Text';

export type CodeFieldProps = {
  label: string;
  value: string;
  onChangeText: (digits: string) => void;
  testID: string;
  length?: number;
  invalid?: boolean;
  /** Called with the code once every box is filled (paste or one-time-code autofill included). */
  onFilled?: (digits: string) => void;
} & Pick<TextInputProps, 'autoFocus'>;

/**
 * One-time-code input drawn as boxes. A single real TextInput (transparent text) lies over the boxes, so
 * paste, iOS/Android code autofill, accessibility and Maestro all see one ordinary field.
 */
export function CodeField({ label, value, onChangeText, testID, length = 6, invalid, onFilled, autoFocus }: CodeFieldProps) {
  const onChange = (raw: string) => {
    const digits = raw.replace(/\D/g, '').slice(0, length);
    onChangeText(digits);
    if (digits.length === length) onFilled?.(digits);
  };
  return (
    <View className="gap-1">
      <Text variant="muted">{label}</Text>
      <View className="relative flex-row gap-2" style={{ direction: 'ltr' }}>
        {Array.from({ length }, (_, i) => (
          <View
            key={i}
            testID={`${testID}-box-${i}`}
            className={`h-14 flex-1 items-center justify-center rounded-lg border bg-card ${
              invalid ? 'border-danger' : i === value.length ? 'border-primary' : 'border-border'
            }`}
          >
            <Text className="text-2xl font-semibold">{value[i] ?? ''}</Text>
          </View>
        ))}
        <TextInput
          testID={testID}
          accessibilityLabel={label}
          value={value}
          onChangeText={onChange}
          // No maxLength: a pasted "123 456" must keep its last digit; onChange trims to `length` digits.
          keyboardType="number-pad"
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          autoFocus={autoFocus}
          caretHidden
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, color: 'transparent' }}
        />
      </View>
    </View>
  );
}
