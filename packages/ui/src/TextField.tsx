import { TextInput, View, type TextInputProps } from 'react-native';

import { Text } from './Text';
import { colors } from './tokens';

export type TextFieldProps = {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  testID: string;
  error?: string;
  placeholder?: string;
} & Pick<TextInputProps, 'keyboardType' | 'maxLength' | 'autoComplete' | 'autoFocus' | 'autoCapitalize' | 'returnKeyType' | 'onSubmitEditing' | 'textContentType'>;

export function TextField({ label, error, testID, ...input }: TextFieldProps) {
  return (
    <View className="gap-1">
      <Text variant="muted">{label}</Text>
      <TextInput
        testID={testID}
        accessibilityLabel={label}
        placeholderTextColor={colors.muted}
        autoCorrect={false}
        className={`rounded-lg border bg-card px-3 py-3 text-base text-text ${error ? 'border-danger' : 'border-border'}`}
        {...input}
      />
      {error ? <Text variant="error">{error}</Text> : null}
    </View>
  );
}
