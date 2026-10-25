import { Ionicons } from '@expo/vector-icons';
import { KARAFUN_LIBRARY_CODE, type LibraryTagged, type MeSong } from '@nomad/core';
import { isolate, useTranslations } from '@nomad/i18n';
import { colors, Text } from '@nomad/ui';
import { Pressable, View } from 'react-native';

import { useVoiceStore } from '../voice/voiceStore';

import { LibraryBadge } from '../find/library';
import { artistLabel } from '../tonight/log/logStore';
import { FitBadge } from '../voice/FitBadge';
import { useSongFit } from '../voice/useSongFit';
import { openSongHref } from './songHref';

const FEEL_ICON = { great: 'happy', ok: 'remove-circle', bad: 'sad' } as const;
const FEEL_COLOR = { great: colors.success, ok: colors.gold, bad: colors.muted } as const;

/** The facets as the library badge wants them (community from a community version, KaraFun from its library code). */
const tagged = (f: MeSong['facets']): LibraryTagged => ({
  libraries: f?.karafun ? [KARAFUN_LIBRARY_CODE] : [],
  versions: f?.community ? [{ kind: 'community' as const }] : [],
});

/** Only mounted for a catalogued song: useSongFit needs its song_key. */
function Fit({ songKey, index }: { songKey: string; index: number }) {
  const { fit } = useSongFit(songKey);
  return <FitBadge testID={`me-song-fit-${index}`} fit={fit} />;
}

/** One song of the collection: title, artist, times sung, how it went, crowd-pleaser, library and voice-fit badges. */
export function CollectionRow({ song: s, index: i }: { song: MeSong; index: number }) {
  const t = useTranslations('me.songs');
  const tFeel = useTranslations('tonight.survey.feel');
  const tu = useTranslations('tonight.other');
  const feel = s.latest_feel ?? null;
  // A range lookup is a request per song: only with a voice profile and range data for the song.
  const hasVoice = useVoiceStore((v) => v.profile !== null);
  const showFit = hasVoice && s.song_key && s.facets?.vr_tier != null;
  return (
    <Pressable
      testID={`me-song-${i}`}
      accessibilityRole="button"
      onPress={() => openSongHref(s)}
      className="min-h-14 gap-1 border-b border-border px-4 py-3"
    >
      <View className="flex-row items-center gap-2">
        <View className="flex-1">
          <Text className="font-semibold" numberOfLines={2}>
            {isolate(s.title)}
          </Text>
          <Text variant="muted" numberOfLines={1}>
            {isolate(artistLabel(s.artist, tu('unknownArtist')))}
          </Text>
        </View>
        {s.crowd_pleaser_count > 0 ? (
          <Ionicons testID={`me-song-crowd-${i}`} name="star" size={18} color={colors.gold} accessibilityLabel={t('crowdPleaser')} />
        ) : null}
        {feel ? (
          <Ionicons testID={`me-song-feel-${i}`} name={FEEL_ICON[feel]} size={20} color={FEEL_COLOR[feel]} accessibilityLabel={tFeel(feel)} />
        ) : null}
        <Text testID={`me-song-times-${i}`} accessibilityLabel={t('timesSungLabel', { count: s.times_sung })} className="overflow-hidden rounded-full bg-primary/15 px-2 py-0.5 text-xs font-bold text-primary">
          {t('timesSung', { count: s.times_sung })}
        </Text>
      </View>
      {s.facets?.community || s.facets?.karafun || showFit ? (
        <View className="flex-row flex-wrap items-center gap-1.5">
          <LibraryBadge song={tagged(s.facets)} />
          {showFit && s.song_key ? <Fit songKey={s.song_key} index={i} /> : null}
        </View>
      ) : null}
    </Pressable>
  );
}
