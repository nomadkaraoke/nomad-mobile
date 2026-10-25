import { Ionicons } from '@expo/vector-icons';
import type { SearchSong, SearchVersion } from '@nomad/api-kjbox';
import { isolate, useTranslations } from '@nomad/i18n';
import { Button, colors, Text } from '@nomad/ui';
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, AppState, Linking, Pressable, View } from 'react-native';

import { openYouTubeUrl } from '../../media/youtube';
import { safePlay } from '../../review/audio/playback';
import { singWebUrl } from '../links';
import { TonightSheet } from '../TonightSheet';
import { usePreviewStore, type PreviewTarget } from './previewStore';

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {});
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** The web's descriptor for a search version (sing.js `_previewDescriptor`): local file, divebar mirror, or YouTube. */
export function versionPreview(song: SearchSong, v: SearchVersion): Pick<PreviewTarget, 'source' | 'extra'> {
  const title = `${song.title} — ${song.artist}`;
  if (v.source === 'local') return { source: 'local', extra: { file_path: str(obj(v.local).path), title } };
  const kn = obj(v.kn);
  const divebar = obj(kn.divebar);
  if (str(divebar.file_id)) return { source: 'divebar', extra: { file_id: str(divebar.file_id), format: divebar.format, title } };
  return { source: 'youtube', extra: { youtube_url: str(kn.youtube_url) || str(kn.url), title } };
}

/**
 * Ruling E10-R1: the preview `owner` shows stops (and is closed on the box) when that screen loses focus or unmounts,
 * and any preview stops when the app goes to the background.
 */
export function usePreviewLifecycle(owner: string, focused: boolean): void {
  useEffect(() => {
    if (!focused) usePreviewStore.getState().closeOwner(owner);
  }, [owner, focused]);
  useEffect(() => () => usePreviewStore.getState().closeOwner(owner), [owner]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'background') usePreviewStore.getState().close();
    });
    return () => sub?.remove(); // jest-expo's AppState mock returns no subscription
  }, []);
}

type Clock = { playing: boolean; current: number; duration: number };

function Controls({ clock, onToggle }: { clock: Clock; onToggle: () => void }) {
  const t = useTranslations('tonight.preview');
  const pct = clock.duration > 0 ? Math.min(100, Math.max(0, (clock.current / clock.duration) * 100)) : 0;
  return (
    <View className="flex-row items-center gap-3">
      <Pressable
        testID="tonight-preview-toggle"
        accessibilityRole="button"
        accessibilityLabel={clock.playing ? t('pause') : t('play')}
        onPress={onToggle}
        className="h-11 w-11 items-center justify-center rounded-full bg-primary"
      >
        <Ionicons name={clock.playing ? 'pause' : 'play'} size={22} color={colors.primaryFg} />
      </Pressable>
      <View
        testID="tonight-preview-progress"
        accessibilityRole="progressbar"
        accessibilityLabel={t('progress')}
        accessibilityValue={{ min: 0, max: 100, now: Math.round(pct) }}
        className="h-2 flex-1 overflow-hidden rounded-full bg-border"
      >
        <View className="h-2 rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </View>
    </View>
  );
}

/** native_video and hls (expo-video). Plays as soon as it opens: the singer just tapped ▶. */
function VideoPreview({ uri, hls, onError }: { uri: string; hls: boolean; onError: () => void }) {
  const player = useVideoPlayer({ uri, contentType: hls ? 'hls' : 'auto' }, (p) => {
    p.timeUpdateEventInterval = 0.5;
    p.play();
  });
  // Seeded from the player (setup already called play()), and re-read on every time update, so the first tap
  // pauses instead of calling play() again.
  const [clock, setClock] = useState<Clock>(() => ({ playing: !!player.playing, current: 0, duration: 0 }));
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  });
  useEffect(() => {
    const subs = [
      player.addListener('playingChange', (e) => setClock((c) => ({ ...c, playing: !!e?.isPlaying }))),
      player.addListener('timeUpdate', (e) =>
        setClock((c) => ({ playing: !!player.playing, current: e.currentTime, duration: player.duration || c.duration })),
      ),
      player.addListener('statusChange', (e) => {
        if (e.status === 'error') onErrorRef.current();
      }),
    ];
    return () => subs.forEach((s) => s.remove());
  }, [player]);
  const toggle = () => {
    try {
      if (clock.playing) player.pause();
      else player.play();
    } catch {
      onErrorRef.current();
    }
  };
  return (
    <View className="gap-3">
      <VideoView
        testID="tonight-preview-video"
        player={player}
        nativeControls={false}
        contentFit="contain"
        style={{ width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000' }}
      />
      <Controls clock={clock} onToggle={toggle} />
    </View>
  );
}

/** native_audio (expo-audio, the review's player setup): a simple visual instead of a picture. */
function AudioPreview({ uri, onError }: { uri: string; onError: () => void }) {
  const t = useTranslations('tonight.preview');
  const [clock, setClock] = useState<Clock>({ playing: false, current: 0, duration: 0 });
  const playerRef = useRef<AudioPlayer | null>(null);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  });
  useEffect(() => {
    let player: AudioPlayer;
    try {
      player = createAudioPlayer({ uri }, { updateInterval: 500 });
    } catch {
      onErrorRef.current();
      return;
    }
    playerRef.current = player;
    const sub = player.addListener('playbackStatusUpdate', (s) => {
      if (s.error) onErrorRef.current();
      setClock({ playing: s.playing, current: s.currentTime, duration: s.duration });
    });
    safePlay(player, () => onErrorRef.current());
    return () => {
      sub.remove();
      try {
        player.pause();
        player.remove();
      } catch {
        /* already released */
      }
      if (playerRef.current === player) playerRef.current = null;
    };
  }, [uri]);
  const toggle = () => {
    const player = playerRef.current;
    if (!player) return;
    if (clock.playing) player.pause();
    else safePlay(player, () => onErrorRef.current());
  };
  return (
    <View className="gap-3">
      <View
        testID="tonight-preview-audio"
        accessibilityLabel={t('audioOnly')}
        className="h-28 items-center justify-center rounded-xl border border-border bg-card"
      >
        <Ionicons name="musical-notes" size={40} color={colors.primary} />
      </View>
      <Controls clock={clock} onToggle={toggle} />
    </View>
  );
}

/**
 * The preview sheet for one screen (ruling E10-R2): title/artist, the video (or a simple visual for audio), play/pause,
 * progress and Close. CD+G plays on the web page; anything that can't play says "Preview isn't available right now".
 */
export function PreviewSheet({ owner, focused }: { owner: string; focused: boolean }) {
  const t = useTranslations('tonight.preview');
  usePreviewLifecycle(owner, focused);
  const current = usePreviewStore((s) => (s.current?.owner === owner ? s.current : null));
  const close = () => usePreviewStore.getState().close();
  // A playback failure (bad stream, decoder error) is per preview: a new one starts clean.
  const [failedId, setFailedId] = useState<number | null>(null);
  const failed = current !== null && (current.status === 'error' || failedId === current.id);
  const fail = () => {
    if (current) setFailedId(current.id);
  };

  const result = current?.result;
  let body: ReactNode = null;
  if (!current) body = null;
  else if (failed) {
    body = (
      <Text testID="tonight-preview-unavailable" variant="muted">
        {t('unavailable')}
      </Text>
    );
  } else if (current.status === 'loading' || !result) {
    body = (
      <View testID="tonight-preview-loading" className="h-28 items-center justify-center">
        <ActivityIndicator accessibilityLabel={t('loading')} />
      </View>
    );
  } else if ((result.mode === 'native_video' || result.mode === 'hls') && (result.stream_url || result.hls_url)) {
    const hls = result.mode === 'hls';
    body = <VideoPreview key={current.id} uri={(hls ? result.hls_url : result.stream_url) ?? ''} hls={hls} onError={fail} />;
  } else if (result.mode === 'native_audio' && result.stream_url) {
    body = <AudioPreview key={current.id} uri={result.stream_url} onError={fail} />;
  } else if (result.mode === 'cdg') {
    const code = current.code;
    body = (
      <View className="gap-2">
        <Text testID="tonight-preview-cdg">{t('cdg')}</Text>
        <Button testID="tonight-preview-web" variant="secondary" label={t('openWeb')} onPress={() => void Linking.openURL(singWebUrl(code))} />
      </View>
    );
  } else if (result.mode === 'youtube' && result.youtube_url) {
    const url = result.youtube_url;
    body = (
      <View className="gap-2">
        <Text testID="tonight-preview-youtube-note">{t('youtube')}</Text>
        <Button testID="tonight-preview-youtube" variant="secondary" label={t('openYoutube')} onPress={() => void openYouTubeUrl(url).catch(() => {})} />
      </View>
    );
  } else {
    body = (
      <Text testID="tonight-preview-unavailable" variant="muted">
        {t('unavailable')}
      </Text>
    );
  }

  return (
    <TonightSheet visible={current !== null} onClose={close} title={t('title')} testID="tonight-preview" closeLabel={t('close')}>
      {current ? (
        <View className="gap-3">
          <View className="gap-0.5">
            <Text testID="tonight-preview-song" className="text-base font-bold">
              {isolate(current.title)}
            </Text>
            {current.artist ? (
              <Text testID="tonight-preview-artist" variant="muted">
                {isolate(current.artist)}
              </Text>
            ) : null}
          </View>
          {body}
          <Button testID="tonight-preview-done" variant="secondary" label={t('close')} onPress={close} />
        </View>
      ) : null}
    </TonightSheet>
  );
}
