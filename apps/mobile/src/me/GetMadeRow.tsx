import { isolate, useTranslations } from '@nomad/i18n';
import { Button, Text } from '@nomad/ui';
import { router, type Href } from 'expo-router';
import { Pressable, View } from 'react-native';

import { openSignIn } from '../auth/signInUi';
import { useAuth } from '../auth/store';
import { EMPTY_DRAFT, identifiedIntent, typedIntent, useMakeIntent } from '../make/intentStore';
import { artistLabel } from '../tonight/log/logStore';
import { useGetMadeLocal } from './getMadeLocal';
import { openSongHref } from './songHref';
import type { GetMadeRow as Row, RequestLimit } from './useGetMade';

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
  /** No connection: Make it and Request it free (both gen) are off. */
  offline: boolean;
  /** Make it is also off until the user's gen jobs are known (no second paid make of a made song). */
  makeDisabled: boolean;
  onRequest(row: Row): void;
  onDismiss(key: string): void;
};

function DismissButton({ testID, onPress }: { testID: string; onPress(): void }) {
  const t = useTranslations('me.getMade');
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={t('dismiss')}
      hitSlop={8}
      onPress={onPress}
      className="min-h-11 min-w-11 items-center justify-center"
    >
      <Text importantForAccessibility="no" className="text-lg text-muted">
        {'×'}
      </Text>
    </Pressable>
  );
}

/** The why chip, then the board line: "Requested · N votes" for the row the vote went to, else its vote count. */
function RowMeta({ row, prefix, i }: { row: Row; prefix: 'getmade' | 'me-getmade'; i: number }) {
  const t = useTranslations('me.getMade');
  const req = row.request;
  return (
    <View className="flex-row flex-wrap items-center gap-2">
      <View className="rounded-full border border-border px-2 py-0.5">
        <Text testID={`${prefix}-why-${i}`} className="text-sm">
          {t(`why.${row.why}`)}
        </Text>
      </View>
      {req?.kind === 'requested' ? (
        <Text testID={`${prefix}-status-${i}`} accessibilityLiveRegion="polite" className="text-sm">
          {t('requested', { count: req.votes })}
        </Text>
      ) : row.boardVotes !== null ? (
        <Text testID={`${prefix}-votes-${i}`} variant="muted" className="text-sm">
          {t('boardVotes', { count: row.boardVotes })}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * One Get this made song on the full screen: title, artist, why chip and board line, then Make it / Request it free
 * and a dismiss ×. Offline, Make it and Request it free are off (dismiss is queued, so it still works). When today's
 * free request is used up, the list shows that once (GetMadeLimitLine) and rows just drop Request it free.
 */
export function GetMadeRow({ row, index: i, offline, makeDisabled, onRequest, onDismiss }: Props) {
  const t = useTranslations('me.getMade');
  const tu = useTranslations('tonight.other');
  const signedIn = useAuth((s) => s.state.status === 'signedIn');
  const req = row.request;
  const canRequest = !req || req.kind === 'pending' || req.kind === 'error';

  return (
    <View testID={`getmade-row-${i}`} className="gap-2 rounded-xl border border-border bg-card p-3">
      <View className="flex-row items-start gap-2">
        <Pressable
          testID={`getmade-open-${i}`}
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
        <DismissButton testID={`getmade-dismiss-${i}`} onPress={() => onDismiss(row.key)} />
      </View>
      <RowMeta row={row} prefix="getmade" i={i} />
      {req?.kind === 'error' ? (
        <Text testID={`getmade-status-${i}`} accessibilityLiveRegion="polite" className="text-sm">
          {t('requestError')}
        </Text>
      ) : null}
      <View className="flex-row gap-2">
        <View className="flex-1">
          <Button testID={`getmade-make-${i}`} label={t('makeIt')} disabled={offline || makeDisabled} onPress={() => makeFromRow(row, signedIn)} />
        </View>
        {canRequest ? (
          <View className="flex-1">
            <Button
              testID={`getmade-request-${i}`}
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

/**
 * A compact Get this made row on the Me shelf (R28): title, artist, why chip, board line and ×, no action buttons.
 * Tapping it opens the full Get this made screen, where Make it and Request it free live.
 */
export function GetMadeShelfRow({ row, index: i, onDismiss }: { row: Row; index: number; onDismiss(key: string): void }) {
  const tu = useTranslations('tonight.other');
  // The meta line sits outside the pressable: iOS folds an accessible button's children into one element, and the
  // E2E flows (and screen readers) read the why chip and status on their own.
  return (
    <View testID={`me-getmade-${i}`} className="gap-1 rounded-xl border border-border bg-card px-3 py-2">
      <View className="flex-row items-center gap-2">
        <Pressable
          testID={`me-getmade-open-${i}`}
          accessibilityRole="button"
          onPress={() => router.push('/me/get-made' as Href)}
          className="min-h-11 flex-1 justify-center"
        >
          <Text className="font-semibold" numberOfLines={1}>
            {isolate(row.title)}
          </Text>
          <Text variant="muted" numberOfLines={1}>
            {isolate(artistLabel(row.artist, tu('unknownArtist')))}
          </Text>
        </Pressable>
        <DismissButton testID={`me-getmade-dismiss-${i}`} onPress={() => onDismiss(row.key)} />
      </View>
      <RowMeta row={row} prefix="me-getmade" i={i} />
    </View>
  );
}

/** The one line at the top of the list when today's free request is used up (R28), on the shelf and the screen. */
export function GetMadeLimitLine({ prefix, limit }: { prefix: 'getmade' | 'me-getmade'; limit: RequestLimit | null }) {
  const t = useTranslations('me.getMade.limit');
  if (!limit) return null;
  return (
    <Text testID={`${prefix}-limit`} accessibilityLiveRegion="polite" variant="muted">
      {t(limit === 'submission_limit' ? 'submission' : 'voteUsed')}
    </Text>
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
