import type { RecFilters } from '@nomad/core';
import { useTranslations } from '@nomad/i18n';
import { Chip } from '@nomad/ui';
import { View } from 'react-native';

import { FilterSheet, useDraft, type SheetProps } from './FilterSheet';
import { SingleOptions } from './Options';

type More = Pick<RecFilters, 'popularity' | 'leadGender' | 'duration' | 'classic' | 'explicit' | 'hasKaraoke'>;

export const MORE_DEFAULTS: More = {
  popularity: null,
  leadGender: null,
  duration: null,
  classic: false,
  explicit: 'include',
  hasKaraoke: 'any',
};

const pickMore = (f: More): More => ({
  popularity: f.popularity,
  leadGender: f.leadGender,
  duration: f.duration,
  classic: f.classic,
  explicit: f.explicit,
  hasKaraoke: f.hasKaraoke,
});

export function MoreSheet({ visible, value, onApply, onClose }: SheetProps<More>) {
  const t = useTranslations('discover.filter');
  const [d, setD] = useDraft(pickMore(value), visible);
  const patch = (p: Partial<More>) => setD((cur) => ({ ...cur, ...p }));
  return (
    <FilterSheet
      name="more"
      title={t('chipMore')}
      visible={visible}
      onClose={onClose}
      onClear={() => setD(MORE_DEFAULTS)}
      onApply={() => onApply(pickMore(d))}
    >
      <SingleOptions
        sheet="more"
        heading={t('popularity.heading')}
        options={[
          { id: 'popularity-any', value: null, label: t('popularity.any') },
          { id: 'popularity-50', value: 50, label: t('popularity.popular') },
          { id: 'popularity-70', value: 70, label: t('popularity.chart') },
        ]}
        selected={d.popularity}
        onSelect={(popularity) => patch({ popularity })}
      />
      <SingleOptions
        sheet="more"
        heading={t('leadGender.heading')}
        options={[
          { id: 'lead-any', value: null, label: t('leadGender.any') },
          { id: 'lead-male', value: 'male', label: t('leadGender.male') },
          { id: 'lead-female', value: 'female', label: t('leadGender.female') },
          { id: 'lead-mixed', value: 'mixed', label: t('leadGender.mixed') },
        ]}
        selected={d.leadGender}
        onSelect={(leadGender) => patch({ leadGender })}
      />
      <SingleOptions
        sheet="more"
        heading={t('duration.heading')}
        options={[
          { id: 'duration-any', value: null, label: t('duration.any') },
          { id: 'duration-short', value: 'short', label: t('duration.short') },
          { id: 'duration-medium', value: 'medium', label: t('duration.medium') },
          { id: 'duration-long', value: 'long', label: t('duration.long') },
        ]}
        selected={d.duration}
        onSelect={(duration) => patch({ duration })}
      />
      <SingleOptions
        sheet="more"
        heading={t('karaoke.heading')}
        options={[
          { id: 'karaoke-any', value: 'any', label: t('karaoke.any') },
          { id: 'karaoke-yes', value: 'yes', label: t('karaoke.yes') },
          { id: 'karaoke-make', value: 'make', label: t('karaoke.make') },
        ]}
        selected={d.hasKaraoke}
        onSelect={(hasKaraoke) => patch({ hasKaraoke })}
      />
      <View className="flex-row flex-wrap gap-2 py-2">
        <Chip
          testID="filter-opt-more-classic"
          label={t('classic')}
          selected={d.classic}
          onPress={() => patch({ classic: !d.classic })}
        />
        <Chip
          testID="filter-opt-more-explicit-exclude"
          label={t('explicit')}
          selected={d.explicit === 'exclude'}
          onPress={() => patch({ explicit: d.explicit === 'exclude' ? 'include' : 'exclude' })}
        />
      </View>
    </FilterSheet>
  );
}
