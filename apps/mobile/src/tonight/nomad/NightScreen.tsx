import type { RotationEntry, Song } from '@nomad/api-kjbox';
import { useTranslations } from '@nomad/i18n';
import { Button, List, Screen, Text } from '@nomad/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, View } from 'react-native';

import { appStorage } from '../../storage';
import { singWebUrl } from '../links';
import { SurveySheet } from '../log/SurveySheet';
import { useMakeRowActions } from '../make/MakeRowActions';
import { MyNightPanel } from '../manage/MyNightPanel';
import { ReorderList } from '../manage/ReorderList';
import { ManageProvider, NoticeLine, useCancelSong, useNotice } from '../manage/SongActions';
import { useLogStore } from '../log/logStore';
import { useSurveyTrigger, type SurveyTarget } from '../log/useSurveyTrigger';
import { useNightStore, type NomadNight } from '../nightStore';
import { PreviewSheet } from '../preview/PreviewSheet';
import { usePreviewStore, type PreviewTarget } from '../preview/previewStore';
import { useEditingStore } from './editingStore';
import { Freshness, useTick } from './Freshness';
import { entryIdOf, isLive, songKey, songParts } from './model';
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
import { TurnBanner } from './TurnBanner';
import { Unreachable } from './Unreachable';
import { useTurnAlerts } from './useTurnAlerts';
import { VenueInfo } from './VenueInfo';
import { YourSongs } from './YourSongs';

export { singWebUrl } from '../links';

export type NightScreenProps = SongRowActions & {
  night: NomadNight;
  /** The Tonight tab is focused (polling runs only then, ruling E4-R3). */
  focused: boolean;
  /** E5: open the request flow. */
  onRequest?: () => void;
  /** Enter reorder mode (default: the in-screen ▲/▼ list, ruling E6-R3). */
  onReorder?: () => void;
  /** ▶ on a rotation row (default: the in-app preview sheet, E10). */
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
  const tTonight = useTranslations('tonight');
  const tManage = useTranslations('tonight.manage');
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

  // Managing songs (E6): cancel with a 15 s notice, reorder mode, name/phone/friend/tips, per-song consent.
  const { notice, show: notify } = useNotice();
  const { hidden, cancel } = useCancelSong(night, userKey, notify);
  // Make-it rows (E7): "Review it now" opens the native review; "⚡ Sing it now" asks, then uses the quick version.
  const makeRow = useMakeRowActions(night, userKey, notify);
  const [reordering, setReordering] = useState(false);

  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    if (reordering) return; // rows must not move under the singer's finger (ruling E6-R3)
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
  const sheetOpen = useEditingStore((s) => s.sheets > 0);
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

  // Turn awareness (spec §4.4, ruling E10-R3): haptic + banner at "up next" and "you're on", foreground only.
  const someoneOnStage = Boolean(now.data?.now_singing);
  const turn = useTurnAlerts(me.data, me.dataUpdatedAt, userKey, night.nightId, someoneOnStage);

  // Previews (spec §4.1 Preview, ruling E10-R1/R2): Your songs ▶, the quick version ▶ and rotation ▶ open the sheet.
  const preview = (target: Omit<PreviewTarget, 'owner'>) =>
    void usePreviewStore.getState().open(night.code, night.nightId, { ...target, owner: 'night' });
  const songPreview = (source: 'entry' | 'entry_quick') => (song: Song) => {
    const entryId = entryIdOf(song);
    if (entryId == null) return;
    const { title, artist } = songParts(song.request);
    preview({ source, entryId, title, artist });
  };
  const actions = {
    ...rowActions,
    onCancel: rowActions.onCancel ?? ((song: Song) => void cancel(song)),
    onPreview: rowActions.onPreview ?? songPreview('entry'),
    onQuickPreview: rowActions.onQuickPreview ?? songPreview('entry_quick'),
    onReview: rowActions.onReview ?? makeRow.onReview,
    onSingQuick: rowActions.onSingQuick ?? makeRow.onSingQuick,
  };
  const previewEntry =
    onPreviewEntry ?? ((e: RotationEntry) => preview({ source: 'entry', entryId: e.entry_id, title: e.song_artist }));

  const tick = useTick(5_000);
  const rotationData = rotation.data;
  const elapsedS = rotationData ? Math.max(0, Math.floor((tick - rotationData.receivedAt) / 1000)) : 0;
  const entries = useMemo(() => visibleRotation(rotationData?.result.entries ?? []), [rotationData]);

  if (over) return <Screen testID="tonight-night">{null}</Screen>;

  const unreachable = isUnreachable(me.error);
  const data = me.data;
  const songs = (data?.songs ?? []).filter((s) => !dismissed.has(songKey(s)) && !hidden.has(songKey(s)));
  const nightInfo = info.data?.open ? info.data : null;
  const closed = pausedInfo;
  const readOnly = unreachable || pausedByError || closed !== null;
  const manage = {
    night,
    userKey,
    readOnly,
    askConsent: Boolean(nightInfo?.features.ask_photo_consent),
    profile: data?.me ?? null,
    allSongs: [...songs, ...(data?.sung_tonight ?? [])],
    notify,
  };
  const hasOwnSongs = songs.some((s) => s.owner === 'me' && isLive(s));

  const header = (
    <View className="gap-4 pb-2">
      {/* The tab's heading, as on the empty state (UX review: the screen opened on "Updated just now"). */}
      <Text testID="tonight-night-title" variant="title">
        {tTonight('title')}
      </Text>
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
          <Freshness updatedAt={me.dataUpdatedAt} onRefresh={() => void refresh()} refreshing={refreshing} disabled={reordering} />
          <NoticeLine notice={notice} />
          {reordering && !readOnly ? (
            <ReorderList
              night={night}
              userKey={userKey}
              songs={songs}
              onDone={(result) => {
                setReordering(false);
                if (result) notify(tManage(result === 'saved' ? 'reorder.saved' : 'reorder.requested'));
              }}
            />
          ) : (
            <YourSongs
              songs={songs}
              readOnly={readOnly}
              onDismiss={dismiss}
              someoneOnStage={someoneOnStage}
              onRequest={onRequest}
              onReorder={onReorder ?? (() => setReordering(true))}
              {...actions}
            />
          )}
          {!readOnly && !reordering ? (
            <MyNightPanel
              night={night}
              userKey={userKey}
              profile={data.me}
              hasOwnSongs={hasOwnSongs}
              tips={Boolean(nightInfo?.features.tips)}
              notify={notify}
            />
          ) : null}
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
    <ManageProvider value={manage}>
      <Screen testID="tonight-night">
        {/* Above the list, not in its header: the banner must show however far down the singer has scrolled. */}
        {turn.alert ? <TurnBanner alert={turn.alert} onDismiss={turn.dismiss} /> : null}
        <List
          testID="tonight-night-list"
          data={entries}
          keyExtractor={(e) => String(e.entry_id)}
          renderItem={(e) => <RotationRow entry={e} elapsedS={elapsedS} onPreview={previewEntry} />}
          extraData={elapsedS}
          ListHeaderComponent={header}
          ListFooterComponent={nightInfo ? <VenueInfo night={nightInfo} /> : undefined}
          refreshing={refreshing}
          onRefresh={reordering ? undefined : () => void refresh()}
        />
        <PreviewSheet owner="night" focused={focused} />
        {makeRow.sheet}
        <SurveySheet
          entryId={survey?.entryId ?? null}
          artist={survey?.artist ?? ''}
          title={survey?.title ?? ''}
          initial={previous ?? undefined}
          onDone={() => setManual(null)}
        />
      </Screen>
    </ManageProvider>
  );
}
