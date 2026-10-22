import type { Song } from '@nomad/api-kjbox';
import { useTranslations } from '@nomad/i18n';
import { Text } from '@nomad/ui';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { SongRow } from './SongRow';
import { songKey } from './model';

/** "✓ Already sung tonight (N)", collapsed by default; sung rows are read-only (actions would 409, A.50). */
export function SungTonight({ songs }: { songs: Song[] }) {
  const t = useTranslations('tonight.night');
  const [open, setOpen] = useState(false);
  if (!songs.length) return null;
  const label = t('sung.title', { count: songs.length });
  return (
    <View testID="tonight-sung" className="gap-2">
      <Pressable
        testID="tonight-sung-toggle"
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((o) => !o)}
        className="min-h-11 justify-center"
      >
        <Text className="font-semibold text-success">{label}</Text>
      </Pressable>
      {open ? songs.map((s) => <SongRow key={songKey(s)} song={s} readOnly />) : null}
    </View>
  );
}
