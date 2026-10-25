import { listSongHistory, type KaraokeLogEntry, type Survey } from '@nomad/api-decide';
import { libraryKey as toLibraryKey } from '@nomad/core';
import { isolate, useFormatter, useTranslations } from '@nomad/i18n';
import { Text } from '@nomad/ui';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';

import { useAuth } from '../auth/store';
import { artistLabel, useLogStore, type LogEntry } from '../tonight/log/logStore';
import { useOutbox } from '../tonight/log/outbox';
import { SurveySheet } from '../tonight/log/SurveySheet';
import { useLogMirror } from './useLogMirror';

const entryKey = (e: { artist?: string; title?: string; song_key?: string | null; song_key_status?: string }) =>
  toLibraryKey(e.artist ?? '', e.title ?? '', e.song_key_status === 'resolved' ? (e.song_key ?? null) : null);
const counts = (state?: string | null) => state === 'sung' || state === 'sung_unplayed';

/** A local log entry as a mirror-shaped record (its song_key is trusted, as the library overlay does). */
const fromLocal = (e: LogEntry): KaraokeLogEntry => ({
  id: e.id,
  user_id: '',
  source: e.source,
  state: e.state,
  artist: e.artist,
  title: e.title,
  song_key: e.song_key ?? null,
  song_key_status: e.song_key ? 'resolved' : 'unresolved',
  night: e.night ?? null,
  sung_at: e.sung_at ?? null,
  survey: e.survey ?? null,
  times: e.times,
  origin: e.origin ?? null,
});

/**
 * Every record of one song: the phone's mirror of the log (offline-first), else decide's per-song list, with the
 * records still queued in Tonight's outbox applied (a just-marked song shows at once; a queued delete hides it).
 */
export function useSongHistory(libraryKey: string): KaraokeLogEntry[] {
  const signedIn = useAuth((s) => s.state.status === 'signedIn');
  const { entries: mirror } = useLogMirror();
  const local = useLogStore((s) => s.entries);
  const queued = useOutbox((s) => s.items);
  const remote = useQuery({
    queryKey: ['decide', 'song-history', libraryKey],
    queryFn: () => listSongHistory(libraryKey),
    enabled: signedIn && mirror.length === 0,
    retry: false,
  });
  return useMemo(() => {
    const base = mirror.length > 0 ? mirror.filter((e) => entryKey(e) === libraryKey) : (remote.data ?? []);
    const byId = new Map(base.map((e) => [e.id, e]));
    for (const e of Object.values(local)) {
      if (!byId.has(e.id) && entryKey(fromLocal(e)) === libraryKey) byId.set(e.id, fromLocal(e));
    }
    const deleted = new Set(queued.filter((q) => q.op === 'delete').map((q) => q.id));
    const out: KaraokeLogEntry[] = [];
    for (const e of byId.values()) {
      if (e.deleted || deleted.has(e.id) || !counts(e.state)) continue;
      const patch = queued.find((q) => q.op === 'put' && q.id === e.id);
      const survey = patch?.op === 'put' ? (patch.patch.survey as Survey | undefined) : undefined;
      out.push(survey ? { ...e, survey: { ...e.survey, ...survey } } : e);
    }
    const when = (e: KaraokeLogEntry) => Date.parse(e.sung_at ?? e.night?.date ?? e.created_at ?? '') || 0;
    return out.sort((a, b) => when(b) - when(a));
  }, [mirror, remote.data, local, queued, libraryKey]);
}

function useWhen() {
  const t = useTranslations('song.history');
  const f = useFormatter();
  return (e: KaraokeLogEntry): string | null => {
    const n = e.night;
    const raw = n?.date ?? (e.origin === 'backfill' ? null : e.sung_at);
    const precision = n?.date_precision ?? 'day';
    if (!raw || precision === 'unknown') return e.origin === 'backfill' ? t('beforeApp') : null;
    try {
      // A full timestamp is an instant: format it in local time (slicing to its UTC day could be the wrong day).
      // A bare YYYY[-MM[-DD]] is a calendar date: build it locally.
      const [y, m, d] = raw.slice(0, 10).split('-').map(Number);
      const date = raw.length > 10 ? new Date(raw) : new Date(y!, (m ?? 1) - 1, d ?? 1);
      if (precision === 'year') return f.dateTime(date, { year: 'numeric' });
      if (precision === 'month') return f.dateTime(date, { month: 'long', year: 'numeric' });
      return f.dateTime(date, { dateStyle: 'medium' });
    } catch {
      return raw;
    }
  };
}

/** Your history with one song: when and where you sang it, how it went, with Edit (the survey) and Remove. */
export function SongHistory({ libraryKey }: { libraryKey: string }) {
  const t = useTranslations('song.history');
  const ts = useTranslations('tonight.survey');
  const tc = useTranslations('common');
  const tu = useTranslations('tonight.other');
  const records = useSongHistory(libraryKey);
  const when = useWhen();
  const [editing, setEditing] = useState<KaraokeLogEntry | null>(null);
  if (records.length === 0) return null;

  const remove = (e: KaraokeLogEntry) =>
    Alert.alert(t('removeTitle'), t('removeBody'), [
      { text: tc('cancel'), style: 'cancel' },
      { text: t('remove'), style: 'destructive', onPress: () => useLogStore.getState().remove(e.id) },
    ]);

  return (
    <View testID="song-history" className="gap-2">
      <Text variant="title" className="text-base">
        {t('title')}
      </Text>
      {records.map((e) => {
        const date = when(e);
        const s = e.survey;
        const venue = e.night?.kind === 'nomad' ? t('nomadNight') : e.night?.venue_name ? isolate(e.night.venue_name) : null;
        const bits = [
          s?.feel ? t('feel', { value: ts(`feel.${s.feel}`) }) : null,
          s?.key ? t('key', { value: ts(`key.${s.key}`) }) : null,
          s?.crowd_pleaser ? t('crowd') : null,
          ...(s?.vibes ?? []).map((v) => ts(`vibe.${v}`)),
          ...(s?.reasons ?? []).map((r) => ts(`reason.${r}`)),
        ].filter((x): x is string => !!x);
        const head = [date, e.times && e.times > 1 ? t('times', { count: e.times }) : null].filter(Boolean).join(' ');
        return (
          <View key={e.id} testID={`song-history-${e.id}`} className="gap-1 rounded-xl border border-border bg-card p-3">
            {head ? <Text className="font-semibold">{head}</Text> : null}
            {venue ? <Text variant="muted">{venue}</Text> : null}
            {bits.length ? <Text>{bits.join(' · ')}</Text> : null}
            {s?.notes ? <Text variant="muted">{s.notes}</Text> : null}
            <View className="flex-row gap-4">
              <Pressable testID={`song-history-edit-${e.id}`} accessibilityRole="button" onPress={() => setEditing(e)} className="min-h-11 justify-center">
                <Text className="font-bold text-primary">{t('edit')}</Text>
              </Pressable>
              <Pressable testID={`song-history-remove-${e.id}`} accessibilityRole="button" onPress={() => remove(e)} className="min-h-11 justify-center">
                <Text className="font-bold text-primary">{t('remove')}</Text>
              </Pressable>
            </View>
          </View>
        );
      })}
      <SurveySheet
        entryId={editing?.id ?? null}
        artist={artistLabel(editing?.artist ?? '', tu('unknownArtist'))}
        title={editing?.title ?? ''}
        initial={editing?.survey ?? {}}
        onDone={() => setEditing(null)}
      />
    </View>
  );
}
