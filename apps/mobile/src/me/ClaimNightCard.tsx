import type { HistoryNight } from '@nomad/api-kjbox';
import { isolate, useFormatter, useTranslations } from '@nomad/i18n';
import { Button, Text } from '@nomad/ui';
import { Pressable, View } from 'react-native';

import { artistLabel } from '../tonight/log/logStore';
import type { ClaimCardStatus, ClaimSaved } from './useClaimNightsView';

const CHECK_MARK = '✓';

export type ClaimNightCardProps = {
  /** testID prefix: `me-claim` on Me, `me-past` on /me/past-nights. */
  prefix: string;
  index: number;
  night: HistoryNight;
  unticked: ReadonlySet<number>;
  status: ClaimCardStatus;
  offline: boolean;
  /** A night just saved: only the result shows. */
  saved?: ClaimSaved;
  onToggle(entryId: number): void;
  onSave(): void;
  onNone(): void;
};

/** "2026-10-10" as a local calendar day (no UTC shift). */
const dayOf = (iso: string): Date => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
};

/**
 * One past Nomad night on "Were these you?" (spec §6.10): the night, the songs sung under a matching name (all ticked),
 * Save ticked songs / None of these are me. Nothing is claimed until Save; unticked songs go as not mine (R33).
 */
export function ClaimNightCard({ prefix, index: i, night, unticked, status, offline, saved, onToggle, onSave, onNone }: ClaimNightCardProps) {
  const t = useTranslations('me.claim');
  const tOther = useTranslations('tonight.other');
  const f = useFormatter();
  const date = f.dateTime(dayOf(night.date), { weekday: 'short', day: 'numeric', month: 'short' });
  const name = night.names.map(isolate).join(', ');
  const tickedCount = night.songs.filter((s) => !unticked.has(s.entry_id)).length;
  const busy = status === 'busy';
  const savedCount = saved ? saved.saved + saved.alreadySaved : 0;

  return (
    <View testID={`${prefix}-night-${i}`} className="gap-2 rounded-xl border border-border bg-card p-3">
      <Text testID={`${prefix}-header-${i}`} className="font-semibold">
        {t('nightHeader', { date, count: night.songs.length, name })}
      </Text>
      {night.venue ? <Text variant="muted">{isolate(night.venue)}</Text> : null}
      {saved ? (
        <>
          {savedCount > 0 ? (
            <Text testID={`${prefix}-result-${i}`} accessibilityLiveRegion="polite">
              {t('saved', { count: savedCount })}
            </Text>
          ) : null}
          {saved.taken > 0 ? (
            <Text testID={`${prefix}-taken-${i}`} variant="muted">
              {t('taken', { count: saved.taken })}
            </Text>
          ) : null}
          {/* Nothing saved and nothing taken (shouldn't happen with a song ticked): never an empty card. */}
          {savedCount === 0 && saved.taken === 0 ? (
            <Text testID={`${prefix}-error-${i}`} accessibilityLiveRegion="polite" className="text-danger">
              {t('failed')}
            </Text>
          ) : null}
        </>
      ) : (
        <>
          {night.songs.map((s, j) => {
            const checked = !unticked.has(s.entry_id);
            return (
              <Pressable
                key={s.entry_id}
                testID={`${prefix}-song-${i}-${j}`}
                accessibilityRole="checkbox"
                accessibilityState={{ checked, disabled: busy }}
                disabled={busy}
                onPress={() => onToggle(s.entry_id)}
                className={`min-h-11 flex-row items-center gap-3 rounded-lg border p-2 ${checked ? 'border-primary bg-primary/15' : 'border-border'}`}
              >
                <Text importantForAccessibility="no" accessibilityElementsHidden className="w-5 text-primary">
                  {checked ? CHECK_MARK : ''}
                </Text>
                <View className="flex-1">
                  <Text numberOfLines={2}>
                    {t('songValue', { title: isolate(s.title), artist: isolate(artistLabel(s.artist, tOther('unknownArtist'))) })}
                  </Text>
                  {s.members.length > 1 ? (
                    <Text variant="muted" numberOfLines={1}>
                      {isolate(s.singer_name)}
                    </Text>
                  ) : null}
                </View>
              </Pressable>
            );
          })}
          {night.unmatched > 0 ? (
            <Text testID={`${prefix}-unmatched-${i}`} variant="muted">
              {t('unmatched', { count: night.unmatched })}
            </Text>
          ) : null}
          {status === 'error' ? (
            <Text testID={`${prefix}-error-${i}`} accessibilityLiveRegion="polite" className="text-danger">
              {t('failed')}
            </Text>
          ) : null}
          <Button
            testID={`${prefix}-save-${i}`}
            label={t('save')}
            onPress={onSave}
            loading={busy}
            disabled={offline || tickedCount === 0}
          />
          <Button testID={`${prefix}-none-${i}`} label={t('none')} variant="secondary" onPress={onNone} disabled={offline || busy} />
        </>
      )}
    </View>
  );
}
