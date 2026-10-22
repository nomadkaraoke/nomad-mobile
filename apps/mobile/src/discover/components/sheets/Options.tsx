import { Chip, Text } from '@nomad/ui';
import { View } from 'react-native';

export type Option<V extends string | number | null> = { value: V; label: string };

type Common = { sheet: string; heading?: string };

/** Wrapped chips, several can be on. Option testIDs: `filter-opt-<sheet>-<value>`. */
export function MultiOptions({
  sheet,
  heading,
  options,
  selected,
  onToggle,
}: Common & { options: Option<string>[]; selected: readonly string[]; onToggle: (v: string) => void }) {
  return (
    <Group heading={heading}>
      {options.map((o) => (
        <Chip
          key={o.value}
          testID={`filter-opt-${sheet}-${o.value}`}
          label={o.label}
          selected={selected.includes(o.value)}
          onPress={() => onToggle(o.value)}
        />
      ))}
    </Group>
  );
}

/** Wrapped chips, exactly one is on (radio). `id` is the testID part, `value` what is stored. */
export function SingleOptions<V extends string | number | null>({
  sheet,
  heading,
  options,
  selected,
  onSelect,
}: Common & {
  options: (Option<V> & { id: string })[];
  selected: V;
  onSelect: (v: V) => void;
}) {
  return (
    <Group heading={heading} radio>
      {options.map((o) => (
        <Chip
          key={o.id}
          role="radio"
          testID={`filter-opt-${sheet}-${o.id}`}
          label={o.label}
          selected={selected === o.value}
          onPress={() => onSelect(o.value)}
        />
      ))}
    </Group>
  );
}

function Group({ heading, radio, children }: { heading?: string; radio?: boolean; children: React.ReactNode }) {
  return (
    <View accessibilityRole={radio ? 'radiogroup' : undefined} accessibilityLabel={heading} className="gap-2 py-2">
      {heading ? <Text className="font-semibold">{heading}</Text> : null}
      <View className="flex-row flex-wrap gap-2">{children}</View>
    </View>
  );
}
