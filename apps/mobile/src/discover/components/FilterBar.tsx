import { DEFAULT_REC_FILTERS, type RecFilters } from '@nomad/core';
import { useTranslations } from '@nomad/i18n';
import { Chip, ChipRow } from '@nomad/ui';
import { router, type Href } from 'expo-router';
import { useState } from 'react';

import { useVoiceStore } from '../../voice/voiceStore';

import { DecadeSheet } from './sheets/DecadeSheet';
import { EnergySheet } from './sheets/EnergySheet';
import { GenreSheet } from './sheets/GenreSheet';
import { MoodSheet } from './sheets/MoodSheet';
import { MoreSheet } from './sheets/MoreSheet';
import { SortSheet } from './sheets/SortSheet';

type SheetName = 'sort' | 'genre' | 'decade' | 'mood' | 'energy' | 'more';

const MORE_KEYS = ['popularity', 'leadGender', 'duration', 'classic', 'explicit', 'hasKaraoke'] as const;

export type FilterBarProps = { filters: RecFilters; onChange: (patch: Partial<RecFilters>) => void };

/** Sort / Genre / Decade / Mood / Energy / More chips, each opening its sheet; a chip shows how many are on. */
export function FilterBar({ filters, onChange }: FilterBarProps) {
  const t = useTranslations('discover.filter');
  const tf = useTranslations('fit');
  const hasVoice = useVoiceStore((s) => s.profile !== null);
  const testVoice = () => {
    close();
    router.push('/discover/voice' as Href);
  };
  const [open, setOpen] = useState<SheetName | null>(null);
  const close = () => setOpen(null);
  const apply = (patch: Partial<RecFilters>) => {
    onChange(patch);
    close();
  };
  const moreCount = MORE_KEYS.filter((k) => filters[k] !== DEFAULT_REC_FILTERS[k]).length;
  const chips: { name: SheetName; label: string; count: number }[] = [
    { name: 'sort', label: t('chipSort'), count: filters.sort === 'best' ? 0 : 1 },
    { name: 'genre', label: t('chipGenre'), count: filters.genre.length },
    { name: 'decade', label: t('chipDecade'), count: filters.decade.length },
    { name: 'mood', label: t('chipMood'), count: filters.mood.length },
    { name: 'energy', label: t('chipEnergy'), count: filters.energy ? 1 : 0 },
    { name: 'more', label: t('chipMore'), count: moreCount },
  ];
  return (
    <>
      <ChipRow testID="filter-bar">
        {/* Singable (Phase 3c), first so it is on screen: a toggle; without a voice profile on the phone it opens the voice test instead. */}
        {hasVoice ? (
          <Chip
            testID="filter-chip-singable"
            label={tf('singable')}
            selected={filters.singable}
            onPress={() => onChange({ singable: !filters.singable })}
          />
        ) : (
          <Chip
            testID="filter-chip-singable-cta"
            label={tf('singable')}
            accessibilityHint={tf('singableCtaHint')}
            selected={false}
            onPress={testVoice}
          />
        )}
        {chips.map((c) => (
          <Chip
            key={c.name}
            testID={`filter-chip-${c.name}`}
            label={c.count > 0 ? t('chipCount', { label: c.label, count: c.count }) : c.label}
            selected={c.count > 0}
            onPress={() => setOpen(c.name)}
          />
        ))}
      </ChipRow>
      <SortSheet
        visible={open === 'sort'}
        value={filters.sort}
        onClose={close}
        onApply={(sort) => apply({ sort })}
        onTestVoice={hasVoice ? undefined : testVoice}
      />
      <GenreSheet visible={open === 'genre'} value={filters.genre} onClose={close} onApply={(genre) => apply({ genre })} />
      <DecadeSheet visible={open === 'decade'} value={filters.decade} onClose={close} onApply={(decade) => apply({ decade })} />
      <MoodSheet visible={open === 'mood'} value={filters.mood} onClose={close} onApply={(mood) => apply({ mood })} />
      <EnergySheet visible={open === 'energy'} value={filters.energy} onClose={close} onApply={(energy) => apply({ energy })} />
      <MoreSheet visible={open === 'more'} value={filters} onClose={close} onApply={apply} />
    </>
  );
}
