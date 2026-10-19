import type { AudioResult } from '@nomad/api-gen';
import {
  formatMetadata,
  formatQuality,
  getDisplayName,
  groupResults,
  type ConfidenceTier,
  type SearchConfidence,
} from '@nomad/core';
import { useTranslations } from '@nomad/i18n';
import { Text } from '@nomad/ui';
import { useState } from 'react';
import { Platform, Pressable, View } from 'react-native';

import {
  availability,
  categoryKey,
  pickReason,
  pickWarnings,
  sortByTitleMatch,
  sourceRowText,
  titleBadge,
  type Availability,
} from './sourceText';

const cardClass = (selected: boolean) =>
  `rounded-xl border bg-card p-3 ${selected ? 'border-primary' : 'border-border'}`;

const MONO = { fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }) };

const AVAILABILITY_CLASS: Record<Availability, string> = {
  high: 'bg-success/15 text-success',
  medium: 'bg-gold/15 text-gold',
  low: 'bg-danger/15 text-danger',
};

function Badge({ testID, className, label }: { testID?: string; className: string; label: string }) {
  return (
    <Text testID={testID} variant="muted" className={`rounded px-1.5 py-0.5 text-xs font-semibold ${className}`}>
      {label}
    </Text>
  );
}

/** Quality, gen's High/Medium/Low availability badge and the title-match badge, on one wrapping line. */
function Tags(props: { result: AudioResult; searchTitle: string; showMatch: boolean }) {
  const t = useTranslations('make');
  const r = props.result;
  const quality = formatQuality(r);
  const avail = availability(r.seeders);
  const badge = titleBadge(r, props.searchTitle, props.showMatch);
  if (quality === '-' && !avail && !badge) return null;
  return (
    <View className="flex-row flex-wrap items-center gap-1.5">
      {quality !== '-' ? <Text variant="muted">{quality}</Text> : null}
      {avail ? (
        <Badge testID={`source-availability-${r.index}`} className={AVAILABILITY_CLASS[avail]} label={t(`avail.${avail}`)} />
      ) : null}
      {badge === 'wrong' ? (
        <Badge testID={`source-wrong-track-${r.index}`} className="bg-gold/15 text-gold" label={t('wrongTrack')} />
      ) : badge === 'match' ? (
        <Badge testID={`source-title-match-${r.index}`} className="bg-success/15 text-success" label={t('titleMatch')} />
      ) : null}
    </View>
  );
}

/** The raw file name (monospace), so the person can check it is their song (gen's "Filename:"). */
function Filename({ result }: { result: AudioResult }) {
  const t = useTranslations('make');
  if (!result.target_file) return null;
  return (
    <Text variant="muted">
      {t('filename')}{' '}
      <Text testID={`source-filename-${result.index}`} variant="muted" className="text-text" style={MONO}>
        {result.target_file}
      </Text>
    </Text>
  );
}

/** Release details: `[release type / year / label / edition / media]`. */
function Metadata({ result }: { result: AudioResult }) {
  const meta = formatMetadata(result);
  return meta ? <Text variant="muted">{meta}</Text> : null;
}

/** Tier 1/2: gen's pick, with a badge, a plain-language reason and the Choose Audio details (spec §4.3, §4.4). */
export function PickCard(props: {
  result: AudioResult;
  tier: ConfidenceTier;
  confidence: SearchConfidence;
  songTitle: string;
  selected: boolean;
  /** Closed while the match judge checks the song (spec §4.3 gate). */
  disabled?: boolean;
  onPress: () => void;
}) {
  const t = useTranslations('make');
  const perfect = props.tier === 1;
  const r = props.result;
  const warnings = pickWarnings(props.confidence, t);
  return (
    <Pressable
      testID="make-pick"
      accessibilityRole="radio"
      accessibilityState={{ selected: props.selected, disabled: !!props.disabled }}
      disabled={props.disabled}
      onPress={props.onPress}
      className={`gap-1 ${cardClass(props.selected)} ${props.disabled ? 'opacity-60' : ''}`}
    >
      <View className="flex-row">
        <Text
          testID="make-pick-badge"
          variant="muted"
          className={`rounded-full px-2 py-0.5 font-bold ${perfect ? 'bg-success/15 text-success' : 'bg-primary/15 text-primary'}`}
        >
          {perfect ? t('perfectMatch') : t('recommended')}
        </Text>
      </View>
      <Text className="font-semibold">{[props.songTitle, getDisplayName(r)].filter(Boolean).join(' · ')}</Text>
      <Text testID="make-pick-reason" variant="muted">
        {pickReason(r, t)}
      </Text>
      <Filename result={r} />
      <Text variant="muted">
        {t('release')} <Text className="text-text">{[getDisplayName(r), r.title].filter(Boolean).join(' - ')}</Text>
      </Text>
      <Tags result={r} searchTitle={props.songTitle} showMatch={false} />
      <Metadata result={r} />
      {warnings.map((w, i) => (
        <Text key={i} testID={`make-pick-warning-${i}`} className="rounded bg-gold/10 p-2 text-sm text-gold">
          {`⚠ ${w}`}
        </Text>
      ))}
    </Pressable>
  );
}

/**
 * Every source, in gen's plain-language groups; tap one to choose it. Like gen's Choose Audio list: matching
 * file names first with "Title match" / "Wrong track?" badges, and each group capped with "+N more".
 */
export function SourceGroups(props: {
  results: AudioResult[];
  searchTitle: string;
  /** Tier 3: every group open, and match badges whenever any file matches (gen `alwaysShowMatchBadge`). */
  expandAll?: boolean;
  selectedIndex: number | null;
  /** Closed while the match judge checks the song (spec §4.3 gate). */
  disabled?: boolean;
  onSelect: (index: number) => void;
}) {
  const t = useTranslations('make');
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const toggle = (category: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(category)) next.add(category);
      return next;
    });
  return (
    <View className="gap-4">
      {groupResults(props.results).map((group) => {
        const key = categoryKey(group.category);
        const { rows, showMatch } = sortByTitleMatch(group.results as AudioResult[], props.searchTitle, props.expandAll);
        const open = props.expandAll || expanded.has(group.category);
        const hidden = rows.length - group.config.maxDisplay;
        const shown = open ? rows : rows.slice(0, group.config.maxDisplay);
        return (
          <View key={group.category} className="gap-2">
            <View className="flex-row items-center justify-between">
              <Text variant="muted" className="font-semibold uppercase">
                {t('categoryCount', { label: t(`category.${key}`), count: rows.length })}
              </Text>
              {hidden > 0 && !props.expandAll ? (
                <Pressable
                  testID={`make-category-more-${key}`}
                  accessibilityRole="button"
                  onPress={() => toggle(group.category)}
                  className="min-h-11 justify-center"
                >
                  <Text className="text-primary">{open ? t('showLess') : t('moreCount', { count: hidden })}</Text>
                </Pressable>
              ) : null}
            </View>
            {shown.map((r) => {
              const selected = r.index === props.selectedIndex;
              const text = sourceRowText(r, t);
              return (
                <Pressable
                  key={r.index}
                  testID={`make-source-${r.index}`}
                  accessibilityRole="radio"
                  accessibilityState={{ selected, disabled: !!props.disabled }}
                  disabled={props.disabled}
                  onPress={() => props.onSelect(r.index)}
                  className={`gap-1 ${cardClass(selected)} ${props.disabled ? 'opacity-60' : ''}`}
                >
                  <Text testID={`source-title-${r.index}`} className="font-semibold">
                    {text.title}
                  </Text>
                  <Text variant="muted">{text.detail}</Text>
                  <Tags result={r} searchTitle={props.searchTitle} showMatch={showMatch} />
                  <Metadata result={r} />
                  <Filename result={r} />
                </Pressable>
              );
            })}
          </View>
        );
      })}
    </View>
  );
}
