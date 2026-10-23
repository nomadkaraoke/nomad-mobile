import { Text } from '@nomad/ui';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

/**
 * One way to feed decide your music on the Connect hub: a title, a one-line "what you get · how long", and a
 * "Connected" tag once that source has data. `children` sit under the pressable part (secondary links, errors).
 */
export function ConnectCard({
  testID,
  title,
  detail,
  connectedLabel,
  busy,
  disabled,
  onPress,
  children,
}: {
  testID: string;
  title: string;
  detail: string;
  /** Shown as a tag when set (the source is connected or has imported data). */
  connectedLabel?: string | null;
  busy?: boolean;
  disabled?: boolean;
  onPress: () => void;
  children?: ReactNode;
}) {
  const inactive = Boolean(disabled || busy);
  return (
    <View className="gap-2 rounded-xl border border-border bg-card p-3">
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={connectedLabel ? `${title}, ${detail}, ${connectedLabel}` : `${title}, ${detail}`}
        accessibilityState={{ disabled: inactive, busy: Boolean(busy) }}
        disabled={inactive}
        onPress={onPress}
        className={`min-h-11 flex-row items-center gap-3 ${disabled ? 'opacity-50' : ''}`}
      >
        <View className="flex-1 gap-1">
          <Text className="font-semibold">{title}</Text>
          <Text variant="muted">{detail}</Text>
        </View>
        {busy ? <ActivityIndicator testID={`${testID}-busy`} /> : null}
        {connectedLabel ? (
          <View testID={`${testID}-connected`} className="rounded-full border border-primary px-2 py-0.5">
            <Text className="text-xs text-primary">{connectedLabel}</Text>
          </View>
        ) : null}
      </Pressable>
      {children}
    </View>
  );
}
