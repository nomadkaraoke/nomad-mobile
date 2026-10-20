import type { CommunityCheck } from '@nomad/api-gen';
import { isolate, useTranslations } from '@nomad/i18n';
import { Text } from '@nomad/ui';
import { Linking, Pressable, View } from 'react-native';

import { logEvent } from '../find/searchSession';
import type { Correction, Song } from './useMatchJudge';

/**
 * gen's two-way tidy/correction toggle (AudioSourceStep MatchNotice): applied → "Tidied to … · keep what I
 * typed" / "Corrected to … — you typed … · Undo"; undone → "Using what you typed: … · Use tidied version /
 * Use the correction". Toggling changes the name only, never the audio.
 */
export function MatchNotice({ correction, onUndo, onRedo }: { correction: Correction; onUndo: () => void; onRedo: () => void }) {
  const t = useTranslations('discover');
  const tMake = useTranslations('make');
  const name = (s: Song) => isolate(t('songValue', { title: s.title, artist: s.artist }));
  const content = correction.kind === 'content';
  const label = correction.active
    ? content
      ? t('correctedTo', { value: name(correction.to), typed: name(correction.from) })
      : t('tidiedTo', { value: name(correction.to) })
    : tMake('matchUsingTyped', { value: name(correction.from) });
  const action = correction.active
    ? content
      ? t('undo')
      : t('keepTyped')
    : content
      ? tMake('matchUseCorrection')
      : tMake('matchUseTidied');
  return (
    <View testID="match-notice" className="flex-row flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-card px-3 py-2">
      <Text variant="muted" className="shrink">
        {label}
      </Text>
      <Pressable
        testID={correction.active ? 'match-undo' : 'match-redo'}
        accessibilityRole="button"
        onPress={correction.active ? onUndo : onRedo}
        hitSlop={8}
      >
        <Text className="text-sm font-semibold text-primary">{action}</Text>
      </Pressable>
    </View>
  );
}

/** "Did you mean?": the judge isn't sure; choosing one searches the audio again for it. */
export function DidYouMean({ options, onPick }: { options: Song[]; onPick: (i: number) => void }) {
  const t = useTranslations('discover');
  return (
    <View testID="did-you-mean" className="gap-2 rounded-xl border border-primary/40 bg-primary/10 p-3">
      <Text className="text-xs font-bold uppercase text-primary">{t('didYouMean')}</Text>
      <View className="flex-row flex-wrap gap-2">
        {options.map((o, i) => (
          <Pressable
            key={`${o.artist}|${o.title}|${i}`}
            testID={`did-you-mean-${i}`}
            accessibilityRole="button"
            onPress={() => onPick(i)}
            className="rounded-full border border-border bg-card px-3 py-1.5"
          >
            <Text className="text-sm">{isolate(t('songValue', { title: o.title, artist: o.artist }))}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

/** The link to watch: gen's best pick, else the first community track. */
const watchUrl = (c: CommunityCheck) =>
  c.best_youtube_url ?? c.songs.flatMap((s) => s.community_tracks).find((tr) => tr.youtube_url)?.youtube_url ?? null;

/** Before paying: a community karaoke version already exists (gen's parallel community check). Make stays available. */
export function CommunityExists({ check }: { check: CommunityCheck }) {
  const t = useTranslations('make');
  const url = watchUrl(check);
  if (!check.has_community || !url) return null;
  return (
    <View testID="community-exists" className="flex-row flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-success/40 bg-success/10 px-3 py-2">
      <Text className="shrink">{t('communityExists')}</Text>
      <Pressable
        testID="community-watch"
        accessibilityRole="link"
        hitSlop={8}
        onPress={() => {
          logEvent('open_youtube', { where: 'make_community' });
          Linking.openURL(url).catch(() => {});
        }}
      >
        <Text className="text-sm font-semibold text-primary">{t('communityWatch')}</Text>
      </Pressable>
    </View>
  );
}
