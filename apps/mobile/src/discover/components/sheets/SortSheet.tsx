import type { RecSort } from '@nomad/core';
import { useTranslations } from '@nomad/i18n';

import { SORTS } from '../../filtersStore';
import { FilterSheet, useDraft, type SheetProps } from './FilterSheet';
import { SingleOptions } from './Options';

export function SortSheet({ visible, value, onApply, onClose }: SheetProps<RecSort>) {
  const t = useTranslations('discover.filter');
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
        options={SORTS.map((s) => ({ id: s, value: s, label: t(`sort.${s}`) }))}
        selected={draft}
        onSelect={setDraft}
      />
    </FilterSheet>
  );
}
