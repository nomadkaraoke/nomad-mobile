import { isolate, useTranslations } from '@nomad/i18n';
import { Button, Text } from '@nomad/ui';
import { router } from 'expo-router';
import { Pressable, View } from 'react-native';

import { openSignIn } from '../auth/signInUi';
import { useAuth } from '../auth/store';
import { EMPTY_DRAFT, identifiedIntent, typedIntent, useMakeIntent } from '../make/intentStore';
import { artistLabel } from '../tonight/log/logStore';
import { useGetMadeLocal } from './getMadeLocal';
import { openSongHref } from './songHref';
import type { GetMadeRow as Row } from './useGetMade';

/** "Make it": decide's identified song when it has a song_key, else the typed artist/title (a `u:` song). */
export function makeFromRow(row: Pick<Row, 'artist' | 'title' | 'song_key'>, signedIn: boolean): void {
  useMakeIntent
    .getState()
    .set(
      row.song_key
        ? identifiedIntent({ artist: row.artist, title: row.title, song_key: row.song_key })
        : typedIntent({ ...EMPTY_DRAFT, artist: row.artist, title: row.title }),
    );
  if (signedIn) router.push('/make/new');
  else openSignIn('/make/new');
}

type Props = {
  row: Row;
  index: number;
  /** testID prefix: `getmade` on the full screen, `me-getmade` on the Me shelf. */
  prefix: 'getmade' | 'me-getmade';
  offline: boolean;
  onRequest(row: Row): void;
  onDismiss(key: string): void;
};

/**
 * One Get this made song: title, artist, why chip and board votes, then Make it / Request it free and a dismiss ×.
 * Offline, Make it and Request it free are off (dismiss is queued, so it still works).
 */
export function GetMadeRow({ row, index: i, prefix, offline, onRequest, onDismiss }: Props) {
  const t = useTranslations('me.getMade');
  const tu = useTranslations('tonight.other');
  const signedIn = useAuth((s) => s.state.status === 'signedIn');
  const rowID = prefix === 'getmade' ? `getmade-row-${i}` : `me-getmade-${i}`;
  const req = row.request;
  let status: string | null = null;
  if (req?.kind === 'requested') status = t('requested', { count: req.votes });
  else if (req?.kind === 'vote_used') status = t('voteUsed');
  else if (req?.kind === 'submission_limit') status = t('submissionLimit');
  else if (req?.kind === 'error') status = t('requestError');
  const canRequest = !req || req.kind === 'pending' || req.kind === 'error';

  return (
    <View testID={rowID} className="gap-2 rounded-xl border border-border bg-card p-3">
      <View className="flex-row items-start gap-2">
        <Pressable
          testID={`${prefix}-open-${i}`}
          accessibilityRole="button"
          onPress={() => openSongHref({ key: row.key, song_key: row.song_key ?? null, artist: row.artist, title: row.title })}
          className="min-h-11 flex-1 justify-center"
        >
          <Text className="font-semibold" numberOfLines={1}>
            {isolate(row.title)}
          </Text>
          <Text variant="muted" numberOfLines={1}>
            {isolate(artistLabel(row.artist, tu('unknownArtist')))}
          </Text>
        </Pressable>
        <Pressable
          testID={`${prefix}-dismiss-${i}`}
          accessibilityRole="button"
          accessibilityLabel={t('dismiss')}
          hitSlop={8}
          onPress={() => onDismiss(row.key)}
          className="min-h-11 min-w-11 items-center justify-center"
        >
          <Text importantForAccessibility="no" className="text-lg text-muted">
            {'×'}
          </Text>
        </Pressable>
      </View>
      <View className="flex-row flex-wrap items-center gap-2">
        <View className="rounded-full border border-border px-2 py-0.5">
          <Text testID={`${prefix}-why-${i}`} className="text-sm">
            {t(`why.${row.why}`)}
          </Text>
        </View>
        {row.boardVotes !== null && req?.kind !== 'requested' ? (
          <Text testID={`${prefix}-votes-${i}`} variant="muted" className="text-sm">
            {t('boardVotes', { count: row.boardVotes })}
          </Text>
        ) : null}
      </View>
      {status ? (
        <Text testID={`${prefix}-status-${i}`} accessibilityLiveRegion="polite" className="text-sm">
          {status}
        </Text>
      ) : null}
      <View className="flex-row gap-2">
        <View className="flex-1">
          <Button testID={`${prefix}-make-${i}`} label={t('makeIt')} disabled={offline} onPress={() => makeFromRow(row, signedIn)} />
        </View>
        {canRequest ? (
          <View className="flex-1">
            <Button
              testID={`${prefix}-request-${i}`}
              label={t('request')}
              variant="secondary"
              disabled={offline}
              loading={req?.kind === 'pending'}
              onPress={() => onRequest(row)}
            />
          </View>
        ) : null}
      </View>
    </View>
  );
}

/** "Hidden · Undo" for the last dismissed row (5 s), on the shelf and the screen. */
export function GetMadeUndoToast({ prefix, onUndo }: { prefix: 'getmade' | 'me-getmade'; onUndo(key: string): void }) {
  const t = useTranslations('me.getMade');
  const toast = useGetMadeLocal((s) => s.toast);
  if (!toast) return null;
  return (
    <View
      testID={`${prefix}-toast`}
      accessibilityLiveRegion="polite"
      className="flex-row items-center gap-3 rounded-xl border border-border bg-card p-3"
    >
      <Text className="flex-1">{t('hiddenToast')}</Text>
      <Pressable testID={`${prefix}-undo`} accessibilityRole="button" hitSlop={8} onPress={() => onUndo(toast)} className="min-h-11 justify-center">
        <Text className="font-bold text-primary">{t('undo')}</Text>
      </Pressable>
    </View>
  );
}
