import type { RotationEntry, Song } from '@nomad/api-kjbox';
import { useTranslations } from '@nomad/i18n';
import { Button, List, Screen, Text } from '@nomad/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, View } from 'react-native';

import { appStorage } from '../../storage';
import { useNightStore, type NomadNight } from '../nightStore';
import { Freshness, useTick } from './Freshness';
import { songKey } from './model';
import {
  isNightOver,
  isUnreachable,
  nightGone,
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
 * Paints cached data first and refreshes in place; polls only while visible; ends the night on night_changed /
 * not_open (ruling E4-R1); keeps the last-known songs read-only when the box is unreachable (ruling E4-R2).
 */
export function NightScreen({ night, focused, onRequest, onReorder, onPreviewEntry, ...rowActions }: NightScreenProps) {
  const t = useTranslations('tonight.night');
  const userKey = useNightStore((s) => s.userKey);
  const active = usePollingActive(focused);
  const me = useMe(night, userKey, active);
  const now = useNow(night, userKey, active);
  const rotation = useRotation(night, userKey, active);
  const info = useNightInfo(night, userKey, active);

  // Ruling E4-R1 / Review Focus 2: the box moved on (new night, or the code stopped working). Leave this night: the
  // Tonight tab then shows the empty state, never yesterday's songs. Polling already stopped (nextPollDelay).
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
      void me.refetch();
      void now.refetch();
      void rotation.refetch();
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

  const tick = useTick(5_000);
  const rotationData = rotation.data;
  const elapsedS = rotationData ? Math.max(0, Math.floor((tick - rotationData.receivedAt) / 1000)) : 0;
  const entries = useMemo(() => visibleRotation(rotationData?.result.entries ?? []), [rotationData]);

  if (over) return <Screen testID="tonight-night">{null}</Screen>;

  const unreachable = isUnreachable(me.error);
  const data = me.data;
  const songs = (data?.songs ?? []).filter((s) => !dismissed.has(songKey(s)));
  const nightInfo = info.data?.open ? info.data : null;
  const closed = info.data && !info.data.open && info.data.reason === 'closed' ? info.data : null;

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
          {!unreachable && data.unlinked_identity_entries > 0 ? (
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
            readOnly={unreachable}
            onDismiss={dismiss}
            onRequest={onRequest}
            onReorder={onReorder}
            {...rowActions}
          />
          <SungTonight songs={data.sung_tonight} />
        </>
      ) : me.isPending ? (
        // Same size as the status tile, so nothing jumps when the first read lands (A.44).
        <View testID="tonight-loading" className="h-28 rounded-xl border border-border bg-card" />
      ) : !unreachable ? (
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
    </Screen>
  );
}
