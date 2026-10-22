import { useTranslations } from '@nomad/i18n';
import { Button, Text, TextField } from '@nomad/ui';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { SurveySheet } from '../log/SurveySheet';
import { artistLabel, useLogStore, type LogEntry, type LogState } from '../log/logStore';
import { useNightStore, type OtherNight } from '../nightStore';
import { TonightSheet } from '../TonightSheet';
import { LogRow } from './LogRow';
import { useMyJobsForLinks } from './YouTubeLink';

/** The route that adds a song to tonight's log (AddSong). */
export const ADD_ROUTE = '/tonight/add';

type Group = 'sung' | 'requested' | 'planned';
const GROUPS: Group[] = ['sung', 'requested', 'planned'];
const groupOf = (s: LogState): Group => (s === 'sung' ? 'sung' : s === 'requested' ? 'requested' : 'planned');

/** Tonight's entries by group, newest change first (ruling E9-R3). */
export function groupEntries(entries: Record<string, LogEntry>, nightId: string): Record<Group, LogEntry[]> {
  const out: Record<Group, LogEntry[]> = { sung: [], requested: [], planned: [] };
  for (const e of Object.values(entries)) if (e.night?.id === nightId) out[groupOf(e.state)].push(e);
  for (const g of GROUPS) out[g].sort((a, b) => b.updatedAt - a.updatedAt);
  return out;
}

/**
 * Tonight at any other bar (spec §6.2): a personal log of what the singer plans, requests and sings, with the
 * post-song survey and YouTube links. Everything is local first and syncs to decide through the outbox.
 */
export function OtherNightScreen({ night }: { night: OtherNight }) {
  const t = useTranslations('tonight.other');
  const entries = useLogStore((s) => s.entries);
  const groups = useMemo(() => groupEntries(entries, night.nightId), [entries, night.nightId]);
  const jobs = useMyJobsForLinks();
  const [venue, setVenue] = useState(night.venueName ?? '');
  const [survey, setSurvey] = useState<LogEntry | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const empty = GROUPS.every((g) => groups[g].length === 0);

  return (
    <View testID="other-night-screen" className="flex-1 bg-bg">
      <ScrollView contentContainerClassName="gap-4 p-4 pb-24" keyboardShouldPersistTaps="handled">
        <Text variant="title">{t('title')}</Text>
        <TextField
          testID="other-venue"
          label={t('venueLabel')}
          placeholder={t('venuePlaceholder')}
          value={venue}
          onChangeText={(v) => {
            setVenue(v);
            useNightStore.getState().renameOther(v);
          }}
          autoCapitalize="words"
        />
        <Button testID="other-add" label={t('addSong')} onPress={() => router.push(ADD_ROUTE as never)} />
        {empty ? (
          <Text testID="other-empty" variant="muted">
            {t('empty')}
          </Text>
        ) : null}
        {GROUPS.map((g) =>
          groups[g].length ? (
            <View key={g} testID={`other-group-${g}`} className="gap-2">
              <Text className="font-semibold">{t(`group.${g}`, { count: groups[g].length })}</Text>
              {groups[g].map((e) => (
                <LogRow key={e.id} entry={e} jobs={jobs} onSurvey={setSurvey} />
              ))}
            </View>
          ) : null,
        )}
        <Button testID="other-end" variant="secondary" label={t('endNight')} onPress={() => setConfirmEnd(true)} />
      </ScrollView>
      <SurveySheet
        entryId={survey?.id ?? null}
        artist={artistLabel(survey?.artist ?? '', t('unknownArtist'))}
        title={survey?.title ?? ''}
        initial={survey ? useLogStore.getState().entries[survey.id]?.survey : undefined}
        onDone={() => {
          setSurvey(null);
          // A saved (or skipped) survey is activity: the night stays open (ruling E9-R3).
          useNightStore.getState().touch();
        }}
      />
      <TonightSheet visible={confirmEnd} onClose={() => setConfirmEnd(false)} title={t('endTitle')} testID="other-end-sheet" closeLabel={t('close')}>
        <View className="gap-3 pb-2">
          <Text variant="muted">{t('endBody')}</Text>
          <Button
            testID="other-end-confirm"
            label={t('endNight')}
            onPress={() => {
              setConfirmEnd(false);
              useNightStore.getState().end();
            }}
          />
          <Button testID="other-end-cancel" variant="secondary" label={t('keepLogging')} onPress={() => setConfirmEnd(false)} />
        </View>
      </TonightSheet>
    </View>
  );
}
