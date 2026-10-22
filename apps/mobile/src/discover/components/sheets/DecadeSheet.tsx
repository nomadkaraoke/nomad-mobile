import { DECADES, toggle } from '@nomad/core';
import { useTranslations } from '@nomad/i18n';

import { FilterSheet, useDraft, type SheetProps } from './FilterSheet';
import { MultiOptions } from './Options';

export function DecadeSheet({ visible, value, onApply, onClose }: SheetProps<string[]>) {
  const t = useTranslations('discover.filter');
  const [draft, setDraft] = useDraft(value, visible);
  return (
    <FilterSheet
      name="decade"
      title={t('chipDecade')}
      visible={visible}
      onClose={onClose}
      onClear={() => setDraft([])}
      onApply={() => onApply(draft)}
    >
      <MultiOptions
        sheet="decade"
        options={DECADES.map((d) => ({ value: d, label: t(`decade.d${d}`) }))}
        selected={draft}
        onToggle={(d) => setDraft((cur) => toggle(cur, d))}
      />
    </FilterSheet>
  );
}
