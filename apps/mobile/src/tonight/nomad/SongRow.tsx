import type { Song } from '@nomad/api-kjbox';
import { isolate, useTranslations } from '@nomad/i18n';
import { Text } from '@nomad/ui';
import { Pressable, View } from 'react-native';

import { isLive, isOnStage, isOwnRequest, songKey, songParts, splitWait } from './model';

/**
 * Row actions, wired by later tasks (E5 change, E6 cancel/preview, E7 make-its). A button shows wherever the spec says
 * the action applies; until its task wires the callback, tapping it does nothing. Dismiss is the night screen's own.
 */
export type SongRowActions = {
  onCancel?: (song: Song) => void;
  onChange?: (song: Song) => void;
  onPreview?: (song: Song) => void;
  onReview?: (song: Song) => void;
  onQuickPreview?: (song: Song) => void;
  onSingQuick?: (song: Song) => void;
};

export type SongRowProps = SongRowActions & {
  song: Song;
  /** The box is unreachable: show the row, no actions (spec §4.2). */
  readOnly?: boolean;
  /** Removed or rejected rows: hide it from the list (the night screen remembers this per night). */
  onDismiss?: (song: Song) => void;
};

function RowButton({ testID, label, onPress, tone = 'default' }: { testID: string; label: string; onPress: () => void; tone?: 'default' | 'primary' }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      className={`min-h-11 justify-center rounded-md px-3 ${tone === 'primary' ? 'bg-primary' : 'border border-border'}`}
    >
      <Text className={tone === 'primary' ? 'font-bold text-primary-fg' : 'font-semibold'}>{label}</Text>
    </Pressable>
  );
}

const REVIEWABLE = new Set(['review', 'review_self', 'review_host']);

/** One Your-songs row (spec §4.1 Your songs + Make-its, A.3, A.50–A.54, A.70, A.75). */
export function SongRow({ song, readOnly, onDismiss, ...actions }: SongRowProps) {
  const t = useTranslations('tonight.night');
  const key = songKey(song);
  const { title, artist } = songParts(song.request);
  const req = song.request;
  const onStage = isOnStage(song);
  const live = isLive(song);

  const owner =
    song.owner === 'host'
      ? t('song.addedByHost')
      : song.owner === 'partner'
        ? t('song.addedBy', { name: isolate(song.added_by ?? '') })
        : song.owner === 'friend'
          ? t('song.forFriend', { name: isolate(req.singer_name) })
          : song.owner === 'web'
            ? t('song.fromWeb')
            : null;
  const partners = (req.additional_singers ?? []).map((s) => s.name).filter(Boolean);

  let status: string;
  if (song.removed) status = t('song.statusRemoved');
  else if (req.status === 'rejected') status = t('song.statusRejected');
  else if (onStage) status = t('status.onStage');
  else if (song.make === 'making') status = t('song.makeMaking');
  else if (song.make === 'review') status = t('song.makeReview');
  else if (song.make === 'review_host') status = t('song.makeReviewHost');
  else if (song.make === 'review_self') status = t('song.makeReviewSelf');
  else if (song.make === 'rendering') status = t('song.makeRendering');
  else if (song.make === 'needs_host') status = t('song.makeNeedsHost');
  else if (song.estimate?.position != null) {
    const position = song.estimate.position;
    status = position <= 1 ? t('status.next') : t('song.statusPosition', { position, wait: t('wait', splitWait(song.estimate.expected_s)) });
  } else if (req.status === 'pending') status = t('song.statusPending');
  else status = t('song.statusApproved');

  const quick =
    song.quick === 'ready' ? t('song.quickReady') : song.quick === 'chosen' ? t('song.quickChosen') : song.quick === 'upgraded' ? t('song.quickUpgraded') : null;

  // Actions only where they apply (spec §4.1): never on a removed/rejected row (Dismiss instead), never on stage.
  const act = !readOnly && live && !onStage;
  const own = isOwnRequest(song);
  const buttons: { id: string; label: string; run?: (s: Song) => void; primary?: boolean }[] = [];
  if (act && song.make && REVIEWABLE.has(song.make) && song.owner === 'me')
    buttons.push({ id: 'review', label: t('song.review'), run: actions.onReview, primary: true });
  if (act && song.quick === 'ready' && own) {
    buttons.push({ id: 'quick-preview', label: t('song.quickPreview'), run: actions.onQuickPreview });
    buttons.push({ id: 'quick-sing', label: t('song.quickSing'), run: actions.onSingQuick, primary: true });
  }
  if (act && song.previewable) buttons.push({ id: 'preview', label: t('song.preview'), run: actions.onPreview });
  if (act && own && !song.make) buttons.push({ id: 'change', label: t('song.change'), run: actions.onChange });
  if (act && own) buttons.push({ id: 'cancel', label: t('song.cancel'), run: actions.onCancel });
  if (!readOnly && !live) buttons.push({ id: 'dismiss', label: t('song.dismiss'), run: onDismiss });
  const shown = buttons;

  return (
    <View testID={`tonight-song-${key}`} className="gap-1 rounded-lg border border-border bg-card p-3">
      <Text testID={`tonight-song-title-${key}`} className="text-base font-bold">
        {artist ? t('songByArtist', { title: isolate(title), artist: isolate(artist) }) : title}
      </Text>
      {owner ? (
        <Text testID={`tonight-song-owner-${key}`} variant="muted">
          {owner}
        </Text>
      ) : null}
      {partners.length ? <Text variant="muted">{t('song.with', { names: isolate(partners.join(', ')) })}</Text> : null}
      <Text testID={`tonight-song-status-${key}`} className={onStage ? 'font-bold text-success' : ''}>
        {status}
      </Text>
      {quick && live ? <Text variant="muted">{quick}</Text> : null}
      {shown.length ? (
        <View className="mt-1 flex-row flex-wrap gap-2">
          {shown.map((b) => (
            <RowButton
              key={b.id}
              testID={`tonight-song-${b.id}-${key}`}
              label={b.label}
              tone={b.primary ? 'primary' : 'default'}
              onPress={() => b.run?.(song)}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}
