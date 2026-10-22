import { toggle, type Mood } from '@nomad/core';
import { useTranslations } from '@nomad/i18n';

import { MOODS } from '../../filtersStore';
import { FilterSheet, useDraft, type SheetProps } from './FilterSheet';
import { MultiOptions } from './Options';

export function MoodSheet({ visible, value, onApply, onClose }: SheetProps<Mood[]>) {
  const t = useTranslations('discover.filter');
  const [draft, setDraft] = useDraft(value, visible);
  return (
    <FilterSheet
      name="mood"
      title={t('chipMood')}
      visible={visible}
      onClose={onClose}
      onClear={() => setDraft([])}
      onApply={() => onApply(draft)}
    >
      <MultiOptions
        sheet="mood"
        options={MOODS.map((m) => ({ value: m, label: t(`mood.${m}`) }))}
        selected={draft}
        onToggle={(m) => setDraft((cur) => toggle(cur, m) as Mood[])}
      />
    </FilterSheet>
  );
}
