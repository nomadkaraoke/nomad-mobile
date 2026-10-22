import { GENRE_IDS, toggle } from '@nomad/core';
import { useTranslations } from '@nomad/i18n';

import { FilterSheet, useDraft, type SheetProps } from './FilterSheet';
import { MultiOptions } from './Options';

/** decide's genre ids to their message keys (`classic-rock` is `classicRock`). */
const labelKey = (id: string) => id.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());

export function GenreSheet({ visible, value, onApply, onClose }: SheetProps<string[]>) {
  const t = useTranslations('discover.filter');
  const [draft, setDraft] = useDraft(value, visible);
  return (
    <FilterSheet
      name="genre"
      title={t('chipGenre')}
      visible={visible}
      onClose={onClose}
      onClear={() => setDraft([])}
      onApply={() => onApply(draft)}
    >
      <MultiOptions
        sheet="genre"
        options={GENRE_IDS.map((g) => ({ value: g, label: t(`genre.${labelKey(g)}`) }))}
        selected={draft}
        onToggle={(g) => setDraft((d) => toggle(d, g))}
      />
    </FilterSheet>
  );
}
