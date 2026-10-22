import type { Song } from '@nomad/api-kjbox';
import { useTranslations } from '@nomad/i18n';
import { Text } from '@nomad/ui';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { SongRow } from './SongRow';
import { songKey } from './model';

/**
 * "✓ Already sung tonight (N)", collapsed by default; sung rows are read-only (actions would 409, A.50), except
 * "How did it go?" (spec §6.3) on songs logged to the singer (non-null history_id), which reopens the survey.
 */
export function SungTonight({ songs, onSurvey }: { songs: Song[]; onSurvey?: (song: Song) => void }) {
  const t = useTranslations('tonight.night');
  const tSurvey = useTranslations('tonight.survey');
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
      {open
        ? songs.map((s) => (
            <View key={songKey(s)} className="gap-1">
              <SongRow song={s} readOnly />
              {s.history_id && onSurvey ? (
                <Pressable
                  testID={`sung-${s.history_id}-survey`}
                  accessibilityRole="button"
                  hitSlop={8}
                  onPress={() => onSurvey(s)}
                  className="min-h-11 justify-center"
                >
                  <Text className="text-sm font-semibold text-primary">{tSurvey('title')}</Text>
                </Pressable>
              ) : null}
            </View>
          ))
        : null}
    </View>
  );
}
