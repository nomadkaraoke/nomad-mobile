import { isolate, useFormatter, useTranslations } from '@nomad/i18n';
import { Button, Sheet, Text } from '@nomad/ui';
import { useRef, useState } from 'react';
import { Platform, Pressable, View } from 'react-native';

import { useLogStore, type LogSong } from '../tonight/log/logStore';
import { useNightStore } from '../tonight/nightStore';
import { SurveySheet } from '../tonight/log/SurveySheet';

export type MarkSungSong = LogSong;
type When = 'tonight' | 'date' | 'ago';

export const MAX_TIMES = 50;
const YEARS_BACK = 15;
/** Non-word glyphs: the buttons' meaning comes from their accessibility labels. */
const MINUS = '\u2212';
const PLUS = '+';
const pad = (n: number) => String(n).padStart(2, '0');
const daysIn = (year: number, month: number) => new Date(year, month, 0).getDate();

function Chip({ testID, label, selected, onPress }: { testID: string; label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      className={`min-h-11 justify-center rounded-full border px-4 ${selected ? 'border-primary bg-primary/15' : 'border-border bg-card'}`}
    >
      <Text className={selected ? 'font-semibold text-primary' : ''}>{label}</Text>
    </Pressable>
  );
}

function Stepper({
  idPrefix,
  label,
  value,
  display,
  onChange,
  min,
  max,
}: {
  idPrefix: string;
  label: string;
  value: number;
  display: string;
  onChange: (v: number) => void;
  min: number;
  max: number;
}) {
  const t = useTranslations('me.mark');
  return (
    <View className="flex-row items-center justify-between gap-3">
      <Text className="font-semibold">{label}</Text>
      <View className="flex-row items-center gap-3">
        <Pressable
          testID={`${idPrefix}-minus`}
          accessibilityRole="button"
          accessibilityLabel={t('less')}
          disabled={value <= min}
          onPress={() => onChange(Math.max(min, value - 1))}
          className="h-11 w-11 items-center justify-center rounded-full border border-border bg-card"
        >
          <Text>{'−'}</Text>
        </Pressable>
        <Text testID={`${idPrefix}-value`} className="min-w-10 text-center text-lg font-semibold">
          {display}
        </Text>
        <Pressable
          testID={`${idPrefix}-plus`}
          accessibilityRole="button"
          accessibilityLabel={t('more')}
          disabled={value >= max}
          onPress={() => onChange(Math.min(max, value + 1))}
          className="h-11 w-11 items-center justify-center rounded-full border border-border bg-card"
        >
          <Text>{PLUS}</Text>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * Mark a song as sung: tonight (joins the open bar night), on a rough date (month and year, optional day) or "a
 * while ago", with how many times for the last two. After saving it offers the survey, raised from the sheet's
 * `onDismiss` on iOS (a second Modal presented while one is dismissing is dropped).
 */
export function MarkSungSheet({ song, onClose }: { song: MarkSungSong | null; onClose(): void }) {
  const t = useTranslations('me.mark');
  const f = useFormatter();
  const [when, setWhen] = useState<When>('tonight');
  const now = new Date();
  const thisYear = now.getFullYear();
  const [year, setYear] = useState(thisYear);
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [day, setDay] = useState(0);
  const [times, setTimes] = useState(1);
  const [survey, setSurvey] = useState<{ id: string; song: MarkSungSong } | null>(null);
  const [surveyOpen, setSurveyOpen] = useState(false);
  const waiting = useRef(false);

  const monthName = (m: number) => {
    try {
      return f.dateTime(new Date(2000, m - 1, 1), { month: 'short' });
    } catch {
      return String(m);
    }
  };

  const save = () => {
    if (!song) return;
    const store = useLogStore.getState();
    let id: string | null;
    if (when === 'tonight') {
      const bar = useNightStore.getState().current()?.kind === 'other';
      id = bar
        ? store.addOther(song, 'sung')
        : store.addBackfill(song, { times: 1, date: `${thisYear}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`, precision: 'day' });
    } else if (when === 'date') {
      const d = Math.min(day, daysIn(year, month));
      id = store.addBackfill(song, {
        times,
        date: d > 0 ? `${year}-${pad(month)}-${pad(d)}` : `${year}-${pad(month)}`,
        precision: d > 0 ? 'day' : 'month',
      });
    } else {
      id = store.addBackfill(song, { times, precision: 'unknown' });
    }
    setWhen('tonight');
    setDay(0);
    setTimes(1);
    if (id) {
      setSurvey({ id, song });
      if (Platform.OS === 'ios') waiting.current = true;
      else setSurveyOpen(true);
    }
    onClose();
  };

  const onDismiss = () => {
    if (!waiting.current) return;
    waiting.current = false;
    setSurveyOpen(true);
  };

  const years = Array.from({ length: YEARS_BACK }, (_, i) => thisYear - i);
  return (
    <>
      <Sheet
        visible={song !== null && survey === null}
        onClose={onClose}
        onDismiss={onDismiss}
        title={t('title')}
        testID="mark-sung"
        closeLabel={t('close')}
      >
        {song ? (
          <View className="gap-4">
            <Text className="font-semibold" numberOfLines={2}>
              {isolate(t('song', { title: song.title, artist: song.artist }))}
            </Text>
            <View className="flex-row flex-wrap gap-2">
              <Chip testID="mark-when-tonight" label={t('tonight')} selected={when === 'tonight'} onPress={() => setWhen('tonight')} />
              <Chip testID="mark-when-date" label={t('onDate')} selected={when === 'date'} onPress={() => setWhen('date')} />
              <Chip testID="mark-when-ago" label={t('aWhileAgo')} selected={when === 'ago'} onPress={() => setWhen('ago')} />
            </View>
            {when === 'date' ? (
              <View className="gap-3">
                <View className="flex-row flex-wrap gap-2">
                  {years.map((y) => (
                    <Chip key={y} testID={`mark-year-${y}`} label={String(y)} selected={year === y} onPress={() => setYear(y)} />
                  ))}
                </View>
                <View className="flex-row flex-wrap gap-2">
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                    <Chip key={m} testID={`mark-month-${m}`} label={monthName(m)} selected={month === m} onPress={() => setMonth(m)} />
                  ))}
                </View>
                <Stepper
                  idPrefix="mark-day"
                  label={t('day')}
                  value={day}
                  display={day > 0 ? String(Math.min(day, daysIn(year, month))) : '–'}
                  onChange={setDay}
                  min={0}
                  max={daysIn(year, month)}
                />
              </View>
            ) : null}
            {when !== 'tonight' ? (
              <Stepper idPrefix="mark-times" label={t('times')} value={times} display={String(times)} onChange={setTimes} min={1} max={MAX_TIMES} />
            ) : null}
            <Button testID="mark-save" label={t('save')} onPress={save} />
          </View>
        ) : null}
      </Sheet>
      <SurveySheet
        entryId={surveyOpen && survey ? survey.id : null}
        artist={survey?.song.artist ?? ''}
        title={survey?.song.title ?? ''}
        onDone={() => {
          setSurveyOpen(false);
          setSurvey(null);
        }}
      />
    </>
  );
}
