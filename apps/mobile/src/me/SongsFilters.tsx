import type { LibraryQuery } from '@nomad/core';
import { isolate, useTranslations } from '@nomad/i18n';
import { Chip, ChipRow, TextField } from '@nomad/ui';
import { View } from 'react-native';

import { LibraryFilterPicker } from '../find/library';

export const SORTS = ['most', 'recent', 'rated', 'az'] as const;
export const FEELS = ['great', 'ok', 'bad', 'unrated'] as const;
export const OFTENS = ['twice', 'once', 'unsung'] as const;
export const MOODS = ['happy', 'chill', 'sad', 'intense'] as const;

export type SongsFilter = {
  text: string;
  sort: (typeof SORTS)[number];
  feel: (typeof FEELS)[number][];
  often: (typeof OFTENS)[number] | null;
  moods: string[];
  vibes: string[];
  saved: boolean;
};
export const INITIAL_FILTER: SongsFilter = { text: '', sort: 'most', feel: [], often: null, moods: [], vibes: [], saved: false };

export const toQuery = (f: SongsFilter, library: NonNullable<LibraryQuery['library']>): LibraryQuery => ({
  text: f.text, sort: f.sort, feel: f.feel, often: f.often, moods: f.moods, vibes: f.vibes, library, savedOnly: f.saved,
});

const toggle = <T,>(list: T[], v: T): T[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

/** Search, sort and filter chips of the collection screen. `vibesInUse` limits the vibe chips to what the user has used. */
export function SongsFilters({ value: f, onChange, vibesInUse }: { value: SongsFilter; onChange: (f: SongsFilter) => void; vibesInUse: string[] }) {
  const t = useTranslations('me.songs');
  const tFeel = useTranslations('me.songs.feel');
  const tSort = useTranslations('me.songs.sort');
  const tOften = useTranslations('me.songs.often');
  const tMood = useTranslations('discover.filter.mood');
  const tVibe = useTranslations('tonight.survey.vibe');
  const set = (patch: Partial<SongsFilter>) => onChange({ ...f, ...patch });
  return (
    <View className="gap-2 px-4 pb-2 pt-3">
      <TextField
        testID="me-songs-search"
        label={t('searchLabel')}
        placeholder={t('searchPlaceholder')}
        value={f.text}
        onChangeText={(text) => set({ text })}
        returnKeyType="search"
      />
      <ChipRow testID="me-songs-sorts">
        {SORTS.map((s) => (
          <Chip key={s} testID={`me-songs-sort-${s}`} label={tSort(s)} selected={f.sort === s} onPress={() => set({ sort: s })} role="radio" />
        ))}
      </ChipRow>
      <ChipRow testID="me-songs-feels">
        <Chip testID="me-songs-saved" label={t('saved')} selected={f.saved} onPress={() => set({ saved: !f.saved })} />
        {FEELS.map((x) => (
          <Chip key={x} testID={`me-songs-feel-${x}`} label={tFeel(x)} selected={f.feel.includes(x)} onPress={() => set({ feel: toggle(f.feel, x) })} />
        ))}
      </ChipRow>
      <ChipRow testID="me-songs-oftens">
        {OFTENS.map((x) => (
          <Chip key={x} testID={`me-songs-often-${x}`} label={tOften(x)} selected={f.often === x} onPress={() => set({ often: f.often === x ? null : x })} />
        ))}
      </ChipRow>
      <ChipRow testID="me-songs-moods">
        {MOODS.map((x) => (
          <Chip key={x} testID={`me-songs-mood-${x}`} label={tMood(x)} selected={f.moods.includes(x)} onPress={() => set({ moods: toggle(f.moods, x) })} />
        ))}
      </ChipRow>
      {vibesInUse.length ? (
        <ChipRow testID="me-songs-vibes">
          {vibesInUse.map((v) => (
            <Chip key={v} testID={`me-songs-vibe-${v}`} label={isolate(tVibe(v))} selected={f.vibes.includes(v)} onPress={() => set({ vibes: toggle(f.vibes, v) })} />
          ))}
        </ChipRow>
      ) : null}
      <LibraryFilterPicker />
    </View>
  );
}
