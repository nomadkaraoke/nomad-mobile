import { getSingers } from '@nomad/api-kjbox';
import { isolate, useTranslations } from '@nomad/i18n';
import { Button, Text, TextField } from '@nomad/ui';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import type { NomadNight } from '../nightStore';
import { nightKey } from '../nomad/queries';
import { TonightSheet } from '../TonightSheet';

/** Up to 3 duet partners (spec §4.1 Duet partners; the contract's additional_singers maxItems). */
export const MAX_PARTNERS = 3;

const fold = (s: string) => s.trim().toLocaleLowerCase();

/** Tonight's singers A–Z, without the singer and without blanks or duplicates (case-insensitive). */
export function sortedSingers(names: string[], exclude: string[] = []): string[] {
  const skip = new Set(exclude.map(fold));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const n = raw.trim();
    const f = fold(n);
    if (!n || skip.has(f) || seen.has(f)) continue;
    seen.add(f);
    out.push(n);
  }
  return out.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

export type DuetPickerProps = {
  visible: boolean;
  night: NomadNight;
  userKey: string | null;
  selected: string[];
  onChange: (names: string[]) => void;
  onClose: () => void;
  /** The singer's own name (never their own partner). */
  exclude?: string[];
};

/**
 * Duet partner picker (spec §4.1 Duet partners, A.1, A.4, A.113, ruling E6-R7): a filterable A–Z list of tonight's
 * singers with "+ Add 'X' as a new singer", at most 3. No keyboard autofocus (on phones it would cover the list).
 * The box canonicalises the names at submit (A.1).
 */
export function DuetPicker({ visible, night, userKey, selected, onChange, onClose, exclude = [] }: DuetPickerProps) {
  const t = useTranslations('tonight.manage.duet');
  const tManage = useTranslations('tonight.manage');
  const [filter, setFilter] = useState('');
  // A fresh filter each time the picker opens (state adjusted during render, not in an effect).
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) setFilter('');
  }
  const singers = useQuery({
    queryKey: [...nightKey(night, userKey), 'singers'],
    queryFn: () => getSingers(night.code, night.nightId),
    enabled: visible,
    retry: false,
    staleTime: 30_000,
  });
  const all = useMemo(() => sortedSingers(singers.data?.singers ?? [], exclude), [singers.data, exclude]);
  const q = fold(filter);
  const shown = q ? all.filter((n) => fold(n).includes(q)) : all;
  const typed = filter.trim();
  const known = [...all, ...selected].some((n) => fold(n) === q);
  const full = selected.length >= MAX_PARTNERS;
  const isSelected = (n: string) => selected.some((s) => fold(s) === fold(n));

  const toggle = (n: string) => {
    if (isSelected(n)) onChange(selected.filter((s) => fold(s) !== fold(n)));
    else if (!full) onChange([...selected, n]);
  };

  return (
    <TonightSheet visible={visible} onClose={onClose} title={t('title')} testID="tonight-duet-sheet" closeLabel={tManage('close')} fullHeight>
      <View className="flex-1 gap-3">
        {selected.length ? (
          <View className="flex-row flex-wrap gap-2">
            {selected.map((n) => (
              <Pressable
                key={n}
                testID={`tonight-duet-chip-${n}`}
                accessibilityRole="button"
                accessibilityLabel={t('remove', { name: n })}
                onPress={() => toggle(n)}
                className="min-h-11 justify-center rounded-full border border-primary px-3"
              >
                <Text className="font-semibold">{`${n} ✕`}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        <TextField testID="tonight-duet-filter" label={t('filter')} value={filter} onChangeText={setFilter} autoCapitalize="words" />
        {full ? (
          <Text testID="tonight-duet-max" variant="muted">
            {t('max')}
          </Text>
        ) : null}
        {typed && !known && !full ? (
          <Pressable
            testID="tonight-duet-add-new"
            accessibilityRole="button"
            onPress={() => {
              onChange([...selected, typed]);
              setFilter('');
            }}
            className="min-h-12 justify-center rounded-lg border border-dashed border-primary px-3"
          >
            <Text className="font-semibold text-primary">{t('addNew', { name: isolate(typed) })}</Text>
          </Pressable>
        ) : null}
        <ScrollView className="flex-1" keyboardShouldPersistTaps="handled">
          {singers.isError ? (
            <Text testID="tonight-duet-error" variant="muted">
              {t('loadFailed')}
            </Text>
          ) : singers.isSuccess && all.length === 0 ? (
            <Text testID="tonight-duet-empty" variant="muted">
              {t('empty')}
            </Text>
          ) : null}
          {shown.map((n, i) => {
            // Letter headers for the A–Z list.
            const letter = n.charAt(0).toLocaleUpperCase();
            const header = i === 0 || shown[i - 1]!.charAt(0).toLocaleUpperCase() !== letter ? letter : null;
            const on = isSelected(n);
            const disabled = !on && full;
            return (
              <View key={n}>
                {header ? <Text className="mt-2 text-xs font-bold text-muted">{header}</Text> : null}
                <Pressable
                  testID={`tonight-duet-singer-${n}`}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on, disabled }}
                  disabled={disabled}
                  onPress={() => toggle(n)}
                  className={`min-h-[46px] flex-row items-center justify-between border-b border-border px-1 ${disabled ? 'opacity-40' : ''}`}
                >
                  <Text className={on ? 'font-bold text-primary' : ''}>{n}</Text>
                  {on ? <Text className="font-bold text-primary">{'✓'}</Text> : null}
                </Pressable>
              </View>
            );
          })}
        </ScrollView>
        <Button testID="tonight-duet-done" label={t('done')} onPress={onClose} />
      </View>
    </TonightSheet>
  );
}
