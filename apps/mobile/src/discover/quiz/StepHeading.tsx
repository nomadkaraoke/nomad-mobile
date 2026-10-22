import { Text } from '@nomad/ui';
import { View } from 'react-native';

/** A quiz step's (or section's) title and hint. */
export function StepHeading({ title, hint }: { title: string; hint?: string }) {
  return (
    <View className="gap-1">
      <Text className="text-xl font-bold">{title}</Text>
      {hint ? <Text variant="muted">{hint}</Text> : null}
    </View>
  );
}
