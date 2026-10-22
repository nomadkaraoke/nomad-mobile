import type { RotationEntry, Song } from '@nomad/api-kjbox';
import { useTranslations } from '@nomad/i18n';
import { Button, List, Screen, Text } from '@nomad/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, View } from 'react-native';

import { appStorage } from '../../storage';
import { SurveySheet } from '../log/SurveySheet';
import { useLogStore } from '../log/logStore';
import { useSurveyTrigger, type SurveyTarget } from '../log/useSurveyTrigger';
import { useNightStore, type NomadNight } from '../nightStore';
import { useEditingStore } from './editingStore';
import { Freshness, useTick } from './Freshness';
import { songKey } from './model';
import {
  isNightOver,
  isNotOpen,
  isUnreachable,
  nightGone,
  nightPaused,
  useMe,
  useNightInfo,
  useNow,
  usePollingActive,
  useRotation,
} from './queries';
import { RotationHeader, RotationRow, visibleRotation } from './RotationList';
import type { SongRowActions } from './SongRow';
import { StageTile, StatusTile } from './StatusTile';
import { SungTonight } from './SungTonight';
import { Unreachable } from './Unreachable';
import { VenueInfo } from './VenueInfo';
import { YourSongs } from './YourSongs';

/** The singer's web page for this event code (ruling E4-R5: "Save tonight's songs" links web requests to the account). */
export const singWebUrl = (code: string) => `https://sing.nomadkaraoke.com/?t=${encodeURIComponent(code)}`;

export type NightScreenProps = SongRowActions & {
  night: NomadNight;
  /** The Tonight tab is focused (polling runs only then, ruling E4-R3). */
  focused: boolean;
  /** E5: open the request flow. */
  onRequest?: () => void;
  /** E6: enter reorder mode. */
  onReorder?: () => void;
  /** E6: ▶ on a rotation row. */
  onPreviewEntry?: (entry: RotationEntry) => void;
};

const dismissedKey = (userKey: string | null, nightId: string) => `tonight.dismissed.v1.${userKey ?? 'anon'}.${nightId}`;

function loadDismissed(key: string): Set<string> {
  try {
    const raw = appStorage.getString(key);
    const v: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

/**
 * The Nomad-night home (spec §4.1): status tile, Your songs, sung tonight, now on stage, the rotation and venue info.
 * Paints cached data first and refreshes in place; polls only while visible; ends the night on night_changed or a
 * code that stopped working (rulings E4-R1, E4-R6); while requests are paused, keeps the night with the host's
 * message and watches GET /night every 60 s; keeps the last-known songs read-only when the box is unreachable (E4-R2).
 */
export function NightScreen({ night, focused, onRequest, onReorder, onPreviewEntry, ...rowActions }: NightScreenProps) {
  const t = useTranslations('tonight.night');
  const userKey = useNightStore((s) => s.userKey);
  const active = usePollingActive(focused);
  const me = useMe(night, userKey, active);
  const now = useNow(night, userKey, active);
  const rotation = useRotation(night, userKey, active);
  // Ruling E4-R6: a 403 not_open stopped these polls (nextPollDelay). GET /night says why: bad_code ends the night;
  // closed / no_night (E4-R7) keep it; open with this night's id resumes them.
  const notOpen = [me, now, rotation].filter((q) => isNotOpen(q.error));
  const pausedByError = notOpen.length > 0;
  const pausedSince = Math.max(0, ...notOpen.map((q) => q.errorUpdatedAt));
  const info = useNightInfo(night, userKey, active, pausedByError);
  const pausedInfo = nightPaused(info.data);

  useEffect(() => {
    if (pausedByError) void info.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refetch is stable; only the pause edge matters
  }, [pausedByError]);

  // Resume only on a /night answer newer than the not_open, so a failed resume waits for the next /night poll.
  const reopened = pausedByError && info.data?.open === true && info.data.night_id === night.nightId && info.dataUpdatedAt > pausedSince;
  useEffect(() => {
    if (!reopened) return;
    for (const q of [me, now, rotation]) if (isNotOpen(q.error)) void q.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per newer /night answer
  }, [reopened, info.dataUpdatedAt]);

  // Rulings E4-R1/R6, Review Focus 2: the box moved on (new night, or the code stopped working). Leave this night:
  // the Tonight tab then shows the empty state, never yesterday's songs. Polling already stopped (nextPollDelay).
  const over = [me.error, now.error, rotation.error, info.error].some(isNightOver) || nightGone(info.data, night.nightId);
  useEffect(() => {
    if (!over) return;
    const cur = useNightStore.getState().current();
    if (cur?.kind === 'nomad' && cur.nightId === night.nightId) useNightStore.getState().end();
  }, [over, night.nightId]);

  // Coming back (focus or foreground, or the end of an edit): refresh at once instead of waiting for the next tick.
  const wasActive = useRef(active);
  useEffect(() => {
    if (active && !wasActive.current) {
      // Paused requests: only /night may be asked (E4-R6); it resumes the rest.
      if (pausedByError) void info.refetch();
      else {
        void me.refetch();
        void now.refetch();
        void rotation.refetch();
      }
    }
    wasActive.current = active;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refetch fns are stable; only the active edge matters
  }, [active]);

  const storageKey = dismissedKey(userKey, night.nightId);
  const [dismissed, setDismissed] = useState(() => loadDismissed(storageKey));
  const dismiss = (song: Song) => {
    const next = new Set(dismissed).add(songKey(song));
    setDismissed(next);
    appStorage.set(storageKey, JSON.stringify([...next]));
  };

  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([me.refetch(), now.refetch(), rotation.refetch(), info.refetch()]);
    } finally {
      setRefreshing(false);
    }
  };

  // Post-song survey (spec §6.3, ruling E8-R3): once per newly sung song with a history_id, while this screen shows
  // and no other sheet or edit is in the way. "How did it go?" on a sung row reopens it for that song.
  const editing = useEditingStore((s) => s.editing);
  const sheetOpen = useEditingStore((s) => s.sheetOpen);
  const [manual, setManual] = useState<SurveyTarget | null>(null);
  const auto = useSurveyTrigger(me.data?.sung_tonight, focused && !editing && !sheetOpen && !manual, night.nightId);
  const survey = manual ?? auto;
  const previous = useLogStore((s) => (survey ? s.entries[survey.entryId]?.survey : undefined));
  const openSurvey = (song: Song) => {
    if (!song.history_id) return;
    const target = { entryId: song.history_id, artist: song.request.song_artist, title: song.request.song_title };
    useLogStore.getState().noteNomad(target.entryId, { artist: target.artist, title: target.title, nightId: night.nightId });
    setManual(target);
  };

  const tick = useTick(5_000);
  const rotationData = rotation.data;
  const elapsedS = rotationData ? Math.max(0, Math.floor((tick - rotationData.receivedAt) / 1000)) : 0;
  const entries = useMemo(() => visibleRotation(rotationData?.result.entries ?? []), [rotationData]);

  if (over) return <Screen testID="tonight-night">{null}</Screen>;

  const unreachable = isUnreachable(me.error);
  const data = me.data;
  const songs = (data?.songs ?? []).filter((s) => !dismissed.has(songKey(s)));
  const nightInfo = info.data?.open ? info.data : null;
  const closed = pausedInfo;
  const readOnly = unreachable || pausedByError || closed !== null;

  const header = (
    <View className="gap-4 pb-2">
      {unreachable ? <Unreachable hasSongs={songs.length > 0} /> : null}
      {closed ? (
        <View testID="tonight-closed" className="gap-1 rounded-xl border border-border bg-card p-4">
          <Text>{t('closed')}</Text>
          {closed.footer_message ? <Text variant="muted">{closed.footer_message}</Text> : null}
        </View>
      ) : null}
      {data ? (
        <>
          <StatusTile me={{ ...data, songs }} now={now.data} />
          {!readOnly && data.unlinked_identity_entries > 0 ? (
            <View testID="tonight-unlinked-hint" className="gap-2 rounded-xl border border-border bg-card p-4">
              <Text>{t('unlinked.message')}</Text>
              <Button
                testID="tonight-unlinked-open"
                variant="secondary"
                label={t('unlinked.open')}
                onPress={() => void Linking.openURL(singWebUrl(night.code))}
              />
            </View>
          ) : null}
          <Freshness updatedAt={me.dataUpdatedAt} onRefresh={() => void refresh()} refreshing={refreshing} />
          <YourSongs
            songs={songs}
            readOnly={readOnly}
            onDismiss={dismiss}
            onRequest={onRequest}
            onReorder={onReorder}
            {...rowActions}
          />
          <SungTonight songs={data.sung_tonight} onSurvey={openSurvey} />
        </>
      ) : me.isPending ? (
        // Same size as the status tile, so nothing jumps when the first read lands (A.44).
        <View testID="tonight-loading" className="h-28 rounded-xl border border-border bg-card" />
      ) : !unreachable && !pausedByError ? (
        <View testID="tonight-error" className="gap-2">
          <Text variant="error">{t('loadFailed')}</Text>
          <Button testID="tonight-retry" variant="secondary" label={t('retry')} onPress={() => void refresh()} />
        </View>
      ) : null}
      {now.data ? <StageTile now={now.data} /> : null}
      {rotationData ? <RotationHeader empty={entries.length === 0} /> : null}
    </View>
  );

  return (
    <Screen testID="tonight-night">
      <List
        testID="tonight-night-list"
        data={entries}
        keyExtractor={(e) => String(e.entry_id)}
        renderItem={(e) => <RotationRow entry={e} elapsedS={elapsedS} onPreview={onPreviewEntry} />}
        extraData={elapsedS}
        ListHeaderComponent={header}
        ListFooterComponent={nightInfo ? <VenueInfo night={nightInfo} /> : undefined}
        refreshing={refreshing}
        onRefresh={() => void refresh()}
      />
      <SurveySheet
        entryId={survey?.entryId ?? null}
        artist={survey?.artist ?? ''}
        title={survey?.title ?? ''}
        initial={previous ?? undefined}
        onDone={() => setManual(null)}
      />
    </Screen>
  );
}
