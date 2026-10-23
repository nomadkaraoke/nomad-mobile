import { importSpotifyPlaylist, importYouTubeMusicPlaylist } from '@nomad/api-decide';
import { classifyPlaylistUrl } from '@nomad/core';
import { useTranslations } from '@nomad/i18n';
import { Button, Screen, Text, TextField } from '@nomad/ui';
import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { useOffline } from '../../net/useOffline';
import { importErrorKey, type ImportErrorKey } from './importErrors';
import { useInvalidateAfterImport } from './queries';

type Done = { title: string; fetched: number; matched: number };

const statusOf = (e: unknown) => (e as { status?: unknown } | null)?.status;
const HOW_TO_STEPS = ['step1', 'step2', 'step3', 'step4'] as const;

/**
 * Playlist link import (spec §5.3): paste a public Spotify or YouTube Music playlist link; decide reads its tracks
 * (Spotify via the public embed, best-effort) and adds the matches to what the user knows.
 */
export function PlaylistImport() {
  const t = useTranslations('connect');
  const tAll = useTranslations();
  const offline = useOffline();
  const invalidate = useInvalidateAfterImport();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<Done | null>(null);
  const [howToOpen, setHowToOpen] = useState(false);

  const paste = async () => {
    let clip = '';
    try {
      clip = await Clipboard.getStringAsync();
    } catch {
      return; // the clipboard is unavailable: leave the field as it is
    }
    if (clip) {
      setText(clip.trim());
      setError('');
    }
  };

  const submit = async () => {
    if (busy) return;
    const found = classifyPlaylistUrl(text);
    if (!found) {
      setError(t('playlist.notPlaylist'));
      return;
    }
    setError('');
    setBusy(true);
    try {
      const r =
        found.service === 'spotify'
          ? await importSpotifyPlaylist(found.url)
          : await importYouTubeMusicPlaylist(found.url);
      invalidate();
      setDone({ title: r.playlist_title, fetched: r.tracks_fetched, matched: r.tracks_matched });
    } catch (e) {
      // YouTube Music answers 422 for a private / Liked Music playlist; a Spotify 422 is an embed we couldn't read.
      const key: ImportErrorKey =
        statusOf(e) === 422 && found.service === 'youtube_music'
          ? 'connect.errors.likedPrivate'
          : statusOf(e) === 422
            ? 'connect.errors.unparseable' // Spotify: an embed we couldn't read, whatever the detail says
            : importErrorKey(e, 'playlist');
      setError(tAll(key));
    } finally {
      setBusy(false);
    }
  };

  const again = () => {
    setDone(null);
    setText('');
  };

  return (
    <Screen testID="connect-playlist" scroll underHeader>
      <Text variant="muted">{t('playlist.intro')}</Text>
      {offline ? (
        <Text testID="connect-offline" variant="error" accessibilityLiveRegion="polite">
          {t('offline')}
        </Text>
      ) : null}
      {done ? (
        <>
          <Text testID="connect-import-result" accessibilityLiveRegion="polite" className="font-semibold">
            {t('playlist.done', { title: done.title })}
          </Text>
          <Text testID="connect-playlist-matched">
            {t('playlist.matched', { matched: done.matched, fetched: done.fetched })}
          </Text>
          <Button testID="connect-playlist-again" variant="secondary" label={t('playlist.again')} onPress={again} />
        </>
      ) : (
        <>
          <TextField
            testID="connect-playlist-input"
            label={t('playlist.placeholder')}
            value={text}
            onChangeText={(v) => {
              setText(v);
              setError('');
            }}
            keyboardType="url"
            autoCapitalize="none"
            error={error || undefined}
          />
          <Button testID="connect-playlist-paste" variant="secondary" label={t('playlist.paste')} onPress={() => void paste()} />
          <Button
            testID="connect-playlist-submit"
            label={t('playlist.submit')}
            onPress={() => void submit()}
            disabled={text.trim() === '' || offline}
            loading={busy}
          />
          {busy ? (
            <Text testID="connect-playlist-progress" accessibilityLiveRegion="polite">
              {t('playlist.importing')}
            </Text>
          ) : null}
          <Pressable
            testID="connect-playlist-howto"
            accessibilityRole="button"
            accessibilityState={{ expanded: howToOpen }}
            onPress={() => setHowToOpen((v) => !v)}
            className="min-h-11 justify-center"
          >
            <Text className="font-semibold text-primary">{t('playlist.howTo.title')}</Text>
          </Pressable>
          {howToOpen ? (
            <View testID="connect-playlist-howto-body" className="gap-2">
              {HOW_TO_STEPS.map((s) => (
                <Text key={s} variant="muted">
                  {t(`playlist.howTo.${s}`)}
                </Text>
              ))}
              <Text variant="muted">{t('playlist.howTo.anyPlaylist')}</Text>
            </View>
          ) : null}
        </>
      )}
    </Screen>
  );
}
