import type { RecFilters } from '@nomad/core';
import { useTranslations } from '@nomad/i18n';

import { FilterSheet, useDraft, type SheetProps } from './FilterSheet';
import { SingleOptions } from './Options';

type Energy = RecFilters['energy'];

export function EnergySheet({ visible, value, onApply, onClose }: SheetProps<Energy>) {
  const t = useTranslations('discover.filter');
  const [draft, setDraft] = useDraft<Energy>(value, visible);
  const options: { id: string; value: Energy; label: string }[] = [
    { id: 'any', value: null, label: t('energy.any') },
    { id: 'low', value: 'low', label: t('energy.low') },
    { id: 'mid', value: 'mid', label: t('energy.mid') },
    { id: 'high', value: 'high', label: t('energy.high') },
  ];
  return (
    <FilterSheet
      name="energy"
      title={t('chipEnergy')}
      visible={visible}
      onClose={onClose}
      onClear={() => setDraft(null)}
      onApply={() => onApply(draft)}
    >
      <SingleOptions sheet="energy" options={options} selected={draft} onSelect={setDraft} />
    </FilterSheet>
  );
}
