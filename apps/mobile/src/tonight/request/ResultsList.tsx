import type { SearchSong, SearchVersion } from '@nomad/api-kjbox';
import { useTranslations } from '@nomad/i18n';
import { Text } from '@nomad/ui';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import type { ListArm } from './useListArm';
import { VersionRow } from './VersionRow';

export type ResultsListProps = {
  songs: SearchSong[];
  /** Arms the list on every content change; taps go through `arm.guard` (A.18, ruling E5-R1). */
  arm: ListArm;
  simpleMode: boolean;
  /** "Request this song": the one version of a single-version song, else the auto-pick (kj_pick). */
  onRequest: (song: SearchSong) => void;
  /** "Pick this version" in the expanded list. */
  onPickVersion: (song: SearchSong, version: SearchVersion) => void;
  onInfo: (version: SearchVersion) => void;
  onPreview?: (song: SearchSong, version: SearchVersion) => void;
  /** Rows before "Show N more" (near-misses under a no-karaoke card are capped at 3, A.31); null = all. */
  cap: number | null;
  /** "Other songs with similar names" above near-misses, or "Karaoke versions of X" above the identified song's rows. */
  heading?: { text: string; testID: string };
};

const keyOf = (s: SearchSong, i: number) => s.key ?? `${s.artist}\u0000${s.title}\u0000${i}`;

/**
 * Songs grouped with their versions (A.20, A.22): one "Request this song →" per song; multi-version songs say the
 * best version is picked automatically and show it compactly (Best, pills, availability), with "Choose from N
 * versions"; single-version songs get the same enriched row. Simple Mode lists every version to pick from.
 */
export function ResultsList({ songs, arm, simpleMode, onRequest, onPickVersion, onInfo, onPreview, cap, heading }: ResultsListProps) {
  const t = useTranslations('tonight.request');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [all, setAll] = useState(false);
  const shown = all || cap === null ? songs : songs.slice(0, cap);
  const hidden = songs.length - shown.length;
  const contentKey = useMemo(() => shown.map(keyOf).join('|'), [shown]);
  // A new list (or a new shape of it) arms the taps.
  useEffect(() => arm.arm(), [arm, contentKey, expanded]);

  const toggle = (k: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  return (
    <View testID="tonight-results" className="gap-3">
      {heading ? (
        <Text testID={heading.testID} className="text-xs font-bold uppercase text-muted">
          {heading.text}
        </Text>
      ) : null}
      {shown.map((song, i) => {
        const k = keyOf(song, i);
        const single = song.versions.length === 1;
        const count = song.version_count ?? song.versions.length;
        const open = simpleMode || expanded.has(k);
        const preview = (v: SearchVersion) => (onPreview ? () => onPreview(song, v) : undefined);
        return (
          <View key={k} testID={`tonight-result-${i}`} className="gap-2 rounded-xl border border-border p-3">
            <Text testID={`tonight-result-title-${i}`} className="text-lg font-semibold">
              {song.title}
            </Text>
            <Text variant="muted">{song.artist}</Text>
            {single || !simpleMode ? (
              <Pressable
                testID={`tonight-result-request-${i}`}
                accessibilityRole="button"
                onPress={arm.guard(() => onRequest(song))}
                className="min-h-11 items-center justify-center rounded-lg bg-primary px-3 py-2"
              >
                <Text className="font-bold text-primary-fg">{t('requestCta')}</Text>
              </Pressable>
            ) : null}
            {single && song.versions[0] ? (
              <VersionRow
                version={song.versions[0]}
                testID={`tonight-version-${i}-0`}
                onInfo={() => onInfo(song.versions[0]!)}
                onPreview={preview(song.versions[0])}
              />
            ) : null}
            {!single && !simpleMode ? (
              <>
                <Text variant="muted" className="text-xs">
                  {t('autoBest')}
                </Text>
                {!open && song.versions[0] ? (
                  <VersionRow
                    version={song.versions[0]}
                    testID={`tonight-version-${i}-0`}
                    best
                    onInfo={() => onInfo(song.versions[0]!)}
                    onPreview={preview(song.versions[0])}
                  />
                ) : null}
                <Pressable testID={`tonight-result-versions-${i}`} accessibilityRole="button" hitSlop={8} onPress={arm.guard(() => toggle(k))}>
                  <Text className="text-sm font-semibold text-primary">
                    {open ? t('hideVersions') : t('versionsToggle', { count })}
                  </Text>
                </Pressable>
              </>
            ) : null}
            {!single && open
              ? song.versions.map((v, j) => (
                  <VersionRow
                    key={j}
                    version={v}
                    testID={`tonight-version-${i}-${j}`}
                    best={j === 0}
                    onInfo={() => onInfo(v)}
                    onPreview={preview(v)}
                    onPick={arm.guard(() => onPickVersion(song, v))}
                  />
                ))
              : null}
          </View>
        );
      })}
      {hidden > 0 ? (
        <Pressable testID="tonight-results-more" accessibilityRole="button" hitSlop={8} onPress={() => setAll(true)} className="py-2">
          <Text className="text-sm font-semibold text-primary">{t('showMore', { count: hidden })}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
