import { LIBRARY_FILTERS, type LibraryFilter } from '@nomad/core';
import { useTranslations } from '@nomad/i18n';
import { Chip, ChipRow, Text } from '@nomad/ui';
import { View } from 'react-native';

import { useLibraryFilter } from './store';

const LABEL_KEY = { any: 'libraryAny', community: 'libraryCommunity', karafun: 'libraryKarafun' } as const;

/** Segmented choice of venue library (any / community / KaraFun), persisted by useLibraryFilter. */
export function LibraryFilterPicker() {
  const t = useTranslations('discover');
  const filter = useLibraryFilter((s) => s.filter);
  const set = useLibraryFilter((s) => s.set);
  return (
    <View testID="library-filter" accessibilityRole="radiogroup" accessibilityLabel={t('libraryLabel')} className="gap-1.5">
      <ChipRow testID="library-filter-row">
        {LIBRARY_FILTERS.map((value: LibraryFilter) => (
          <Chip
            key={value}
            testID={`library-filter-${value}`}
            label={t(LABEL_KEY[value])}
            selected={filter === value}
            onPress={() => set(value)}
            role="radio"
          />
        ))}
      </ChipRow>
      {filter === 'karafun' ? (
        <Text variant="muted" testID="library-filter-info">
          {t('libraryInfo')}
        </Text>
      ) : null}
    </View>
  );
}
