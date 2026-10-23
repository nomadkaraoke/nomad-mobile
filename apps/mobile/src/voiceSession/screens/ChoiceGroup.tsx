import { Chip, Text } from '@nomad/ui';
import { View } from 'react-native';

export type ChoiceGroupProps<V extends string> = {
  /** The question, already translated (omit for a follow-up row of chips). */
  title?: string;
  values: readonly V[];
  /** One value (single choice) or several (multi). */
  selected: V | null | readonly V[];
  label: (v: V) => string;
  onPick: (v: V) => void;
  /** testID per chip: `${idPrefix}-${v}`. */
  idPrefix: string;
  multi?: boolean;
};

/** A question with its answers as wrapping chips (radios for a single choice, toggles for several). */
export function ChoiceGroup<V extends string>({ title, values, selected, label, onPick, idPrefix, multi }: ChoiceGroupProps<V>) {
  const isOn = (v: V) => (Array.isArray(selected) ? selected.includes(v) : selected === v);
  return (
    <View className="gap-2" accessibilityRole={multi ? undefined : 'radiogroup'}>
      {title ? <Text className="font-semibold">{title}</Text> : null}
      <View className="flex-row flex-wrap gap-2">
        {values.map((v) => (
          <Chip
            key={v}
            testID={`${idPrefix}-${v}`}
            label={label(v)}
            selected={isOn(v)}
            onPress={() => onPick(v)}
            role={multi ? 'button' : 'radio'}
          />
        ))}
      </View>
    </View>
  );
}
