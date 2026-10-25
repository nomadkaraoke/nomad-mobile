import { useTranslations } from '@nomad/i18n';
import { Text } from '@nomad/ui';
import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';
import { View } from 'react-native';

import { FAKE_YT_SECONDS } from '../../config';
import type { PlayerEvent, PlayerHandle } from './KaraokePlayer';

export type FakePlayerProps = {
  onEvent: (e: PlayerEvent) => void;
  ref?: Ref<PlayerHandle>;
};

/**
 * E2E stand-in for the embedded video (`FAKE_YT`, local builds only). Same contract as YouTubeEmbed: `ready` on mount,
 * `playing` on the first play(), then `ended` after `FAKE_YT_SECONDS` (default 5 s).
 */
export function FakePlayer({ onEvent, ref }: FakePlayerProps) {
  const t = useTranslations('voiceSession.player');
  const emit = useRef(onEvent);
  useEffect(() => {
    emit.current = onEvent;
  });
  const started = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    emit.current({ kind: 'ready' });
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      play: () => {
        if (started.current) return;
        started.current = true;
        emit.current({ kind: 'playing' });
        timer.current = setTimeout(() => emit.current({ kind: 'ended' }), FAKE_YT_SECONDS * 1000);
      },
      pause: () => {},
    }),
    [],
  );

  return (
    <View testID="vs-fake-player" className="items-center justify-center bg-black" style={{ width: '100%', aspectRatio: 16 / 9 }}>
      <Text className="text-white">{t('fake')}</Text>
    </View>
  );
}
