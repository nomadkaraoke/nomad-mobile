import type { RecSort } from '@nomad/core';
import { useTranslations } from '@nomad/i18n';
import { Text } from '@nomad/ui';
import { Pressable } from 'react-native';

import { SORTS } from '../../filtersStore';
import { FilterSheet, useDraft, type SheetProps } from './FilterSheet';
import { SingleOptions } from './Options';

/** `onTestVoice` set = no voice profile on the phone: "Fits my voice" becomes a link to the voice test. */
export function SortSheet({
  visible,
  value,
  onApply,
  onClose,
  onTestVoice,
}: SheetProps<RecSort> & { onTestVoice?: () => void }) {
  const t = useTranslations('discover.filter');
  const tf = useTranslations('fit');
  const [draft, setDraft] = useDraft(value, visible);
  return (
    <FilterSheet
      name="sort"
      title={t('chipSort')}
      visible={visible}
      onClose={onClose}
      onClear={() => setDraft('best')}
      onApply={() => onApply(draft)}
    >
      <SingleOptions
        sheet="sort"
        options={SORTS.filter((s) => s !== 'fit' || !onTestVoice).map((s) => ({ id: s, value: s, label: t(`sort.${s}`) }))}
        selected={draft}
        onSelect={setDraft}
      />
      {onTestVoice ? (
        <Pressable testID="filter-sort-fit-cta" accessibilityRole="button" onPress={onTestVoice} className="min-h-11 justify-center">
          <Text className="text-primary">{tf('sortFitCta')}</Text>
        </Pressable>
      ) : null}
    </FilterSheet>
  );
}
