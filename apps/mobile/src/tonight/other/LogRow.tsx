import type { JobSummary } from '@nomad/api-gen';
import { isolate, useTranslations } from '@nomad/i18n';
import { Text } from '@nomad/ui';
import * as Clipboard from 'expo-clipboard';
import { Pressable, Share, View } from 'react-native';

import { useLogStore, type LogEntry, type LogState } from '../log/logStore';
import { useNightStore } from '../nightStore';
import { useYouTubeLink } from './YouTubeLink';

/** Moves an entry along (logStore → outbox) and keeps the night alive (ruling E9-R3). */
export function setLogState(id: string, state: LogState): void {
  useLogStore.getState().setState(id, state);
  useNightStore.getState().touch();
}

function Action({ testID, label, onPress, strong }: { testID: string; label: string; onPress: () => void; strong?: boolean }) {
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} hitSlop={8} onPress={onPress} className="min-h-11 justify-center">
      <Text className={`text-sm font-semibold ${strong ? 'text-primary' : 'text-muted'}`}>{label}</Text>
    </Pressable>
  );
}

export type LogRowProps = {
  entry: LogEntry;
  /** The user's gen jobs (for their own YouTube video of the song). */
  jobs: readonly JobSummary[] | undefined;
  /** Opens the post-song survey for this entry ("I sang it", "How did it go?"). */
  onSurvey: (entry: LogEntry) => void;
};

/**
 * One song logged tonight at another bar (spec §6.2): its next step ("I've requested it" / "I sang it" /
 * "Maybe later"), "How did it go?" once sung, the YouTube link when one exists, and remove.
 */
export function LogRow({ entry, jobs, onSurvey }: LogRowProps) {
  const t = useTranslations('tonight.other');
  const tSurvey = useTranslations('tonight.survey');
  const link = useYouTubeLink(entry, jobs);
  const id = entry.id;
  const sang = () => {
    setLogState(id, 'sung');
    onSurvey({ ...entry, state: 'sung' });
  };
  const remove = () => {
    useLogStore.getState().remove(id);
    useNightStore.getState().touch();
  };
  const copy = () => {
    if (link) void Clipboard.setStringAsync(link);
  };
  const share = () => {
    if (link) void Share.share({ message: t('shareMessage', { title: entry.title, artist: entry.artist, url: link }) }).catch(() => {});
  };

  return (
    <View testID={`other-row-${id}`} className="gap-1 rounded-xl border border-border bg-card p-3">
      <Text testID={`other-row-title-${id}`} className="font-semibold">
        {entry.title}
      </Text>
      {entry.artist ? <Text variant="muted">{isolate(entry.artist)}</Text> : null}
      <View className="flex-row flex-wrap gap-x-4">
        {entry.state === 'planned' || entry.state === 'skipped' ? (
          <Action testID={`other-row-${id}-requested`} label={t('requestedIt')} onPress={() => setLogState(id, 'requested')} strong />
        ) : null}
        {entry.state !== 'sung' ? <Action testID={`other-row-${id}-sung`} label={t('sangIt')} onPress={sang} strong /> : null}
        {entry.state === 'requested' ? (
          <Action testID={`other-row-${id}-planned`} label={t('maybeLater')} onPress={() => setLogState(id, 'planned')} />
        ) : null}
        {entry.state === 'sung' ? <Action testID={`other-row-${id}-survey`} label={tSurvey('title')} onPress={() => onSurvey(entry)} strong /> : null}
        {link ? <Action testID={`other-row-${id}-copy-yt`} label={t('copyYouTube')} onPress={copy} /> : null}
        {link ? <Action testID={`other-row-${id}-share-yt`} label={t('shareHost')} onPress={share} /> : null}
        <Action testID={`other-row-${id}-remove`} label={t('remove')} onPress={remove} />
      </View>
    </View>
  );
}
