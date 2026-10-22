import type { RecSection as Section } from '@nomad/api-decide';
import { sectionTitle } from '@nomad/core';
import { isolate, useTranslations } from '@nomad/i18n';
import { Text } from '@nomad/ui';
import { View } from 'react-native';

/**
 * A section id as a testID part. Ids like `because_<artist_key>` can hold spaces and any script, so every
 * character outside [A-Za-z0-9_] becomes `-<hex code point>-` (one-to-one: `-` itself is escaped too).
 */
export function sectionTestId(id: string): string {
  let out = '';
  for (const ch of id) out += /[A-Za-z0-9_]/.test(ch) ? ch : `-${(ch.codePointAt(0) ?? 0).toString(16)}-`;
  return out;
}

/** Section header: title ("Because you like {artist}") and the reason line under it. */
export function RecSection({ section }: { section: Section }) {
  const t = useTranslations();
  const { key, params } = sectionTitle(section);
  const values = Object.fromEntries(Object.entries(params).map(([k, v]) => [k, isolate(v)]));
  return (
    <View testID={`rec-section-${sectionTestId(section.id)}`} className="gap-0.5 pb-1 pt-5">
      <Text className="text-xl font-bold" accessibilityRole="header">
        {t(key, values)}
      </Text>
      <Text variant="muted">{t(`${key}Reason`, values)}</Text>
    </View>
  );
}
