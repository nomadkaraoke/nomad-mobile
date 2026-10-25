import type { NextSongOut, SessionPatch, SessionSetup } from '@nomad/api-decide';
import { isolate, useTranslations } from '@nomad/i18n';
import { Button, Chip, colors, PianoStrip, Text } from '@nomad/ui';
import { useState, type RefObject } from 'react';
import { View } from 'react-native';

import { StepLayout } from '../../voice/StepLayout';
import { ContextChip } from '../ContextChip';
import { KaraokePlayer, type PlayerEvent, type PlayerHandle } from '../player/KaraokePlayer';
import type { PlayerMode } from '../player/playerMode';

const STRIP_LOW = 36;
const STRIP_HIGH = 84;

export type PlayScreenProps = {
  song: NextSongOut;
  setup: SessionSetup;
  playerMode: PlayerMode;
  playerRef: RefObject<PlayerHandle | null>;
  onPlayer: (e: PlayerEvent) => void;
  livePitch: number | null;
  /** The mic is on (granted): only then does a consented take actually record. */
  micGranted: boolean;
  onStopEarly: () => void;
  onPatch: (patch: SessionPatch) => void;
};

/**
 * Singing (spec §4.3 step 2): the karaoke video (embedded, or the link-out card when the version isn't embeddable),
 * a recording dot while consent is on, an optional live pitch ribbon, Stop early and the context chip. The session
 * starts the video itself once the recorder runs (KaraokePlayer's start order).
 */
export function PlayScreen({ song, setup, playerMode, playerRef, onPlayer, livePitch, micGranted, onStopEarly, onPatch }: PlayScreenProps) {
  const t = useTranslations('voiceSession');
  const [ribbon, setRibbon] = useState(false);
  return (
    <StepLayout
      testID="vs-play"
      footer={<Button testID="vs-stop-early" variant="secondary" label={t('play.stopEarly')} onPress={onStopEarly} />}
    >
      <View className="flex-row items-center justify-between gap-2">
        <View className="flex-1">
          <Text testID="vs-play-title" className="text-lg font-bold">
            {isolate(song.title)}
          </Text>
          <Text testID="vs-play-artist" variant="muted">
            {isolate(song.artist)}
          </Text>
        </View>
        <ContextChip setup={setup} onPatch={onPatch} />
      </View>
      <KaraokePlayer
        ref={playerRef}
        videoId={song.version.video_id}
        durationS={song.duration_s}
        mode={playerMode}
        onEvent={onPlayer}
        testID="vs-player"
      />
      <View className="flex-row flex-wrap items-center gap-3">
        {setup.record && micGranted ? (
          <View testID="vs-recording" className="flex-row items-center gap-2" accessible accessibilityLabel={t('play.recording')}>
            <View className="h-3 w-3 rounded-full" style={{ backgroundColor: colors.danger }} />
            <Text variant="muted">{t('play.recording')}</Text>
          </View>
        ) : null}
        <Chip testID="vs-ribbon-toggle" label={t('play.ribbon')} selected={ribbon} onPress={() => setRibbon((r) => !r)} />
      </View>
      {ribbon ? (
        <PianoStrip
          testID="vs-play-keys"
          lowMidi={STRIP_LOW}
          highMidi={STRIP_HIGH}
          height={64}
          live={livePitch}
          marks={[]}
          accessibilityLabel={t('play.keys')}
        />
      ) : null}
    </StepLayout>
  );
}
