import { getSongDetail, type SongDetail } from '@nomad/api-decide';
import { offlineSongGroup } from '@nomad/core';
import { useTranslations } from '@nomad/i18n';
import { ArtTile, Button, Screen, Text, TextField } from '@nomad/ui';
import { useQueries, useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, type ReactNode } from 'react';
import { ActivityIndicator, Linking, View } from 'react-native';

import { openSignIn } from '../../auth/signInUi';
import { useAuth } from '../../auth/store';
import { VersionList } from '../../find/components/VersionList';
import { mergeVersionSets } from '../../find/outcome';
import { logEvent } from '../../find/searchSession';
import { toGroup } from '../../find/useSearch';
import { identifiedIntent, typedIntent, useMakeIntent, type MakeIntent } from '../../make/intentStore';
import { useOffline } from '../../net/useOffline';
import { openOfflineReader } from '../../offline/offlineIndex';
import { useOfflineIndexStore } from '../../offline/offlineIndexStore';

/** The song from the offline list on this phone, or null (no list, not in it, or a broken file). */
function offlineDetail(key: string): SongDetail | null {
  try {
    const db = openOfflineReader();
    const group = db ? offlineSongGroup(db, key) : null;
    if (!group) return null;
    const { song_key, artist, title, versions } = toGroup(group);
    return { song: { artist, title, song_key, popularity: null, karaoke: true }, versions };
  } catch {
    return null;
  }
}

/** Merges the versions of the other same-song keys into `main` (missing keys are skipped). */
function withAlso(main: SongDetail | null, also: (SongDetail | null | undefined)[]): SongDetail | null {
  const extra = also.filter((d): d is SongDetail => !!d);
  if (!main || extra.length === 0) return main;
  const { versions } = mergeVersionSets(
    [main, ...extra].map((d) => ({ versions: d.versions, version_count: d.versions.length })),
  );
  return { ...main, versions };
}

/** The `also` route param: a JSON array of song_keys, or nothing. */
function parseAlso(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((k): k is string => typeof k === 'string').slice(0, 8) : [];
  } catch {
    return [];
  }
}

const isNotFound = (e: unknown) => (e as { status?: unknown } | null)?.status === 404;

const goMake = (intent: MakeIntent, signedIn: boolean) => {
  useMakeIntent.getState().set(intent);
  // Sign-in carries straight on into the make flow (spec §4.3).
  if (signedIn) router.push('/make/new');
  else openSignIn('/make/new');
};

/**
 * A song by its `song_key` (spec §4.2): its Community / Commercial versions from decide, or from the offline
 * list when there's no connection or decide can't be reached, and "Make it" with its canonical artist/title.
 * `id=new` is "make any song": a free-text form pre-filled from Discover's current identification.
 *
 * Decide keys "Starlight" and "Starlight (Live)" separately. Discover's card merges every same-song group (R24)
 * and passes the other keys as `also`, so this page lists the same merged versions as the card.
 */
export default function SongScreen() {
  const { id, also } = useLocalSearchParams<{ id: string; also?: string }>();
  return id === 'new' ? <MakeAnySong /> : <KnownSong songKey={id} also={parseAlso(also)} />;
}

function MakeAnySong() {
  const t = useTranslations('song');
  const signedIn = useAuth((s) => s.state.status === 'signedIn');
  const draft = useMakeIntent((s) => s.draft);
  const edit = useMakeIntent((s) => s.edit);
  const intent = typedIntent(draft);
  const canMake = intent.artist !== '' && intent.title !== '';

  return (
    <Screen testID="song-screen" scroll>
      <TextField testID="song-artist" label={t('artistLabel')} value={draft.artist} onChangeText={(v) => edit('artist', v)} />
      <TextField testID="song-title" label={t('titleLabel')} value={draft.title} onChangeText={(v) => edit('title', v)} />
      <Button
        testID="song-make"
        label={t('makeIt')}
        onPress={() => canMake && goMake(typedIntent(draft), signedIn)}
        disabled={!canMake}
      />
    </Screen>
  );
}

function KnownSong({ songKey, also = [] }: { songKey: string; also?: string[] }) {
  const t = useTranslations();
  const signedIn = useAuth((s) => s.state.status === 'signedIn');
  const offline = useOffline();
  const run = useOfflineIndexStore((s) => s.run);

  // The offline list answers at once (and is all there is without a connection); decide's answer replaces it.
  const local = useQuery({
    queryKey: ['offline', 'song', run, songKey],
    queryFn: () => offlineDetail(songKey),
    staleTime: Infinity,
    retry: false,
  });
  const cloud = useQuery({
    queryKey: ['decide', 'song', songKey],
    queryFn: () => getSongDetail(songKey),
    enabled: !offline,
    // A 404 is "not on the server" (the key may only be in the offline list): not an error, never retried.
    retry: (count, e) => !isNotFound(e) && count < 1,
  });
  // The other keys the Discover card merged in: same sources, merged the same way.
  const alsoLocal = useQueries({
    queries: also.map((key) => ({
      queryKey: ['offline', 'song', run, key],
      queryFn: () => offlineDetail(key),
      staleTime: Infinity,
      retry: false,
    })),
  });
  const alsoCloud = useQueries({
    queries: also.map((key) => ({
      queryKey: ['decide', 'song', key],
      queryFn: () => getSongDetail(key),
      enabled: !offline && !!cloud.data,
      retry: false,
    })),
  });
  const notOnServer = cloud.isError && isNotFound(cloud.error);
  const detail = cloud.data
    ? withAlso(cloud.data, alsoCloud.map((q) => q.data))
    : withAlso(local.data ?? null, alsoLocal.map((q) => q.data));
  const fromOffline = !cloud.data && detail !== null;
  // Online, the offline list fills the page while decide loads without a note; it only says so when it is all
  // there is (no connection, or decide failed).
  const offlineNote = fromOffline ? (offline ? t('song.offlineNote') : cloud.isError && !notOnServer ? t('song.cloudErrorNote') : null) : null;
  const canMake = detail !== null && !offline;

  const offerLogged = useRef(false);
  useEffect(() => {
    if (!canMake || offerLogged.current) return;
    offerLogged.current = true;
    logEvent('make_offer_shown', { where: 'song_page', song_key: songKey });
  }, [canMake, songKey]);

  const onMake = () => {
    if (!detail || !canMake) return;
    logEvent('make_offer_tap', { where: 'song_page', song_key: songKey });
    goMake(identifiedIntent(detail.song), signedIn);
  };

  const openUrl = (url: string) => {
    logEvent('open_youtube', { where: 'song_page', song_key: songKey });
    Linking.openURL(url).catch(() => {});
  };

  let body: ReactNode;
  if (detail) {
    const { song, versions } = detail;
    const hasVersions = versions.length > 0;
    body = (
      <>
        {offlineNote ? (
          <View testID="song-offline-note" className="rounded-lg bg-border px-3 py-2">
            <Text className="text-xs">{offlineNote}</Text>
          </View>
        ) : null}
        {/* Decide's catalog has no cover art yet, so the tile is generated. */}
        <ArtTile testID="song-art" title={song.title} />
        <View className="gap-1">
          <Text variant="title">{song.title}</Text>
          <Text variant="muted" className="text-base">
            {song.artist}
          </Text>
        </View>
        <View testID="song-badge-card" className="items-start gap-2 rounded-xl border border-border bg-card p-3">
          <Text
            testID="song-badge"
            className={`overflow-hidden rounded-full px-2.5 py-0.5 text-xs font-bold ${
              hasVersions ? 'bg-success/15 text-success' : 'bg-gold/15 text-gold'
            }`}
          >
            {hasVersions ? t('song.hasKaraoke') : t('song.noKaraoke')}
          </Text>
          <Text variant="muted">{hasVersions ? t('song.hasKaraokeHint') : t('song.noKaraokeHint')}</Text>
        </View>
        {hasVersions ? <VersionList key={song.song_key} versions={versions} total={versions.length} openUrl={openUrl} /> : null}
      </>
    );
  } else if (local.isLoading || (!offline && cloud.isLoading)) {
    body = <ActivityIndicator testID="song-loading" />;
  } else if (offline) {
    body = (
      <Text testID="song-offline-missing" variant="muted">
        {t('song.offlineMissing')}
      </Text>
    );
  } else {
    body = (
      <>
        <Text variant="error">{t('common.error')}</Text>
        <Button testID="song-retry" label={t('common.retry')} variant="secondary" onPress={() => void cloud.refetch()} />
      </>
    );
  }

  return (
    <Screen testID="song-screen" scroll>
      {body}
      {offline ? (
        detail ? (
          <Text testID="song-make-offline" variant="muted">
            {t('discover.needsConnection')}
          </Text>
        ) : null
      ) : (
        <Button testID="song-make" label={t('song.makeIt')} onPress={onMake} disabled={!canMake} />
      )}
    </Screen>
  );
}
