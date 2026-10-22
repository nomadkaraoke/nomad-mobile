import type { MeResult, NowResult } from '@nomad/api-kjbox';
import { isolate, useTranslations } from '@nomad/i18n';
import { Text } from '@nomad/ui';
import { View } from 'react-native';

import { isLive, nextSong, songParts, splitWait, turnSummary, type TurnSummary } from './model';

/**
 * "Your next song" (spec §4.1 Your songs, A.44, A.47): the real song name, the place in line and wait ("1h 28m"),
 * green and marked urgent at 3 or fewer from the mic. Nothing when the singer has no live song of their own.
 */
export function StatusTile({ me, now }: { me: MeResult; now?: NowResult }) {
  const t = useTranslations('tonight.night');
  const song = nextSong(me);
  const live = me.songs.filter((s) => s.owner !== 'friend' && isLive(s));
  if (!song || !live.length) return null;
  const { summary, urgent } = turnSummary(me, Boolean(now?.now_singing));
  const { title, artist } = songParts(song.request);

  const text = (s: TurnSummary): string => {
    switch (s.kind) {
      case 'position':
        return t('status.position', { position: s.position, wait: t('wait', splitWait(s.etaS)) });
      default:
        return t(`status.${s.kind}`);
    }
  };

  return (
    <View
      testID="tonight-status-tile"
      accessibilityRole="summary"
      className={`gap-1 rounded-xl border p-4 ${urgent ? 'border-success bg-success/15' : 'border-border bg-card'}`}
    >
      <View className="flex-row items-center justify-between gap-2">
        <Text variant="muted">{live.length > 1 ? t('status.labelOf', { count: live.length }) : t('status.label')}</Text>
        {urgent ? (
          <View testID="tonight-status-urgent" className="rounded-full bg-success px-2 py-0.5">
            <Text className="text-xs font-bold text-primary-fg">{t('status.urgent')}</Text>
          </View>
        ) : null}
      </View>
      <Text testID="tonight-status-song" className="text-lg font-bold">
        {artist ? t('songByArtist', { title: isolate(title), artist: isolate(artist) }) : title}
      </Text>
      <Text testID="tonight-status-summary" className={urgent ? 'font-bold text-success' : ''}>
        {text(summary)}
      </Text>
    </View>
  );
}

/** "Now on stage / Up next" (A.44): who's singing and who's next; Cancelled entries are already excluded by the box. */
export function StageTile({ now }: { now: NowResult }) {
  const t = useTranslations('tonight.night');
  const who = (e: NonNullable<NowResult['now_singing']>) => isolate(e.display_name || e.first_name);
  return (
    <View testID="tonight-stage-tile" className="gap-1 rounded-xl border border-border bg-card p-4">
      <Text variant="muted">{t('stage.label')}</Text>
      {now.now_singing ? (
        <>
          <Text testID="tonight-stage-now" className="text-lg font-bold">
            {who(now.now_singing)}
          </Text>
          {now.now_singing.song_artist ? <Text variant="muted">{isolate(now.now_singing.song_artist)}</Text> : null}
        </>
      ) : (
        <Text testID="tonight-stage-now">{now.queued_count ? t('stage.between') : t('stage.empty')}</Text>
      )}
      {now.up_next ? <Text testID="tonight-stage-next">{t('stage.upNext', { name: who(now.up_next) })}</Text> : null}
    </View>
  );
}
